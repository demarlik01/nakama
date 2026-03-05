import type { App } from '@slack/bolt';

import type { AgentDefinition, SlackBlock } from '../types.js';
import type { AgentRegistry } from '../core/registry.js';

type AgentLookupResult =
  | { type: 'match'; agent: AgentDefinition }
  | { type: 'none' }
  | { type: 'ambiguous'; matches: AgentDefinition[] };

type AckPayload = {
  response_type: 'ephemeral';
  text: string;
  blocks?: SlackBlock[];
};

type AckLike = (response: AckPayload) => Promise<unknown>;

export function registerCommands(app: App, registry: AgentRegistry): void {
  app.command('/crew', async ({ command, ack }) => {
    const parts = command.text.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1).join(' ').trim();

    switch (subcommand) {
      case 'agents':
        await handleAgents(ack, registry);
        break;
      case 'assign':
        await handleAssign(ack, registry, args, command.channel_id);
        break;
      case 'unassign':
        await handleUnassign(ack, registry, command.channel_id);
        break;
      case 'default':
        await handleDefault(ack, registry, args, command.channel_id);
        break;
      case 'switch':
        await handleSwitch(ack, registry, args, command.channel_id);
        break;
      default:
        await ackEphemeral(ack, buildHelpBlocks());
        break;
    }
  });
}

function buildHelpBlocks(): { text: string; blocks: SlackBlock[] } {
  return {
    text: '/crew 사용법',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '/crew', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '`/crew agents` — 등록된 에이전트 목록',
            '`/crew assign {agent}` — 현재 채널에 에이전트 배정 (복수 가능)',
            '`/crew unassign` — 현재 채널 배정 해제',
            '`/crew default {agent}` — 채널 기본 에이전트 지정',
            '`/crew switch {agent}` — 현재 채널 에이전트 변경',
          ].join('\n'),
        },
      },
    ],
  };
}

async function handleAgents(ack: AckLike, registry: AgentRegistry): Promise<void> {
  const agents = registry.getAll();
  if (agents.length === 0) {
    await ackEphemeral(ack, buildInfoBlocks('등록된 에이전트가 없습니다.'));
    return;
  }

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Available Agents', emoji: true },
    },
  ];

  for (const agent of agents) {
    const description = agent.description?.trim() || '설명 없음';
    const channelMentions = Object.entries(agent.channels)
      .map(([channelId, config]) => {
        const defaultMark = config.default === true ? ' ★' : '';
        return `<#${channelId}>${defaultMark}`;
      })
      .join(', ');
    const channelsText = channelMentions.length > 0 ? channelMentions : '미배정';

    blocks.push(
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${agent.displayName}* (\`${agent.id}\`)\n${description}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `채널: ${channelsText}` }],
      },
    );
  }

  await ackEphemeral(ack, { text: `${agents.length}개 에이전트`, blocks });
}

async function handleAssign(ack: AckLike, registry: AgentRegistry, agentInput: string, channelId: string): Promise<void> {
  if (agentInput.length === 0) {
    await ackEphemeral(ack, buildUsageBlocks('/crew assign {agent}'));
    return;
  }

  const match = findAgentByIdOrDisplayName(registry, agentInput);
  if (match.type === 'none') {
    await ackEphemeral(ack, buildErrorBlocks(`에이전트를 찾을 수 없습니다: \`${agentInput}\``));
    return;
  }
  if (match.type === 'ambiguous') {
    await ackEphemeral(ack, buildAmbiguousBlocks(agentInput, match.matches));
    return;
  }

  const existingAssignments = registry.findBySlackChannel(channelId);
  const alreadyAssigned = existingAssignments.find((agent) => agent.id === match.agent.id);
  if (alreadyAssigned !== undefined) {
    await ackEphemeral(
      ack,
      buildInfoBlocks(
        `*${match.agent.displayName}* (\`${match.agent.id}\`) 은 이미 채널 <#${channelId}> 에 배정되어 있습니다.`,
      ),
    );
    return;
  }

  await registry.assignChannel(match.agent.id, channelId, 'mention');

  const totalAssigned = existingAssignments.length + 1;
  const countInfo = totalAssigned > 1 ? ` (총 ${totalAssigned}개 에이전트)` : '';
  await ackEphemeral(ack, buildSuccessBlocks(`채널 <#${channelId}> 에 *${match.agent.displayName}* 을 배정했습니다.${countInfo}`));
}

async function handleDefault(ack: AckLike, registry: AgentRegistry, agentInput: string, channelId: string): Promise<void> {
  if (agentInput.length === 0) {
    await ackEphemeral(ack, buildUsageBlocks('/crew default {agent}'));
    return;
  }

  const match = findAgentByIdOrDisplayName(registry, agentInput);
  if (match.type === 'none') {
    await ackEphemeral(ack, buildErrorBlocks(`에이전트를 찾을 수 없습니다: \`${agentInput}\``));
    return;
  }
  if (match.type === 'ambiguous') {
    await ackEphemeral(ack, buildAmbiguousBlocks(agentInput, match.matches));
    return;
  }

  const existingAssignments = registry.findBySlackChannel(channelId);
  const isAssigned = existingAssignments.some((agent) => agent.id === match.agent.id);
  if (!isAssigned) {
    await ackEphemeral(
      ack,
      buildErrorBlocks(
        `*${match.agent.displayName}* (\`${match.agent.id}\`) 은 채널 <#${channelId}> 에 배정되어 있지 않습니다. 먼저 \`/crew assign ${match.agent.id}\` 로 배정하세요.`,
      ),
    );
    return;
  }

  await registry.setChannelDefault(match.agent.id, channelId);
  await ackEphemeral(
    ack,
    buildSuccessBlocks(`채널 <#${channelId}> 의 기본 에이전트를 *${match.agent.displayName}* 으로 설정했습니다.`),
  );
}

