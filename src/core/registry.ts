import { EventEmitter } from 'node:events';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { type FSWatcher, watch } from 'chokidar';

import {
  type AgentDefinition,
  type AgentMetadata,
  type AgentRegistryEvents,
  type ChannelConfig,
  type CronJobConfig,
  type CreateAgentParams,
  type HeartbeatConfig,
  type UpdateAgentParams,
} from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';

const AGENTS_MD_FILE = 'AGENTS.md';
const AGENT_JSON_FILE = 'agent.json';
const MEMORY_MD_FILE = 'MEMORY.md';
const MEMORY_DIR = 'memory';
const SKILLS_DIR = 'skills';
const SKILLS_README_FILE = 'README.md';
const DOCS_DIR = 'docs';
const ARCHIVE_DIR = '_archived';

export class AgentRegistry extends EventEmitter<AgentRegistryEvents> {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly threadToAgent = new Map<string, string>();

  private watcher?: FSWatcher;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly workspacesRoot: string,
    private readonly logger: Logger = createLogger('AgentRegistry'),
  ) {
    super();
  }

  async start(): Promise<void> {
    await mkdir(this.workspacesRoot, { recursive: true });
    await this.refreshFromDisk();
    this.startWatcher();

    this.logger.info('Agent registry started', {
      workspacesRoot: this.workspacesRoot,
      agentCount: this.agents.size,
    });
  }

  async stop(): Promise<void> {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    if (this.watcher !== undefined) {
      await this.watcher.close();
      this.watcher = undefined;
    }

    this.logger.info('Agent registry stopped');
  }

  getAll(): AgentDefinition[] {
    return [...this.agents.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getById(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  findBySlackUser(userId: string): AgentDefinition | undefined {
    for (const agent of this.agents.values()) {
      if (agent.enabled && agent.slackUsers.includes(userId)) {
        return agent;
      }
    }
    return undefined;
  }

  findBySlackChannel(channelId: string): AgentDefinition[] {
    return this.getAll().filter((agent) => agent.enabled && getChannelIds(agent).includes(channelId));
  }

  findByBotUserId(botUserId: string): AgentDefinition | undefined {
    for (const agent of this.agents.values()) {
      if (agent.enabled && agent.slackBotUserId === botUserId) {
        return agent;
      }
    }
    return undefined;
  }

  findByThread(threadTs: string): AgentDefinition | undefined {
    const agentId = this.threadToAgent.get(threadTs);
    if (agentId === undefined) {
      return undefined;
    }
    return this.agents.get(agentId);
  }

  registerThread(threadTs: string, agentId: string): void {
    this.threadToAgent.set(threadTs, agentId);
  }

  clearThread(threadTs: string): void {
    this.threadToAgent.delete(threadTs);
  }

  onAgentChange(handler: (agent: AgentDefinition) => void): void {
    this.on('agent:added', handler);
    this.on('agent:updated', handler);
  }

  async create(params: CreateAgentParams): Promise<AgentDefinition> {
    const id = normalizeAgentId(params.id);
    if (this.agents.has(id)) {
      throw new ConflictError(`Agent already exists: ${id}`);
    }
    const channels = asChannelMap(params.channels, 'channels');

    const workspacePath = path.join(this.workspacesRoot, id);
    await mkdir(workspacePath, { recursive: false });

    await Promise.all([
      writeFile(path.join(workspacePath, AGENTS_MD_FILE), normalizeFile(resolveAgentsMdContent(params)), 'utf8'),
      writeJson(path.join(workspacePath, AGENT_JSON_FILE), {
        displayName: params.displayName,
        slackDisplayName: params.slackDisplayName,
        slackIcon: params.slackIcon,
        description: params.description,
        notifyChannel: params.notifyChannel ?? params.errorNotificationChannel,
        channels,
        slackUsers: params.slackUsers,
        model: params.model,
        enabled: params.enabled ?? true,
        schedules: params.schedules,
        heartbeat: params.heartbeat,
        cron: params.cron,
        limits: params.limits,
        reactionTriggers: params.reactionTriggers,
      } satisfies AgentMetadata),
      initializeMemoryFiles(workspacePath),
      initializeSkillsFiles(workspacePath),
      mkdir(path.join(workspacePath, DOCS_DIR), { recursive: true }),
    ]);

    const created = await this.loadAgentFromWorkspace(id, workspacePath);
    if (created === null) {
      throw new Error(`Failed to create agent metadata for: ${id}`);
    }

    this.agents.set(id, created);
    this.emit('agent:added', created);

    this.logger.info('Agent created', { agentId: id });
    return created;
  }

  async update(id: string, params: UpdateAgentParams): Promise<AgentDefinition> {
    const existing = this.agents.get(id);
    if (existing === undefined) {
      throw new NotFoundError(`Agent not found: ${id}`);
    }

    const metadataPath = path.join(existing.workspacePath, AGENT_JSON_FILE);
    const currentMetadata = (await readJsonIfExists(metadataPath)) ?? {
      displayName: existing.displayName,
      slackDisplayName: existing.slackDisplayName,
      slackIcon: existing.slackIcon,
      description: existing.description,
      notifyChannel: existing.notifyChannel ?? existing.errorNotificationChannel,
      channels: existing.channels,
      slackUsers: existing.slackUsers,
      slackBotUserId: existing.slackBotUserId,
      model: existing.model,
      enabled: existing.enabled,
      schedules: existing.schedules,
      heartbeat: existing.heartbeat,
      cron: existing.cron,
      limits: existing.limits,
      reactionTriggers: existing.reactionTriggers,
    };

    const hasSlackDisplayName = Object.prototype.hasOwnProperty.call(params, 'slackDisplayName');
    const hasSlackIcon = Object.prototype.hasOwnProperty.call(params, 'slackIcon');
    const hasNotifyChannel =
      Object.prototype.hasOwnProperty.call(params, 'notifyChannel') ||
      Object.prototype.hasOwnProperty.call(params, 'errorNotificationChannel');
    const hasErrorNotificationChannel = Object.prototype.hasOwnProperty.call(
      params,
      'errorNotificationChannel',
    );

    const mergedMetadata: AgentMetadata = {
      displayName: params.displayName ?? currentMetadata.displayName,
      slackDisplayName: hasSlackDisplayName ? params.slackDisplayName : currentMetadata.slackDisplayName,
      slackIcon: hasSlackIcon ? params.slackIcon : currentMetadata.slackIcon,
      description: params.description ?? currentMetadata.description,
      notifyChannel: hasNotifyChannel
        ? params.notifyChannel ?? params.errorNotificationChannel
        : currentMetadata.notifyChannel ?? currentMetadata.errorNotificationChannel,
      errorNotificationChannel: hasErrorNotificationChannel
        ? params.errorNotificationChannel
        : hasNotifyChannel
          ? undefined
          : currentMetadata.errorNotificationChannel,
      channels: resolveChannels(params.channels, currentMetadata.channels),
      slackUsers: params.slackUsers ?? currentMetadata.slackUsers,
      slackBotUserId: params.slackBotUserId ?? currentMetadata.slackBotUserId,
      model: params.model ?? currentMetadata.model,
      enabled: params.enabled ?? currentMetadata.enabled,
      schedules: params.schedules ?? currentMetadata.schedules,
      heartbeat: params.heartbeat ?? currentMetadata.heartbeat,
      cron: params.cron ?? currentMetadata.cron,
      limits: params.limits ?? currentMetadata.limits,
      reactionTriggers: params.reactionTriggers ?? currentMetadata.reactionTriggers,
    };

    await writeJson(metadataPath, mergedMetadata);

    const updated = await this.loadAgentFromWorkspace(id, existing.workspacePath);
    if (updated === null) {
      throw new Error(`Failed to reload updated agent: ${id}`);
    }

    this.agents.set(id, updated);
    this.emit('agent:updated', updated);

    this.logger.info('Agent updated', { agentId: id });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = this.agents.get(id);
    if (existing === undefined) {
      throw new NotFoundError(`Agent not found: ${id}`);
    }

    const rootPath = path.resolve(this.workspacesRoot);
    const rootRealPath = await realpath(rootPath);
    const workspacePath = path.resolve(existing.workspacePath);
    let archived = false;
    let archivedName: string | undefined;

    let workspaceRealPath: string | undefined;
    try {
      workspaceRealPath = await realpath(workspacePath);
    } catch (error: unknown) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
      this.logger.warn('Workspace path missing while removing agent; removing registry entry only', {
        agentId: id,
        workspacePath,
      });
    }

    if (workspaceRealPath !== undefined) {
      assertPathWithinRoot(workspaceRealPath, rootRealPath, `workspace path for agent "${id}"`);

      const archiveRoot = path.resolve(this.workspacesRoot, ARCHIVE_DIR);
      await mkdir(archiveRoot, { recursive: true });
      const archiveRootRealPath = await realpath(archiveRoot);
      assertPathWithinRoot(archiveRootRealPath, rootRealPath, 'archive workspace root');

      archivedName = `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const archivePath = path.resolve(archiveRootRealPath, archivedName);
      assertPathWithinRoot(archivePath, archiveRootRealPath, `archive path for agent "${id}"`);

      await rename(workspaceRealPath, archivePath);
      archived = true;
    }

    this.agents.delete(id);
    this.clearThreadMappingsForAgent(id);
    this.emit('agent:removed', id);

    this.logger.info('Agent removed', {
      agentId: id,
      archived,
      ...(archived && archivedName ? { archivedName } : {}),
    });
  }

  private startWatcher(): void {
    // TODO: Replace broad watch with narrower incremental updates once hot paths are profiled.
    this.watcher = watch(this.workspacesRoot, {
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    const refresh = () => this.scheduleRefresh();

    this.watcher
      .on('add', refresh)
      .on('addDir', refresh)
      .on('change', refresh)
      .on('unlink', refresh)
      .on('unlinkDir', refresh)
      .on('error', (error) => {
        this.logger.error('Registry watcher error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshFromDisk().catch((error: unknown) => {
        this.logger.error('Failed to refresh registry from disk', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 500);
  }

  private async refreshFromDisk(): Promise<void> {
    const next = await this.scanAgents();

    const added: AgentDefinition[] = [];
    const removed: string[] = [];
    const updated: AgentDefinition[] = [];

    for (const [id, agent] of next) {
      const prev = this.agents.get(id);
      if (prev === undefined) {
        added.push(agent);
        continue;
      }

      if (!agentEquals(prev, agent)) {
        updated.push(agent);
      }
    }

    for (const id of this.agents.keys()) {
      if (!next.has(id)) {
        removed.push(id);
      }
    }

    this.agents.clear();
    for (const [id, agent] of next) {
      this.agents.set(id, agent);
    }

    for (const agent of added) {
      this.emit('agent:added', agent);
    }
    for (const id of removed) {
      this.clearThreadMappingsForAgent(id);
      this.emit('agent:removed', id);
    }
    for (const agent of updated) {
      this.emit('agent:updated', agent);
    }
  }

  private async scanAgents(): Promise<Map<string, AgentDefinition>> {
    const entries = await readdir(this.workspacesRoot, { withFileTypes: true });

    const agents = new Map<string, AgentDefinition>();

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === ARCHIVE_DIR) {
        continue;
      }

      const workspacePath = path.join(this.workspacesRoot, entry.name);
      const agent = await this.loadAgentFromWorkspace(entry.name, workspacePath);
      if (agent !== null) {
        agents.set(agent.id, agent);
      }
    }

    return agents;
  }

  private async loadAgentFromWorkspace(
    id: string,
    workspacePath: string,
  ): Promise<AgentDefinition | null> {
    const agentsMdPath = path.join(workspacePath, AGENTS_MD_FILE);
    const hasAgentsMd = await exists(agentsMdPath);
    if (!hasAgentsMd) {
      return null;
    }

    if (id.startsWith('_')) {
      return null;
    }

    const metadataPath = path.join(workspacePath, AGENT_JSON_FILE);
    const metadata = (await readJsonIfExists(metadataPath)) ?? {
      displayName: id,
      channels: {},
      slackUsers: [],
      enabled: true,
    };

    return {
      id,
      displayName: metadata.displayName,
      slackDisplayName: metadata.slackDisplayName,
      slackIcon: metadata.slackIcon,
      description: metadata.description,
      notifyChannel: metadata.notifyChannel ?? metadata.errorNotificationChannel,
      errorNotificationChannel: metadata.errorNotificationChannel,
      workspacePath,
      channels: metadata.channels,
      slackUsers: metadata.slackUsers,
      slackBotUserId: metadata.slackBotUserId,
      model: metadata.model,
      enabled: metadata.enabled,
      schedules: metadata.schedules,
      heartbeat: metadata.heartbeat,
      cron: metadata.cron,
      limits: metadata.limits,
      reactionTriggers: metadata.reactionTriggers,
    };
  }

  private clearThreadMappingsForAgent(agentId: string): void {
    for (const [threadTs, mappedAgentId] of this.threadToAgent.entries()) {
      if (mappedAgentId === agentId) {
        this.threadToAgent.delete(threadTs);
      }
    }
  }
}

function agentEquals(left: AgentDefinition, right: AgentDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getChannelIds(agent: Pick<AgentDefinition, 'channels'>): string[] {
  return Object.keys(agent.channels);
}

function normalizeAgentId(input: string): string {
  const normalized = input.trim();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(normalized)) {
    throw new Error(`Invalid agent id: ${input}`);
  }
  return normalized;
}

function normalizeFile(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function assertPathWithinRoot(targetPath: string, rootPath: string, label: string): void {
  const relative = path.relative(rootPath, targetPath);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be a child path within ${rootPath}`);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === code;
}

// On create, empty agentsMd gets a default template.
// On update (PUT/PATCH in agents.ts), provided agentsMd is written as-is since the user is explicitly editing.
function resolveAgentsMdContent(params: CreateAgentParams): string {
  const provided = params.agentsMd;
  if (typeof provided === 'string' && provided.trim().length > 0) {
    return provided;
  }

  return buildDefaultAgentsMd(params);
}

function buildDefaultAgentsMd(params: CreateAgentParams): string {
  const description =
    typeof params.description === 'string' && params.description.trim() !== ''
      ? params.description.trim()
      : `You are ${params.displayName}, a pragmatic AI software engineer.`;

  return [
    `# ${params.displayName}`,
    '',
    '## Persona',
    description,
    '',
    '## Boundaries',
    '- Work only inside this agent workspace and project files.',
    '- Avoid destructive or irreversible actions unless explicitly requested.',
    '- Do not expose secrets or private data in code, logs, or summaries.',
    '- If a task is ambiguous or blocked, ask one focused clarification question.',
    '',
    '## When To Speak',
    '- Share a short update before major edits or long-running commands.',
    '- Call out assumptions, blockers, or risky tradeoffs as soon as they appear.',
    '- If confidence is low, pause and ask for confirmation before proceeding.',
    '',
    '## Response Behavior',
    '- Answer questions clearly, avoid unnecessary chatter.',
    '- Share useful info proactively only when it adds clear value.',
    '- Never duplicate-respond to the same message.',
    '',
    '## Reporting Style',
    '- Start with outcome first, then list key changes and touched files.',
    '- Include validation steps run (tests/build) and any failures or skips.',
    '- Keep responses concise, concrete, and implementation-focused.',
  ].join('\n');
}

async function initializeMemoryFiles(workspacePath: string): Promise<void> {
  const memoryPath = path.join(workspacePath, MEMORY_MD_FILE);
  const memoryDir = path.join(workspacePath, MEMORY_DIR);
  const today = formatDate(new Date());
  const todayMemoryPath = path.join(memoryDir, `${today}.md`);

  await mkdir(memoryDir, { recursive: true });
  await Promise.all([
    writeFile(memoryPath, normalizeFile(buildMemoryIndexContent()), 'utf8'),
    writeFile(todayMemoryPath, normalizeFile(buildDailyMemoryContent(today)), 'utf8'),
  ]);
}

async function initializeSkillsFiles(workspacePath: string): Promise<void> {
  const skillsDir = path.join(workspacePath, SKILLS_DIR);
  await mkdir(skillsDir, { recursive: true });
  await writeFile(
    path.join(skillsDir, SKILLS_README_FILE),
    normalizeFile(buildSkillsReadmeContent()),
    'utf8',
  );
}

function buildMemoryIndexContent(): string {
  return [
    '# MEMORY',
    '',
    'Use this file for durable context that should persist across sessions.',
    '- Keep stable project facts and long-term decisions here.',
    '- Put day-to-day notes in memory/YYYY-MM-DD.md files.',
  ].join('\n');
}

function buildDailyMemoryContent(date: string): string {
  return [`# ${date}`, '', '## Notes', '-'].join('\n');
}

function buildSkillsReadmeContent(): string {
  return [
    '# Skills',
    '',
    'Add custom skills for this agent in this folder.',
    '- Create one folder per skill (for example: `skills/my-skill/`).',
    '- Put instructions in `skills/<skill-name>/SKILL.md`.',
    '- Keep skills focused and reusable.',
  ].join('\n');
}

function formatDate(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

async function readJsonIfExists(filePath: string): Promise<AgentMetadata | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isObject(parsed)) {
      throw new Error('agent.json must be an object');
    }

    const channels = asChannelMap(parsed.channels, 'channels');

    const metadata: AgentMetadata = {
      displayName: asString(parsed.displayName, 'displayName'),
      slackDisplayName: asOptionalString(parsed.slackDisplayName, 'slackDisplayName'),
      slackIcon: asOptionalString(parsed.slackIcon, 'slackIcon'),
      description: asOptionalString(parsed.description, 'description'),
      notifyChannel: asOptionalString(
        parsed.notifyChannel ?? parsed.errorNotificationChannel,
        'notifyChannel',
      ),
      errorNotificationChannel: asOptionalString(
        parsed.errorNotificationChannel,
        'errorNotificationChannel',
      ),
      channels,
      slackUsers: asStringArray(parsed.slackUsers, 'slackUsers'),
      enabled: asBoolean(parsed.enabled, 'enabled'),
      model: asOptionalString(parsed.model, 'model'),
      slackBotUserId: asOptionalString(parsed.slackBotUserId, 'slackBotUserId'),
      schedules: asOptionalSchedules(parsed.schedules, 'schedules'),
      heartbeat: asOptionalHeartbeat(parsed.heartbeat, 'heartbeat'),
      cron: asOptionalCronJobs(parsed.cron, 'cron'),
      limits: parsed.limits as AgentMetadata['limits'],
      reactionTriggers: Array.isArray(parsed.reactionTriggers) ? (parsed.reactionTriggers as string[]) : undefined,
    };

    return metadata;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath: string, data: AgentMetadata): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function asOptionalSchedules(value: unknown, label: string): AgentMetadata['schedules'] {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }

    return {
      name: asString(item.name, `${label}[${index}].name`),
      cron: asOptionalString(item.cron, `${label}[${index}].cron`),
      every: asOptionalString(item.every, `${label}[${index}].every`),
      message: asString(item.message, `${label}[${index}].message`),
      deliverTo: asString(item.deliverTo, `${label}[${index}].deliverTo`),
    };
  });
}

