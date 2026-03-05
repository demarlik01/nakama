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

function setupCrew(registry?: Partial<AgentRegistry>) {
  const handlers = new Map<string, CommandHandler>();
  const app = {
    command: vi.fn((name: string, handler: CommandHandler) => {
      handlers.set(name, handler);
    }),
  };

  const defaultRegistry = {
    getAll: () => [],
    findBySlackChannel: () => [],
    assignChannel: vi.fn(),
    unassignChannel: vi.fn(),
    ...registry,
  } as unknown as AgentRegistry;

  registerCommands(app as any, defaultRegistry);

  const crew = handlers.get('/crew');
  return { crew: crew!, registry: defaultRegistry };
}

async function runCrew(text: string, registry?: Partial<AgentRegistry>) {
  const { crew } = setupCrew(registry);
  const ack = vi.fn(async (_payload: Record<string, unknown>) => ({}));
  await crew({ command: { text, channel_id: 'C123' }, ack });
  return ack;
}

describe('Slack /crew command', () => {
  it('shows help when no subcommand given', async () => {
    const ack = await runCrew('');
    expect(ack).toHaveBeenCalledTimes(1);
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.response_type).toBe('ephemeral');
    expect(payload.text).toBe('/crew 사용법');
  });

  it('assign to nonexistent agent returns error', async () => {
    const ack = await runCrew('assign missing-agent');
    expect(ack).toHaveBeenCalledTimes(1);
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.response_type).toBe('ephemeral');
    expect(typeof payload.text).toBe('string');
    expect(payload.text).toContain('에이전트를 찾을 수 없습니다');
  });

  it('assign without agent name shows usage', async () => {
    const ack = await runCrew('assign');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('/crew assign');
  });

  it('agents with no agents shows info', async () => {
    const ack = await runCrew('agents');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('등록된 에이전트가 없습니다');
  });

  it('unassign with no assignments shows info', async () => {
    const ack = await runCrew('unassign');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('배정된 에이전트가 없습니다');
  });

  it('switch without agent name shows usage', async () => {
    const ack = await runCrew('switch');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('/crew switch');
  });

  it('assign allows multiple agents to the same channel', async () => {
    const alpha = {
      id: 'alpha',
      displayName: 'Alpha',
      channels: { C123: { mode: 'mention' as const } },
      slackUsers: [],
      enabled: true,
    };
    const beta = {
      id: 'beta',
      displayName: 'Beta',
      channels: {},
      slackUsers: [],
      enabled: true,
    };

    const assignChannel = vi.fn();
    const ack = await runCrew('assign beta', {
      getAll: () => [alpha, beta],
      findBySlackChannel: () => [alpha],
      assignChannel,
    });

    expect(assignChannel).toHaveBeenCalledWith('beta', 'C123', 'mention');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('Beta');
    expect(payload.text).toContain('총 2개 에이전트');
  });

  it('assign shows info when agent is already assigned', async () => {
    const alpha = {
      id: 'alpha',
      displayName: 'Alpha',
      channels: { C123: { mode: 'mention' as const } },
      slackUsers: [],
      enabled: true,
    };

    const assignChannel = vi.fn();
    const ack = await runCrew('assign alpha', {
      getAll: () => [alpha],
      findBySlackChannel: () => [alpha],
      assignChannel,
    });

    expect(assignChannel).not.toHaveBeenCalled();
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('이미');
  });

  it('default without agent name shows usage', async () => {
    const ack = await runCrew('default');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('/crew default');
  });

  it('default sets default agent for channel', async () => {
    const alpha = {
      id: 'alpha',
      displayName: 'Alpha',
      channels: { C123: { mode: 'mention' as const } },
      slackUsers: [],
      enabled: true,
    };

    const setChannelDefault = vi.fn();
    const ack = await runCrew('default alpha', {
      getAll: () => [alpha],
      findBySlackChannel: () => [alpha],
      setChannelDefault,
    });

    expect(setChannelDefault).toHaveBeenCalledWith('alpha', 'C123');
    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('기본 에이전트');
  });

  it('default errors when agent not assigned to channel', async () => {
    const alpha = {
      id: 'alpha',
      displayName: 'Alpha',
      channels: {},
      slackUsers: [],
      enabled: true,
    };

    const ack = await runCrew('default alpha', {
      getAll: () => [alpha],
      findBySlackChannel: () => [],
    });

    const payload = ack.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.text).toContain('배정되어 있지 않습니다');
  });
});
