import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SessionManager,
  buildSessionKey,
  resolveSessionMode,
  getMainSessionKey,
} from '../src/core/session.js';
import { AgentRegistry } from '../src/core/registry.js';
import { createLogger } from '../src/utils/logger.js';
import type { AgentDefinition, AppConfig, SessionMode } from '../src/types.js';

// Mock Pi SDK to avoid real LLM calls
vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn().mockReturnValue({ provider: 'mock', modelId: 'mock-model' }),
}));

vi.mock('@mariozechner/pi-coding-agent', () => ({
  codingTools: [],
  createAgentSession: vi.fn().mockResolvedValue({
    session: {
      agent: {
        setSystemPrompt: vi.fn(),
        state: {
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'Mock response' }] },
          ],
        },
      },
      state: {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'Mock response' }] },
        ],
      },
      prompt: vi.fn().mockResolvedValue(undefined),
    },
  }),
  SessionManager: {
    continueRecent: vi.fn().mockReturnValue({}),
    inMemory: vi.fn().mockReturnValue({}),
    open: vi.fn().mockReturnValue({}),
    list: vi.fn().mockResolvedValue([]),
  },
}));

// --- Unit tests for pure functions ---

describe('resolveSessionMode', () => {
  const makeAgent = (sessionMode?: SessionMode): AgentDefinition => ({
    id: 'test',
    displayName: 'Test',
    workspacePath: '/tmp/test',
    channels: {},
    slackUsers: [],
    enabled: true,
    sessionMode,
  });

  it('defaults to per-thread when not set', () => {
    expect(resolveSessionMode(makeAgent())).toBe('per-thread');
    expect(resolveSessionMode(makeAgent(undefined))).toBe('per-thread');
  });

  it('respects explicit session mode', () => {
    expect(resolveSessionMode(makeAgent('single'))).toBe('single');
    expect(resolveSessionMode(makeAgent('per-channel'))).toBe('per-channel');
    expect(resolveSessionMode(makeAgent('per-thread'))).toBe('per-thread');
  });
});

describe('buildSessionKey', () => {
  const makeAgent = (sessionMode?: SessionMode): AgentDefinition => ({
    id: 'agent-a',
    displayName: 'Agent A',
    workspacePath: '/tmp/agent-a',
    channels: {},
    slackUsers: [],
    enabled: true,
    sessionMode,
  });

  it('single mode: returns agentId', () => {
    const key = buildSessionKey(makeAgent('single'), {
      slackChannelId: 'C123',
      slackThreadTs: 'T456',
      slackUserId: 'U789',
    });
    expect(key).toBe('agent-a');
  });

  it('per-channel mode: returns agentId:channelId', () => {
    const key = buildSessionKey(makeAgent('per-channel'), {
      slackChannelId: 'C123',
      slackUserId: 'U789',
    });
    expect(key).toBe('agent-a:C123');
  });

  it('per-channel mode: ignores threadTs', () => {
    const key = buildSessionKey(makeAgent('per-channel'), {
      slackChannelId: 'C123',
      slackThreadTs: 'T456',
      slackUserId: 'U789',
    });
    expect(key).toBe('agent-a:C123');
  });

  it('per-thread mode: returns agentId:threadTs', () => {
    const key = buildSessionKey(makeAgent('per-thread'), {
      slackChannelId: 'C123',
      slackThreadTs: 'T456',
      slackUserId: 'U789',
    });
    expect(key).toBe('agent-a:T456');
  });

  it('per-thread mode: falls back to per-channel when no thread', () => {
    const key = buildSessionKey(makeAgent('per-thread'), {
      slackChannelId: 'C123',
      slackUserId: 'U789',
    });
    expect(key).toBe('agent-a:C123');
  });

  it('default (no mode set): uses per-thread', () => {
    const key = buildSessionKey(makeAgent(), {
      slackChannelId: 'C123',
      slackThreadTs: 'T456',
      slackUserId: 'U789',
    });
    expect(key).toBe('agent-a:T456');
  });
});

