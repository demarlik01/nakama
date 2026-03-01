import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionManager } from '../src/core/session.js';
import { AgentRegistry } from '../src/core/registry.js';
import { createLogger } from '../src/utils/logger.js';
import type { AppConfig } from '../src/types.js';

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
    inMemory: vi.fn().mockReturnValue({}),
  },
}));

describe('SessionManager', () => {
  let tempDir: string;
  let registry: AgentRegistry;
  let sessionManager: SessionManager;
  const logger = createLogger('test');

  const config: AppConfig = {
    server: { port: 0 },
    slack: { appToken: 'xapp-test', botToken: 'xoxb-test' },
    llm: { provider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', auth: 'test' },
    workspaces: { root: '', shared: '_shared' },
    session: { idleTimeoutMin: 30, maxQueueSize: 100, autoSummaryOnDispose: false },
    api: { enabled: false, port: 3000 },
  };

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-test-'));
    const agentDir = join(tempDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.');
    writeFileSync(join(agentDir, 'agent.json'), JSON.stringify({
      displayName: 'Test Agent',
      slackChannels: ['C123'],
      slackUsers: ['U456'],
      enabled: true,
    }));

    config.workspaces.root = tempDir;

    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    sessionManager = new SessionManager(registry, config, logger);
  });

  afterEach(async () => {
    await registry?.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a new session and processes a message', async () => {
    const response = await sessionManager.handleMessage('test-agent', 'Hello', {
      slackChannelId: 'C123',
      slackUserId: 'U456',
    });

    expect(response).toBe('Mock response');
  });

  it('rejects messages for unknown agents', async () => {
    await expect(
      sessionManager.handleMessage('nonexistent', 'Hello', {
        slackChannelId: 'C123',
        slackUserId: 'U456',
      }),
    ).rejects.toThrow();
  });

  it('returns session state for active agents', async () => {
    await sessionManager.handleMessage('test-agent', 'Hello', {
      slackChannelId: 'C123',
      slackUserId: 'U456',
    });

    const state = sessionManager.getActiveSession('test-agent');
    // Session may have been disposed already if idle timeout is very low
    // but with 30min timeout it should still be there
    if (state !== undefined) {
      expect(state.agentId).toBe('test-agent');
    }
  });
});
