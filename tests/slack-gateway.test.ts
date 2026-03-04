import { describe, expect, it, vi } from 'vitest';

import type { AgentDefinition, AppConfig } from '../src/types.js';
import { SlackGateway } from '../src/slack/app.js';
import type { MessageRouter } from '../src/core/router.js';
import type { SessionManager } from '../src/core/session.js';
import { createLogger } from '../src/utils/logger.js';

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: overrides.id ?? 'agent-a',
    displayName: overrides.displayName ?? 'Agent A',
    workspacePath: overrides.workspacePath ?? '/tmp/agent-a',
    channels: overrides.channels ?? {},
    slackUsers: overrides.slackUsers ?? [],
    enabled: overrides.enabled ?? true,
    slackDisplayName: overrides.slackDisplayName,
    slackIcon: overrides.slackIcon,
    slackBotUserId: overrides.slackBotUserId,
    description: overrides.description,
    model: overrides.model,
    schedules: overrides.schedules,
    heartbeat: overrides.heartbeat,
    cron: overrides.cron,
    limits: overrides.limits,
    reactionTriggers: overrides.reactionTriggers,
  };
}

function createGateway(postMessageImpl: (payload: Record<string, unknown>) => Promise<unknown>): SlackGateway {
  const config: AppConfig = {
    server: { port: 0 },
    slack: { appToken: 'xapp-test', botToken: 'xoxb-test' },
    llm: { provider: 'mock', defaultModel: 'mock-model', auth: 'mock-auth' },
    workspaces: { root: '/tmp', shared: '_shared' },
    session: { idleTimeoutMin: 30, maxQueueSize: 10, autoSummaryOnDispose: false, ttlDays: 30 },
    api: { enabled: false, port: 0 },
  };

  const router = {} as MessageRouter;
  const sessionManager = {} as SessionManager;
  const gateway = new SlackGateway(config, router, sessionManager, createLogger('slack-gateway-test'));

  (gateway as unknown as { app: { client: { chat: { postMessage: typeof postMessageImpl } } } }).app = {
    client: {
      chat: {
        postMessage: postMessageImpl,
      },
    },
  };

  return gateway;
}

describe('SlackGateway identity override behavior', () => {
  it('does not set username/icon_emoji when Slack identity fields are missing', async () => {
    const postMessage = vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true }));
    const gateway = createGateway(postMessage);

    await gateway.postMessage('C123', 'hello world', undefined, createAgent({
      displayName: 'Display Name Only',
    }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.username).toBeUndefined();
    expect(payload.icon_emoji).toBeUndefined();
  });

  it('retries without overrides when Slack rejects identity customization', async () => {
    const postMessage = vi
      .fn<(payload: Record<string, unknown>) => Promise<unknown>>()
      .mockRejectedValueOnce({
        data: { error: 'missing_scope' },
      })
      .mockResolvedValue({ ok: true });

    const gateway = createGateway(postMessage);

    await gateway.postMessage('C123', 'hello world', undefined, createAgent({
      slackDisplayName: 'Agent Bot',
      slackIcon: ':robot_face:',
    }));

    expect(postMessage).toHaveBeenCalledTimes(2);

    const firstPayload = postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    const secondPayload = postMessage.mock.calls[1]?.[0] as Record<string, unknown>;

    expect(firstPayload.username).toBe('Agent Bot');
    expect(firstPayload.icon_emoji).toBe(':robot_face:');
    expect(secondPayload.username).toBeUndefined();
    expect(secondPayload.icon_emoji).toBeUndefined();
  });

  it('drops invalid identity values before sending to Slack', async () => {
    const postMessage = vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true }));
    const gateway = createGateway(postMessage);

    await gateway.postMessage('C123', 'hello world', undefined, createAgent({
      slackDisplayName: 'Agent\nBot',
      slackIcon: 'not-an-emoji',
    }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.username).toBe('AgentBot');
    expect(payload.icon_emoji).toBeUndefined();
  });
});
