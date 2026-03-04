import { describe, expect, it } from 'vitest';

import { MessageRouter } from '../src/core/router.js';
import type { AgentDefinition, SlackBlock, SlackMessageEvent } from '../src/types.js';
import type { AgentRegistry } from '../src/core/registry.js';
import type { SessionManager } from '../src/core/session.js';
import { createLogger } from '../src/utils/logger.js';

function createAgent(overrides: Partial<AgentDefinition> & { id: string; displayName: string }): AgentDefinition {
  return {
    id: overrides.id,
    displayName: overrides.displayName,
    workspacePath: overrides.workspacePath ?? `/tmp/${overrides.id}`,
    channels: overrides.channels ?? {},
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
      sorted.filter((agent) => agent.enabled && Object.keys(agent.channels).includes(channelId)),
  } as unknown as AgentRegistry;

  const sessionManager = {
    resolveAgentIdByThread: (_threadTs: string) => undefined,
  } as unknown as SessionManager;

  return new MessageRouter(registry, sessionManager, createLogger('router-test'));
}

function collectBlockText(blocks: SlackBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const blockText = getTextField((block as { text?: unknown }).text);
    if (blockText !== undefined) {
      lines.push(blockText);
    }

    const elements = (block as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) {
      continue;
    }

    for (const element of elements) {
      const elementText = getTextField((element as { text?: unknown }).text);
      if (elementText !== undefined) {
        lines.push(elementText);
      }
    }
  }

  return lines.join('\n');
}

function getTextField(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof (value as { text?: unknown }).text === 'string'
  ) {
    return (value as { text: string }).text;
  }
  return undefined;
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

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('beta');
  });

  it('keeps channel fallback behavior when message text is blank', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Alpha',
      channels: { C_SHARED: { mode: 'proactive' } },
    });
    const beta = createAgent({
      id: 'beta',
      displayName: 'Beta',
      channels: { C_SHARED: { mode: 'proactive' } },
    });
    const router = createRouter([beta, alpha]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_SHARED',
      text: '   ',
    };
    const route = router.route(event);

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('alpha');
  });

  it('does not route when channel mention is ambiguous across agents', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Assistant',
      channels: { C_SHARED: { mode: 'proactive' } },
    });
    const beta = createAgent({
      id: 'beta',
      displayName: 'Assistant',
      channels: { C_SHARED: { mode: 'proactive' } },
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

  it('does not route plain messages to mention-mode channels', () => {
    const mentionOnly = createAgent({
      id: 'mention-only',
      displayName: 'Mention Only',
      channels: { C_MENTION: { mode: 'mention' } },
    });
    const router = createRouter([mentionOnly]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_MENTION',
      channelType: 'channel',
      text: 'hello',
    };
    const route = router.route(event);

    expect(route).toBeNull();
  });

  it('routes plain messages to proactive-mode channels', () => {
    const proactive = createAgent({
      id: 'proactive',
      displayName: 'Proactive',
      channels: { C_PROACTIVE: { mode: 'proactive' } },
    });
    const router = createRouter([proactive]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_PROACTIVE',
      channelType: 'channel',
      text: 'hello',
    };
    const route = router.route(event);

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('proactive');
  });

  it('routes app_mention events to mention-mode channels', () => {
    const mentionOnly = createAgent({
      id: 'mention-only',
      displayName: 'Mention Only',
      channels: { C_MENTION: { mode: 'mention' } },
    });
    const router = createRouter([mentionOnly]);

    const event: SlackMessageEvent = {
      type: 'app_mention',
      channel: 'C_MENTION',
      channelType: 'channel',
      text: '<@B1> hello',
    };
    const route = router.route(event);

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('mention-only');
  });

  it('returns concierge response for messages from unmapped channels', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Alpha',
      channels: { C_MAPPED: { mode: 'mention' } },
    });
    const router = createRouter([alpha]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_UNMAPPED',
      channelType: 'channel',
      text: 'hello',
    };
    const route = router.route(event);

    expect(route?.type).toBe('concierge');
    const responseText = collectBlockText(route && route.type === 'concierge' ? route.response : []);
    expect(responseText).toContain('/assign {agent} 명령어로 에이전트를 배정하세요');
  });

  it('includes available agent names in concierge response', () => {
    const alpha = createAgent({
      id: 'alpha',
      displayName: 'Alpha',
      channels: { C_ALPHA: { mode: 'mention' } },
    });
    const beta = createAgent({
      id: 'beta',
      displayName: 'Beta',
      channels: { C_BETA: { mode: 'proactive' } },
    });
    const router = createRouter([alpha, beta]);

    const event: SlackMessageEvent = {
      type: 'app_mention',
      channel: 'C_UNMAPPED',
      channelType: 'channel',
      text: '<@B1> help',
    };
    const route = router.route(event);

    expect(route?.type).toBe('concierge');
    const responseText = collectBlockText(route && route.type === 'concierge' ? route.response : []);
    expect(responseText).toContain('Alpha');
    expect(responseText).toContain('Beta');
  });

  it('routes mapped channel messages to agents (no concierge fallback)', () => {
    const proactive = createAgent({
      id: 'mapped-agent',
      displayName: 'Mapped Agent',
      channels: { C_MAPPED: { mode: 'proactive' } },
    });
    const router = createRouter([proactive]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_MAPPED',
      channelType: 'channel',
      text: 'hello',
    };
    const route = router.route(event);

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('mapped-agent');
  });

  it('/as engineer in message routes to engineer agent', () => {
    const defaultAgent = createAgent({
      id: 'analyst',
      displayName: 'Analyst',
      channels: { C_TEAM: { mode: 'mention' } },
    });
    const engineer = createAgent({
      id: 'engineer',
      displayName: 'Engineer',
      channels: {},
    });
    const router = createRouter([defaultAgent, engineer]);

    const event: SlackMessageEvent = {
      type: 'app_mention',
      channel: 'C_TEAM',
      channelType: 'channel',
      text: '<@B1> /as engineer 이 이슈를 봐줘',
    };
    const route = router.route(event);

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('engineer');
  });

  it('falls back to default channel agent when no /as is specified', () => {
    const defaultAgent = createAgent({
      id: 'analyst',
      displayName: 'Analyst',
      channels: { C_TEAM: { mode: 'mention' } },
    });
    const engineer = createAgent({
      id: 'engineer',
      displayName: 'Engineer',
      channels: {},
    });
    const router = createRouter([defaultAgent, engineer]);

    const event: SlackMessageEvent = {
      type: 'app_mention',
      channel: 'C_TEAM',
      channelType: 'channel',
      text: '<@B1> 이 이슈를 봐줘',
    };
    const route = router.route(event);

    expect(route?.type).toBe('agent');
    expect(route && route.type === 'agent' ? route.agent.id : undefined).toBe('analyst');
  });

  it('does not route plain channel messages that include /as without bot mention', () => {
    const defaultAgent = createAgent({
      id: 'analyst',
      displayName: 'Analyst',
      channels: { C_TEAM: { mode: 'mention' } },
    });
    const engineer = createAgent({
      id: 'engineer',
      displayName: 'Engineer',
      channels: {},
    });
    const router = createRouter([defaultAgent, engineer]);

    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C_TEAM',
      channelType: 'channel',
      text: '/as engineer 이 이슈를 봐줘',
      user: 'U123',
    };

    expect(router.route(event)).toBeNull();
  });
});
