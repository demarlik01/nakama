import { describe, expect, it } from 'vitest';

import { MessageRouter } from '../src/core/router.js';
import type { AgentDefinition, SlackMessageEvent } from '../src/types.js';
import type { AgentRegistry } from '../src/core/registry.js';
import type { SessionManager } from '../src/core/session.js';
import { createLogger } from '../src/utils/logger.js';

function createAgent(overrides: Partial<AgentDefinition> & { id: string; displayName: string }): AgentDefinition {
  return {
    id: overrides.id,
    displayName: overrides.displayName,
    workspacePath: overrides.workspacePath ?? `/tmp/${overrides.id}`,
    slackChannels: overrides.slackChannels ?? [],
    slackUsers: overrides.slackUsers ?? [],
    enabled: overrides.enabled ?? true,
    slackBotUserId: overrides.slackBotUserId,
    slackDisplayName: overrides.slackDisplayName,
    slackIcon: overrides.slackIcon,
    description: overrides.description,
    model: overrides.model,
    schedules: overrides.schedules,
    heartbeat: overrides.heartbeat,
    cron: overrides.cron,
    limits: overrides.limits,
    reactionTriggers: overrides.reactionTriggers,
  };
}

function createRouter(agents: AgentDefinition[]): MessageRouter {
  const sorted = [...agents].sort((left, right) => left.id.localeCompare(right.id));

  const registry = {
    getAll: () => sorted,
    getById: (id: string) => sorted.find((agent) => agent.id === id),
    findByThread: (_threadTs: string) => undefined,
    findByBotUserId: (botUserId: string) =>
      sorted.find((agent) => agent.enabled && agent.slackBotUserId === botUserId),
    findBySlackUser: (userId: string) =>
      sorted.find((agent) => agent.enabled && agent.slackUsers.includes(userId)),
    findBySlackChannel: (channelId: string) =>
      sorted.filter((agent) => agent.enabled && agent.slackChannels.includes(channelId)),
  } as unknown as AgentRegistry;

  const sessionManager = {
    resolveAgentIdByThread: (_threadTs: string) => undefined,
  } as unknown as SessionManager;

  return new MessageRouter(registry, sessionManager, createLogger('router-test'));
}

describe('MessageRouter mention disambiguation', () => {
  it('falls back to botUserId when mentioned name is ambiguous', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Assistant',
      slackBotUserId: 'B_ALPHA',
    });
    const beta = createAgent({
      id: 'beta',
      displayName: 'Assistant',
      slackBotUserId: 'B_BETA',
    });
    const router = createRouter([alpha, beta]);

    const event: SlackMessageEvent = {
      type: 'app_mention',
      text: 'assistant 이거 확인해줘',
      botUserId: 'B_BETA',
    };
    const route = router.route(event);

    expect(route?.agent.id).toBe('beta');
  });

  it('keeps channel fallback behavior when message text is blank', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Alpha',
      slackChannels: ['C_SHARED'],
    });
    const beta = createAgent({
      id: 'beta',
      displayName: 'Beta',
      slackChannels: ['C_SHARED'],
    });
    const router = createRouter([beta, alpha]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_SHARED',
      text: '   ',
    };
    const route = router.route(event);

    expect(route?.agent.id).toBe('alpha');
  });

  it('does not route when channel mention is ambiguous across agents', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Assistant',
      slackChannels: ['C_SHARED'],
    });
    const beta = createAgent({
      id: 'beta',
      displayName: 'Assistant',
      slackChannels: ['C_SHARED'],
    });
    const router = createRouter([alpha, beta]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_SHARED',
      text: 'assistant 이거 확인해줘',
    };
    const route = router.route(event);

    expect(route).toBeNull();
  });
});
