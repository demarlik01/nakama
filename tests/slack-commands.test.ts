import { describe, expect, it, vi } from 'vitest';

import type { AgentRegistry } from '../src/core/registry.js';
import { registerCommands } from '../src/slack/commands.js';

type CommandHandlerArgs = {
  command: {
    text: string;
    channel_id: string;
  };
  ack: (payload: Record<string, unknown>) => Promise<unknown>;
};

type CommandHandler = (args: CommandHandlerArgs) => Promise<void>;

describe('Slack slash commands', () => {
  it('assigning to nonexistent agent returns error', async () => {
    const handlers = new Map<string, CommandHandler>();
    const app = {
      command: vi.fn((name: string, handler: CommandHandler) => {
        handlers.set(name, handler);
      }),
    };

    const registry = {
      getAll: () => [],
      findBySlackChannel: () => [],
      assignChannel: vi.fn(),
      unassignChannel: vi.fn(),
    } as unknown as AgentRegistry;

    registerCommands(app as any, registry);

    const assign = handlers.get('/assign');
    expect(assign).toBeDefined();

    const ack = vi.fn(async (_payload: Record<string, unknown>) => ({}));
    await assign!({
      command: {
        text: 'missing-agent',
        channel_id: 'C123',
      },
      ack,
    });

    expect(ack).toHaveBeenCalledTimes(1);
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.response_type).toBe('ephemeral');
    expect(typeof payload.text).toBe('string');
    expect(payload.text).toContain('에이전트를 찾을 수 없습니다');
  });
});
