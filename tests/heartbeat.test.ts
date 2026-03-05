import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { HeartbeatRunner } from '../src/core/heartbeat.js';
import type { AgentDefinition } from '../src/types.js';
import type { SessionManager } from '../src/core/session.js';
import { createLogger } from '../src/utils/logger.js';

let testWorkspace: string;

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: overrides.id ?? 'heartbeat-agent',
    displayName: overrides.displayName ?? 'Heartbeat Agent',
    workspacePath: overrides.workspacePath ?? testWorkspace,
    channels: overrides.channels ?? {},
    slackUsers: overrides.slackUsers ?? [],
    enabled: overrides.enabled ?? true,
    heartbeat: overrides.heartbeat,
    slackDisplayName: overrides.slackDisplayName,
    slackIcon: overrides.slackIcon,
    description: overrides.description,
    notifyChannel: overrides.notifyChannel,
    errorNotificationChannel: overrides.errorNotificationChannel,
    slackBotUserId: overrides.slackBotUserId,
    model: overrides.model,
    schedules: overrides.schedules,
    cron: overrides.cron,
    limits: overrides.limits,
    reactionTriggers: overrides.reactionTriggers,
  };
}

describe('HeartbeatRunner', () => {
  beforeEach(async () => {
    testWorkspace = path.join(tmpdir(), `heartbeat-test-${Date.now()}`);
    await mkdir(testWorkspace, { recursive: true });
    await writeFile(
      path.join(testWorkspace, 'HEARTBEAT.md'),
      '# HEARTBEAT\n\n## Checks\n- Review pending tasks\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(testWorkspace, { recursive: true, force: true });
  });

  it('posts heartbeat responses to the first configured channel key', async () => {
    const handleMessage = vi.fn(async () => '작업이 필요합니다');
    const getMessageCount = vi.fn(() => 0);
    const pruneMessagesFrom = vi.fn(() => 0);
    const sessionManager = {
      handleMessage,
      getMessageCount,
      pruneMessagesFrom,
    } as unknown as SessionManager;
    const postToSlack = vi.fn(async () => {});
    const runner = new HeartbeatRunner(
      sessionManager,
      postToSlack,
      createLogger('heartbeat-test'),
    );

    const agent = createAgent({
      channels: {
        C_FIRST: { mode: 'mention' },
        C_SECOND: { mode: 'proactive' },
      },
      heartbeat: {
        enabled: true,
        every: '5m',
      },
    });

    await runner.runOnce(agent);

    expect(handleMessage).toHaveBeenCalledWith(
      agent.id,
      expect.any(String),
      expect.objectContaining({
        slackChannelId: 'C_FIRST',
        slackUserId: 'system:heartbeat',
      }),
    );
    expect(postToSlack).toHaveBeenCalledWith('C_FIRST', '작업이 필요합니다', agent.id);
  });

  it('stays silent and prunes transcript on HEARTBEAT_OK', async () => {
    const handleMessage = vi.fn(async () => 'HEARTBEAT_OK');
    const getMessageCount = vi.fn(() => 7);
    const pruneHeartbeatTurn = vi.fn(() => 2);
    const sessionManager = {
      handleMessage,
      getMessageCount,
      pruneHeartbeatTurn,
    } as unknown as SessionManager;
    const postToSlack = vi.fn(async () => {});
    const runner = new HeartbeatRunner(
      sessionManager,
      postToSlack,
      createLogger('heartbeat-test'),
    );

    const agent = createAgent({
      channels: { C_TEST: { mode: 'mention' } },
      heartbeat: { enabled: true, every: '5m' },
    });

    const result = await runner.runOnce(agent);

    expect(result).toEqual({ status: 'ok-token', pruned: 2 });
    expect(postToSlack).not.toHaveBeenCalled();
    expect(pruneHeartbeatTurn).toHaveBeenCalledWith(agent.id, 7);
  });

  it('skips when heartbeat is disabled', async () => {
    const sessionManager = {} as unknown as SessionManager;
    const postToSlack = vi.fn(async () => {});
    const runner = new HeartbeatRunner(
      sessionManager,
      postToSlack,
      createLogger('heartbeat-test'),
    );

    const agent = createAgent({
      heartbeat: { enabled: false },
    });

    const result = await runner.runOnce(agent);
    expect(result).toEqual({ status: 'skipped', reason: 'heartbeat-disabled' });
  });

  it('skips when agent is disabled', async () => {
    const sessionManager = {} as unknown as SessionManager;
    const postToSlack = vi.fn(async () => {});
    const runner = new HeartbeatRunner(
      sessionManager,
      postToSlack,
      createLogger('heartbeat-test'),
    );

    const agent = createAgent({
      enabled: false,
      heartbeat: { enabled: true },
    });

    const result = await runner.runOnce(agent);
    expect(result).toEqual({ status: 'skipped', reason: 'agent-disabled' });
  });

  it('registers and unregisters agents', () => {
    const sessionManager = {
      getMessageCount: vi.fn(() => 0),
    } as unknown as SessionManager;
    const runner = new HeartbeatRunner(
      sessionManager,
      vi.fn(async () => {}),
      createLogger('heartbeat-test'),
    );

    const agent = createAgent({
      channels: { C_TEST: { mode: 'mention' } },
      heartbeat: { enabled: true, every: '10m' },
    });

    runner.register(agent);
    runner.unregister(agent.id);
    runner.stopAll();
  });

  it('requestHeartbeatNow triggers without error for registered agent', () => {
    const sessionManager = {
      getMessageCount: vi.fn(() => 0),
    } as unknown as SessionManager;
    const runner = new HeartbeatRunner(
      sessionManager,
      vi.fn(async () => {}),
      createLogger('heartbeat-test'),
    );

    const agent = createAgent({
      channels: { C_TEST: { mode: 'mention' } },
      heartbeat: { enabled: true },
    });

    runner.register(agent);
    runner.requestHeartbeatNow(agent.id);
    runner.stopAll();
  });
});