function asOptionalHeartbeat(value: unknown, label: string): HeartbeatConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    enabled: asBoolean(value.enabled, `${label}.enabled`),
    intervalMin: asNumber(value.intervalMin, `${label}.intervalMin`),
    quietHours: asNumberTuple(value.quietHours, `${label}.quietHours`),
  };
}

function asOptionalCronJobs(value: unknown, label: string): CronJobConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    return {
      name: asString(item.name, `${label}[${index}].name`),
      schedule: asString(item.schedule, `${label}[${index}].schedule`),
      prompt: asString(item.prompt, `${label}[${index}].prompt`),
      channel: asString(item.channel, `${label}[${index}].channel`),
    };
  });
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function asNumberTuple(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be an array of two numbers`);
  }
  if (typeof value[0] !== 'number' || typeof value[1] !== 'number') {
    throw new Error(`${label} elements must be numbers`);
  }
  return [value[0], value[1]];
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string') {
      throw new Error(`${label}[${index}] must be a string`);
    }
    out.push(item);
  }

  return out;
}

function asChannelMap(value: unknown, label: string): Record<string, ChannelConfig> {
  if (!isObject(value)) {
    throw new Error(`${label} must be an object`);
  }

  const channels: Record<string, ChannelConfig> = {};
  for (const [channelId, channelConfig] of Object.entries(value)) {
    if (channelConfig === undefined || channelConfig === null) {
      channels[channelId] = { mode: 'mention' };
      continue;
    }
    if (!isObject(channelConfig)) {
      throw new Error(`${label}.${channelId} must be an object`);
    }
    channels[channelId] = {
      mode: asChannelMode(channelConfig.mode, `${label}.${channelId}.mode`),
    };
  }

  return channels;
}

function asChannelMode(value: unknown, label: string): ChannelConfig['mode'] {
  if (value === undefined || value === null) {
    return 'mention';
  }
  if (value !== 'mention' && value !== 'proactive') {
    throw new Error(`${label} must be "mention" or "proactive"`);
  }
  return value;
}

function resolveChannels(
  channels?: Record<string, ChannelConfig>,
  fallbackChannels: Record<string, ChannelConfig> = {},
): Record<string, ChannelConfig> {
  if (channels !== undefined) {
    return asChannelMap(channels, 'channels');
  }
  return asChannelMap(fallbackChannels, 'channels');
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string when provided`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
