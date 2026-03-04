import { describe, expect, it, vi } from 'vitest';

import { HeartbeatScheduler } from '../src/core/heartbeat.js';
import type { AgentDefinition } from '../src/types.js';
import type { SessionManager } from '../src/core/session.js';
import { createLogger } from '../src/utils/logger.js';

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: overrides.id ?? 'heartbeat-agent',
    displayName: overrides.displayName ?? 'Heartbeat Agent',
    workspacePath: overrides.workspacePath ?? '/tmp/heartbeat-agent',
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

describe('HeartbeatScheduler', () => {
  it('posts heartbeat responses to the first configured channel key', async () => {
    const handleMessage = vi.fn(async () => '작업이 필요합니다');
    const sessionManager = {
      handleMessage,
    } as unknown as SessionManager;
    const postToSlack = vi.fn(async () => {});
    const scheduler = new HeartbeatScheduler(
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
        intervalMin: 5,
        quietHours: [24, 24],
      },
    });

    await (scheduler as unknown as { tick: (value: AgentDefinition) => Promise<void> }).tick(agent);

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
});
