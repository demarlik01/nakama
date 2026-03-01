import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentRegistry } from '../src/core/registry.js';
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
    createAgentDir('agent-a', '# A', { displayName: 'Agent A', slackChannels: [], slackUsers: [], enabled: true });
    createAgentDir('agent-b', '# B', { displayName: 'Agent B', slackChannels: [], slackUsers: [], enabled: true });

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
    createAgentDir('my-agent', '# My Agent', { displayName: 'My Agent', slackChannels: ['C123'], slackUsers: ['U456'], enabled: true });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const agent = registry.getById('my-agent');
    expect(agent).toBeDefined();
    expect(agent!.displayName).toBe('My Agent');
    expect(agent!.slackChannels).toEqual(['C123']);
    expect(agent!.slackUsers).toEqual(['U456']);
  });

  it('getById returns undefined for unknown agent', async () => {
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    expect(registry.getById('nonexistent')).toBeUndefined();
  });

  it('tracks thread-to-agent mapping', async () => {
    createAgentDir('thread-agent', '# Thread', { displayName: 'Thread Agent', slackChannels: [], slackUsers: [], enabled: true });

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    registry.registerThread('1234567890.123456', 'thread-agent');
    expect(registry.findByThread('1234567890.123456')?.id).toBe('thread-agent');
    expect(registry.findByThread('unknown-thread')).toBeUndefined();
  });
});