async function handleUnassign(ack: AckLike, registry: AgentRegistry, channelId: string): Promise<void> {
  const assignedAgents = registry.findBySlackChannel(channelId);

  if (assignedAgents.length === 0) {
    await ackEphemeral(ack, buildInfoBlocks(`채널 <#${channelId}> 에 배정된 에이전트가 없습니다.`));
    return;
  }

  for (const agent of assignedAgents) {
    await registry.unassignChannel(agent.id, channelId);
  }

  const removedText =
    assignedAgents.length === 1
      ? `채널 <#${channelId}> 배정을 해제했습니다: *${assignedAgents[0]?.displayName}*`
      : `채널 <#${channelId}> 에서 ${assignedAgents.length}개 에이전트 배정을 모두 해제했습니다.`;
  await ackEphemeral(ack, buildSuccessBlocks(removedText));
}

async function handleSwitch(ack: AckLike, registry: AgentRegistry, agentInput: string, channelId: string): Promise<void> {
  if (agentInput.length === 0) {
    await ackEphemeral(ack, buildUsageBlocks('/crew switch {agent}'));
    return;
  }

  const match = findAgentByIdOrDisplayName(registry, agentInput);
  if (match.type === 'none') {
    await ackEphemeral(ack, buildErrorBlocks(`에이전트를 찾을 수 없습니다: \`${agentInput}\``));
    return;
  }
  if (match.type === 'ambiguous') {
    await ackEphemeral(ack, buildAmbiguousBlocks(agentInput, match.matches));
    return;
  }

  const existingAssignments = registry.findBySlackChannel(channelId);
  const previousAgents = existingAssignments.filter((agent) => agent.id !== match.agent.id);

  for (const previous of previousAgents) {
    await registry.unassignChannel(previous.id, channelId);
  }
  await registry.assignChannel(match.agent.id, channelId, 'mention');

  if (previousAgents.length === 0) {
    await ackEphemeral(ack, buildSuccessBlocks(`채널 <#${channelId}> 을 *${match.agent.displayName}* 로 설정했습니다.`));
    return;
  }

  const fromNames = previousAgents.map((agent) => `*${agent.displayName}*`).join(', ');
  await ackEphemeral(
    ack,
    buildSuccessBlocks(`채널 <#${channelId}> 기본 에이전트를 ${fromNames} 에서 *${match.agent.displayName}* 로 변경했습니다.`),
  );
}

function findAgentByIdOrDisplayName(registry: AgentRegistry, rawInput: string): AgentLookupResult {
  const normalizedInput = normalizeMatchValue(rawInput);
  if (normalizedInput.length === 0) {
    return { type: 'none' };
  }

  const exactId = registry
    .getAll()
    .find((agent) => agent.id.localeCompare(rawInput.trim(), undefined, { sensitivity: 'accent' }) === 0);
  if (exactId !== undefined) {
    return { type: 'match', agent: exactId };
  }

  const matches = registry.getAll().filter((agent) =>
    getAgentMatchKeys(agent).some((key) => normalizeMatchValue(key) === normalizedInput),
  );

  if (matches.length === 0) {
    return { type: 'none' };
  }
  if (matches.length > 1) {
    return { type: 'ambiguous', matches };
  }

  return { type: 'match', agent: matches[0] as AgentDefinition };
}

function getAgentMatchKeys(agent: AgentDefinition): string[] {
  const keys = [agent.id, agent.displayName, agent.slackDisplayName]
    .map((value) => value?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0);

  return [...new Set(keys)];
}

function normalizeMatchValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function buildUsageBlocks(usage: string): { text: string; blocks: SlackBlock[] } {
  return {
    text: `Usage: ${usage}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `사용법: \`${usage}\``,
        },
      },
    ],
  };
}

function buildErrorBlocks(message: string): { text: string; blocks: SlackBlock[] } {
  return {
    text: message,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:x: ${message}`,
        },
      },
    ],
  };
}

function buildInfoBlocks(message: string): { text: string; blocks: SlackBlock[] } {
  return {
    text: message,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:information_source: ${message}`,
        },
      },
    ],
  };
}

function buildSuccessBlocks(message: string): { text: string; blocks: SlackBlock[] } {
  return {
    text: message,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: ${message}`,
        },
      },
    ],
  };
}

function buildAmbiguousBlocks(input: string, matches: AgentDefinition[]): { text: string; blocks: SlackBlock[] } {
  const candidates = matches.map((agent) => `• *${agent.displayName}* (\`${agent.id}\`)`).join('\n');
  return {
    text: `에이전트 이름이 모호합니다: ${input}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: \`${input}\` 에 여러 에이전트가 매칭됩니다.`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: candidates,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '정확한 agent id로 다시 실행하세요.',
          },
        ],
      },
    ],
  };
}

async function ackEphemeral(
  ack: AckLike,
  content: { text: string; blocks?: SlackBlock[] },
): Promise<void> {
  await ack({
    response_type: 'ephemeral',
    text: content.text,
    ...(content.blocks !== undefined ? { blocks: content.blocks } : {}),
  });
}