describe('getMainSessionKey', () => {
  it('returns agentId', () => {
    expect(getMainSessionKey('my-agent')).toBe('my-agent');
  });
});

// --- Integration tests with SessionManager ---

describe('SessionManager session modes', () => {
  let tempDir: string;
  let registry: AgentRegistry;
  let sessionManager: SessionManager;
  const logger = createLogger('test');

  const config: AppConfig = {
    server: { port: 0 },
    slack: { appToken: 'xapp-test', botToken: 'xoxb-test' },
    llm: { provider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', auth: 'test' },
    workspaces: { root: '', shared: '_shared' },
    session: { idleTimeoutMin: 30, maxQueueSize: 100, autoSummaryOnDispose: false, ttlDays: 30 },
    api: { enabled: false, port: 3000 },
  };

  function createAgentDir(id: string, sessionMode?: SessionMode): void {
    const agentDir = join(tempDir, id);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'AGENTS.md'), `# ${id}\nYou are a test agent.`);
    writeFileSync(
      join(agentDir, 'agent.json'),
      JSON.stringify({
        displayName: id,
        channels: { C123: { mode: 'mention' }, C456: { mode: 'mention' } },
        slackUsers: ['U789'],
        enabled: true,
        ...(sessionMode !== undefined ? { sessionMode } : {}),
      }),
    );
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-mode-test-'));
    config.workspaces.root = tempDir;
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
  });

  afterEach(async () => {
    sessionManager?.stop();
    await registry?.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('single mode: all channels share one session', async () => {
    createAgentDir('single-agent', 'single');
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    // Send messages from two different channels
    await sessionManager.handleMessage('single-agent', 'Hello from C123', {
      slackChannelId: 'C123',
      slackUserId: 'U789',
    });
    await sessionManager.handleMessage('single-agent', 'Hello from C456', {
      slackChannelId: 'C456',
      slackUserId: 'U789',
    });

    const sessions = sessionManager.getAllSessions();
    const agentSessions = sessions.filter((s) => s.agentId === 'single-agent');
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0]!.sessionKey).toBe('single-agent');
  });

  it('per-channel mode: different channels get different sessions', async () => {
    createAgentDir('channel-agent', 'per-channel');
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    await sessionManager.handleMessage('channel-agent', 'Hello from C123', {
      slackChannelId: 'C123',
      slackUserId: 'U789',
    });
    await sessionManager.handleMessage('channel-agent', 'Hello from C456', {
      slackChannelId: 'C456',
      slackUserId: 'U789',
    });

    const sessions = sessionManager.getSessionsForAgent('channel-agent');
    expect(sessions).toHaveLength(2);

    const keys = sessions.map((s) => s.sessionKey).sort();
    expect(keys).toEqual(['channel-agent:C123', 'channel-agent:C456']);
  });

  it('per-thread mode: different threads get different sessions', async () => {
    createAgentDir('thread-agent', 'per-thread');
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    await sessionManager.handleMessage('thread-agent', 'Thread 1', {
      slackChannelId: 'C123',
      slackThreadTs: 'T001',
      slackUserId: 'U789',
    });
    await sessionManager.handleMessage('thread-agent', 'Thread 2', {
      slackChannelId: 'C123',
      slackThreadTs: 'T002',
      slackUserId: 'U789',
    });

    const sessions = sessionManager.getSessionsForAgent('thread-agent');
    expect(sessions).toHaveLength(2);

    const keys = sessions.map((s) => s.sessionKey).sort();
    expect(keys).toEqual(['thread-agent:T001', 'thread-agent:T002']);
  });

  it('per-thread mode: non-thread message falls back to per-channel', async () => {
    createAgentDir('thread-agent-2', 'per-thread');
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    await sessionManager.handleMessage('thread-agent-2', 'No thread', {
      slackChannelId: 'C123',
      slackUserId: 'U789',
    });

    const sessions = sessionManager.getSessionsForAgent('thread-agent-2');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionKey).toBe('thread-agent-2:C123');
  });

  it('handleMainSessionMessage always uses agentId key', async () => {
    createAgentDir('main-session-agent', 'per-thread');
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    // Regular message creates per-thread session
    await sessionManager.handleMessage('main-session-agent', 'Thread msg', {
      slackChannelId: 'C123',
      slackThreadTs: 'T001',
      slackUserId: 'U789',
    });

    // Main session message creates agentId-keyed session
    await sessionManager.handleMainSessionMessage('main-session-agent', 'Heartbeat', {
      slackChannelId: 'C123',
      slackUserId: 'system:heartbeat',
    });

    const sessions = sessionManager.getSessionsForAgent('main-session-agent');
    expect(sessions).toHaveLength(2);
    const keys = sessions.map((s) => s.sessionKey).sort();
    expect(keys).toContain('main-session-agent');
    expect(keys).toContain('main-session-agent:T001');
  });

  it('disposeSession(agentId) disposes all sessions for that agent', async () => {
    createAgentDir('dispose-agent', 'per-channel');
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    await sessionManager.handleMessage('dispose-agent', 'C123', {
      slackChannelId: 'C123',
      slackUserId: 'U789',
    });
    await sessionManager.handleMessage('dispose-agent', 'C456', {
      slackChannelId: 'C456',
      slackUserId: 'U789',
    });

    expect(sessionManager.getSessionsForAgent('dispose-agent')).toHaveLength(2);

    await sessionManager.disposeSession('dispose-agent');

    expect(sessionManager.getSessionsForAgent('dispose-agent')).toHaveLength(0);
  });

  it('default sessionMode (unset) behaves as per-thread', async () => {
    createAgentDir('default-agent'); // no sessionMode
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();
    sessionManager = new SessionManager(registry, config, logger);

    await sessionManager.handleMessage('default-agent', 'Thread msg', {
      slackChannelId: 'C123',
      slackThreadTs: 'T001',
      slackUserId: 'U789',
    });
    await sessionManager.handleMessage('default-agent', 'Another thread', {
      slackChannelId: 'C123',
      slackThreadTs: 'T002',
      slackUserId: 'U789',
    });

    const sessions = sessionManager.getSessionsForAgent('default-agent');
    expect(sessions).toHaveLength(2);
  });
});

