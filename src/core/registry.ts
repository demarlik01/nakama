import { EventEmitter } from 'node:events';
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type FSWatcher, watch } from 'chokidar';

import type {
  AgentDefinition,
  AgentMetadata,
  AgentRegistryEvents,
  CreateAgentParams,
  UpdateAgentParams,
} from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';

const AGENTS_MD_FILE = 'AGENTS.md';
const AGENT_JSON_FILE = 'agent.json';
const MEMORY_MD_FILE = 'MEMORY.md';
const MEMORY_DIR = 'memory';
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
    return this.getAll().filter((agent) => agent.enabled && agent.slackChannels.includes(channelId));
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

    const workspacePath = path.join(this.workspacesRoot, id);
    await mkdir(workspacePath, { recursive: false });

    await Promise.all([
      writeFile(path.join(workspacePath, AGENTS_MD_FILE), normalizeFile(params.agentsMd), 'utf8'),
      writeJson(path.join(workspacePath, AGENT_JSON_FILE), {
        displayName: params.displayName,
        description: params.description,
        slackChannels: params.slackChannels,
        slackUsers: params.slackUsers,
        model: params.model,
        enabled: params.enabled ?? true,
        schedules: params.schedules,
      } satisfies AgentMetadata),
      writeFile(path.join(workspacePath, MEMORY_MD_FILE), '', 'utf8'),
      mkdir(path.join(workspacePath, MEMORY_DIR), { recursive: true }),
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
      description: existing.description,
      slackChannels: existing.slackChannels,
      slackUsers: existing.slackUsers,
      slackBotUserId: existing.slackBotUserId,
      model: existing.model,
      enabled: existing.enabled,
      schedules: existing.schedules,
    };

    const mergedMetadata: AgentMetadata = {
      displayName: params.displayName ?? currentMetadata.displayName,
      description: params.description ?? currentMetadata.description,
      slackChannels: params.slackChannels ?? currentMetadata.slackChannels,
      slackUsers: params.slackUsers ?? currentMetadata.slackUsers,
      slackBotUserId: params.slackBotUserId ?? currentMetadata.slackBotUserId,
      model: params.model ?? currentMetadata.model,
      enabled: params.enabled ?? currentMetadata.enabled,
      schedules: params.schedules ?? currentMetadata.schedules,
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

    const archiveRoot = path.join(this.workspacesRoot, ARCHIVE_DIR);
    const archivedName = `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    await mkdir(archiveRoot, { recursive: true });
    await rename(existing.workspacePath, path.join(archiveRoot, archivedName));

    this.agents.delete(id);
    this.emit('agent:removed', id);

    this.logger.info('Agent archived', { agentId: id, archivedName });
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
      slackChannels: [],
      slackUsers: [],
      enabled: true,
    };

    return {
      id,
      displayName: metadata.displayName,
      description: metadata.description,
      workspacePath,
      slackChannels: metadata.slackChannels,
      slackUsers: metadata.slackUsers,
      slackBotUserId: metadata.slackBotUserId,
      model: metadata.model,
      enabled: metadata.enabled,
      schedules: metadata.schedules,
    };
  }
}

function agentEquals(left: AgentDefinition, right: AgentDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

    const metadata: AgentMetadata = {
      displayName: asString(parsed.displayName, 'displayName'),
      description: asOptionalString(parsed.description, 'description'),
      slackChannels: asStringArray(parsed.slackChannels, 'slackChannels'),
      slackUsers: asStringArray(parsed.slackUsers, 'slackUsers'),
      enabled: asBoolean(parsed.enabled, 'enabled'),
      model: asOptionalString(parsed.model, 'model'),
      slackBotUserId: asOptionalString(parsed.slackBotUserId, 'slackBotUserId'),
      schedules: asOptionalSchedules(parsed.schedules, 'schedules'),
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
