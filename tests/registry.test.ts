import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentRegistry, NotFoundError } from '../src/core/registry.js';
import { createLogger } from '../src/utils/logger.js';

describe('AgentRegistry', () => {
  let tempDir: string;
  let registry: AgentRegistry;
  const logger = createLogger('test');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'registry-test-'));
  });

  afterEach(async () => {
    await registry?.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createAgentDir(id: string, agentsMd = '# Agent', agentJson?: Record<string, unknown>) {
    const dir = join(tempDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), agentsMd);
    if (agentJson) {
      writeFileSync(join(dir, 'agent.json'), JSON.stringify(agentJson));
    }
  }

  it('scans existing agent directories on start', async () => {
    createAgentDir('agent-a', '# A', { displayName: 'Agent A', channels: {}, slackUsers: [], enabled: true });
    createAgentDir('agent-b', '# B', { displayName: 'Agent B', channels: {}, slackUsers: [], enabled: true });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const list = registry.getAll();
    expect(list).toHaveLength(2);
    expect(list.map(a => a.id).sort()).toEqual(['agent-a', 'agent-b']);
  });

  it('ignores directories without AGENTS.md', async () => {
    mkdirSync(join(tempDir, 'not-agent'), { recursive: true });
    writeFileSync(join(tempDir, 'not-agent', 'README.md'), '# nope');

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    expect(registry.getAll()).toHaveLength(0);
  });

  it('getById returns the correct agent', async () => {
    createAgentDir('my-agent', '# My Agent', {
      displayName: 'My Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: ['U456'],
      enabled: true,
    });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const agent = registry.getById('my-agent');
    expect(agent).toBeDefined();
    expect(agent!.displayName).toBe('My Agent');
    expect(agent!.channels).toEqual({ C123: { mode: 'mention' } });
    expect(agent!.slackUsers).toEqual(['U456']);
  });

  it('getById returns undefined for unknown agent', async () => {
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    expect(registry.getById('nonexistent')).toBeUndefined();
  });

  it('tracks thread-to-agent mapping', async () => {
    createAgentDir('thread-agent', '# Thread', { displayName: 'Thread Agent', channels: {}, slackUsers: [], enabled: true });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    registry.registerThread('1234567890.123456', 'thread-agent');
    expect(registry.findByThread('1234567890.123456')?.id).toBe('thread-agent');
    expect(registry.findByThread('unknown-thread')).toBeUndefined();
  });

  it('initializes default files for newly created agents', async () => {
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    await registry.create({
      id: 'bootstrap-agent',
      displayName: 'Bootstrap Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });

    const workspace = join(tempDir, 'bootstrap-agent');
    const agentsMd = readFileSync(join(workspace, 'AGENTS.md'), 'utf8');
    const memoryMd = readFileSync(join(workspace, 'MEMORY.md'), 'utf8');
    const skillsReadme = readFileSync(join(workspace, 'skills', 'README.md'), 'utf8');
    const today = formatDate(new Date());

    expect(agentsMd).toContain('## Persona');
    expect(agentsMd).toContain('## Boundaries');
    expect(agentsMd).toContain('## DM vs Group Policy');
    expect(agentsMd).toContain('## Response Decision Checklist');
    expect(agentsMd).toContain('## Anti-Overresponse Rules');
    expect(agentsMd).toContain('## Thread vs Channel Response Guidance');
    expect(agentsMd).toContain('## Reporting Style');

    expect(memoryMd).toContain('# MEMORY');
    expect(existsSync(join(workspace, 'memory', `${today}.md`))).toBe(true);

    expect(skillsReadme).toContain('# Skills');
    expect(skillsReadme).toContain('SKILL.md');
  });

  it('keeps detailed custom AGENTS.md content when provided', async () => {
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const customAgentsMd = [
      '# Custom Agent',
      '',
      '## Persona',
      'You are precise and efficient.',
      '',
      '## Boundaries',
      '- Work only in the project.',
      '- Never leak secrets.',
      '',
      '## When To Speak',
      '- Ask for clarification when blocked.',
      '- Share concise status updates.',
      '',
      '## Reporting Style',
      '- Include changed files and test results.',
      '- Keep details factual.',
      '',
      '## Notes',
      'CUSTOM-MARKER',
    ].join('\n');

    await registry.create({
      id: 'custom-agent',
      displayName: 'Custom Agent',
      agentsMd: customAgentsMd,
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });

    const agentsMd = readFileSync(join(tempDir, 'custom-agent', 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('CUSTOM-MARKER');
    expect(agentsMd).toContain('## Notes');
  });

  it('stores channels config in agent.json during create', async () => {
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    await registry.create({
      id: 'channel-agent',
      displayName: 'Channel Agent',
      channels: {
        C123: { mode: 'mention' },
        C999: { mode: 'proactive' },
      },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });

    const metadata = JSON.parse(readFileSync(join(tempDir, 'channel-agent', 'agent.json'), 'utf8')) as {
      channels?: Record<string, { mode?: string }>;
    };

    expect(metadata.channels).toEqual({
      C123: { mode: 'mention' },
      C999: { mode: 'proactive' },
    });
  });

  it('findBySlackChannel matches agents by channels record', async () => {
    createAgentDir('mention-agent', '# Mention', {
      displayName: 'Mention Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      enabled: true,
    });
    createAgentDir('proactive-agent', '# Proactive', {
      displayName: 'Proactive Agent',
      channels: { C999: { mode: 'proactive' } },
      slackUsers: [],
      enabled: true,
    });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    expect(registry.findBySlackChannel('C123').map((agent) => agent.id)).toEqual(['mention-agent']);
    expect(registry.findBySlackChannel('C999').map((agent) => agent.id)).toEqual(['proactive-agent']);
  });

  it('assignChannel adds channel to agent', async () => {
    createAgentDir('assign-agent', '# Assign', {
      displayName: 'Assign Agent',
      channels: {},
      slackUsers: [],
      enabled: true,
    });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const updated = await registry.assignChannel('assign-agent', 'C_ASSIGNED', 'mention');

    expect(updated.channels).toEqual({
      C_ASSIGNED: { mode: 'mention' },
    });

    const metadata = JSON.parse(readFileSync(join(tempDir, 'assign-agent', 'agent.json'), 'utf8')) as {
      channels?: Record<string, { mode: string }>;
    };
    expect(metadata.channels).toEqual({
      C_ASSIGNED: { mode: 'mention' },
    });
  });

  it('unassignChannel removes channel from agent', async () => {
    createAgentDir('unassign-agent', '# Unassign', {
      displayName: 'Unassign Agent',
      channels: {
        C_REMOVE: { mode: 'mention' },
        C_KEEP: { mode: 'proactive' },
      },
      slackUsers: [],
      enabled: true,
    });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const updated = await registry.unassignChannel('unassign-agent', 'C_REMOVE');

    expect(updated.channels).toEqual({
      C_KEEP: { mode: 'proactive' },
    });

    const metadata = JSON.parse(readFileSync(join(tempDir, 'unassign-agent', 'agent.json'), 'utf8')) as {
      channels?: Record<string, { mode: string }>;
    };
    expect(metadata.channels).toEqual({
      C_KEEP: { mode: 'proactive' },
    });
  });

  it('assigning to nonexistent agent returns error', async () => {
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    await expect(registry.assignChannel('missing-agent', 'C123', 'mention')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

});

function formatDate(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