// --- Registry parsing test ---

describe('AgentRegistry sessionMode parsing', () => {
  let tempDir: string;
  let registry: AgentRegistry;
  const logger = createLogger('test');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'registry-mode-test-'));
  });

  afterEach(async () => {
    await registry?.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses sessionMode from agent.json', async () => {
    const agentDir = join(tempDir, 'mode-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'AGENTS.md'), '# Mode Agent');
    writeFileSync(
      join(agentDir, 'agent.json'),
      JSON.stringify({
        displayName: 'Mode Agent',
        channels: {},
        slackUsers: [],
        enabled: true,
        sessionMode: 'per-channel',
      }),
    );

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const agent = registry.getById('mode-agent');
    expect(agent).toBeDefined();
    expect(agent!.sessionMode).toBe('per-channel');
  });

  it('leaves sessionMode undefined when not set', async () => {
    const agentDir = join(tempDir, 'no-mode');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'AGENTS.md'), '# No Mode');
    writeFileSync(
      join(agentDir, 'agent.json'),
      JSON.stringify({
        displayName: 'No Mode',
        channels: {},
        slackUsers: [],
        enabled: true,
      }),
    );

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    const agent = registry.getById('no-mode');
    expect(agent).toBeDefined();
    expect(agent!.sessionMode).toBeUndefined();
  });

  it('rejects invalid sessionMode values', async () => {
    const agentDir = join(tempDir, 'bad-mode');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'AGENTS.md'), '# Bad Mode');
    writeFileSync(
      join(agentDir, 'agent.json'),
      JSON.stringify({
        displayName: 'Bad Mode',
        channels: {},
        slackUsers: [],
        enabled: true,
        sessionMode: 'invalid-mode',
      }),
    );

    registry = new AgentRegistry(tempDir, logger);
    // Invalid sessionMode causes a validation error during agent loading
    await expect(registry.start()).rejects.toThrow(/sessionMode must be one of/);
  });
});
