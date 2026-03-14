import type { AgentDefinition, MessageRouteResult, SlackBlock, SlackMessageEvent } from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { AgentRegistry } from './registry.js';
import type { SessionManager } from './session.js';

export class MessageRouter {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger = createLogger('MessageRouter'),
  ) {}

  route(event: SlackMessageEvent): MessageRouteResult | null {
    const threadTs = event.threadTs ?? event.thread_ts;
    const enabledAgents = this.registry.getAll().filter((agent) => agent.enabled);

    if (threadTs !== undefined) {
      const bySession = this.sessionManager.resolveAgentIdByThread(threadTs);
      if (bySession !== undefined) {
        const sessionAgent = this.registry.getById(bySession);
        if (sessionAgent !== undefined) {
          return { type: 'agent', agent: sessionAgent, threadTs };
        }
      }

      const byRegistry = this.registry.findByThread(threadTs);
      if (byRegistry !== undefined) {
        return { type: 'agent', agent: byRegistry, threadTs };
      }
    }

    if (event.type === 'app_mention') {
      const byAsDirective = this.findAgentByAsDirective(event.text, enabledAgents);
      if (byAsDirective.type === 'match') {
        return { type: 'agent', agent: byAsDirective.agent, threadTs };
      }
      if (byAsDirective.type === 'ambiguous') {
        this.logger.debug('Skipping route for ambiguous /as directive', {
          text: event.text,
          candidateIds: byAsDirective.candidateIds,
        });
        return null;
      }

      const byAgentName = this.findAgentByMentionedName(
        event.text,
        enabledAgents,
      );
      if (byAgentName.type === 'match') {
        return { type: 'agent', agent: byAgentName.agent, threadTs };
      }

      if (event.botUserId !== undefined) {
        const byBotUserId = this.registry.findByBotUserId(event.botUserId);
        if (byBotUserId !== undefined) {
          return { type: 'agent', agent: byBotUserId, threadTs };
        }
      }

      if (byAgentName.type === 'ambiguous') {
        this.logger.debug('Skipping route for ambiguous app mention', {
          text: event.text,
          candidateIds: byAgentName.candidateIds,
        });
      }
    }

    const channelType = event.channelType ?? event.channel_type;
    if (channelType === 'im' && event.user !== undefined) {
      const byDm = this.registry.findBySlackUser(event.user);
      if (byDm !== undefined) {
        return { type: 'agent', agent: byDm, threadTs };
      }
    }

    let channelAgents: AgentDefinition[] = [];
    if (event.channel !== undefined) {
      const channelId = event.channel;
      channelAgents = this.registry.findBySlackChannel(channelId);
      const routableChannelAgents =
        event.type === 'message'
          ? channelAgents.filter((agent) => getChannelMode(agent, channelId) === 'proactive')
          : channelAgents;
      const selected = this.selectChannelAgent(routableChannelAgents, event.user, event.text, channelId);
      if (selected !== undefined) {
        return { type: 'agent', agent: selected, threadTs };
      }
    }

    if (
      event.channel !== undefined &&
      channelType !== 'im' &&
      (event.type === 'message' || event.type === 'app_mention') &&
      channelAgents.length === 0
    ) {
      return {
        type: 'concierge',
        response: buildConciergeResponse(this.registry),
        threadTs,
      };
    }

    this.logger.debug('No agent route for Slack event', {
      type: event.type,
      channel: event.channel,
      user: event.user,
      threadTs,
    });

    return null;
  }

  /**
   * Return all registered agents. Used by reaction_added handler.
   */
  getAllAgents(): AgentDefinition[] {
    return this.registry.getAll();
  }

  private selectChannelAgent(
    channelAgents: AgentDefinition[],
    userId?: string,
    text?: string,
    channelId?: string,
  ): AgentDefinition | undefined {
    if (channelAgents.length === 0) {
      return undefined;
    }
    if (channelAgents.length === 1) {
      return channelAgents[0];
    }

    const normalizedUserId = userId?.trim();
    if (normalizedUserId !== undefined && normalizedUserId.length > 0) {
      const byUser = channelAgents.find((agent) => agent.slackUsers.includes(normalizedUserId));
      if (byUser !== undefined) {
        return byUser;
      }
    }

    const byMention = this.findAgentByMentionedName(text, channelAgents);
    if (byMention.type === 'match') {
      return byMention.agent;
    }
    if (byMention.type === 'ambiguous') {
      this.logger.debug('Skipping channel fallback for ambiguous mention', {
        text,
        candidateIds: byMention.candidateIds,
      });
      return undefined;
    }

    // Prefer the channel's default agent
    if (channelId !== undefined) {
      const defaultAgent = this.registry.findChannelDefault(channelId);
      if (defaultAgent !== undefined && channelAgents.some((a) => a.id === defaultAgent.id)) {
        return defaultAgent;
      }
    }

    return channelAgents[0];
  }

  private findAgentByMentionedName(
    text: string | undefined,
    candidates: AgentDefinition[],
  ): MentionMatch {
    if (text === undefined) {
      return { type: 'none' };
    }

    const normalizedText = normalizeForMatch(text);
    if (normalizedText.length === 0) {
      return { type: 'none' };
    }

    let bestMatch: { agent: AgentDefinition; keyLength: number } | undefined;
    let hasAmbiguousBestMatch = false;
    const matchedCandidateIds = new Set<string>();
    for (const agent of candidates) {
      for (const key of getAgentMatchKeys(agent)) {
        const normalizedKey = normalizeForMatch(key);
        if (normalizedKey.length === 0 || !containsWholePhrase(normalizedText, normalizedKey)) {
          continue;
        }

        matchedCandidateIds.add(agent.id);

        if (bestMatch === undefined || normalizedKey.length > bestMatch.keyLength) {
          bestMatch = { agent, keyLength: normalizedKey.length };
          hasAmbiguousBestMatch = false;
          continue;
        }

        if (
          normalizedKey.length === bestMatch.keyLength &&
          bestMatch.agent.id !== agent.id
        ) {
          hasAmbiguousBestMatch = true;
        }
      }
    }

    if (hasAmbiguousBestMatch) {
      return {
        type: 'ambiguous',
        candidateIds: [...matchedCandidateIds].sort((left, right) => left.localeCompare(right)),
      };
    }

    if (bestMatch === undefined) {
      return { type: 'none' };
    }

    return { type: 'match', agent: bestMatch.agent };
  }

  private findAgentByAsDirective(
    text: string | undefined,
    candidates: AgentDefinition[],
  ): MentionMatch {
    const asAgentInput = extractAsAgentName(text);
    if (asAgentInput === undefined) {
      return { type: 'none' };
    }

    const normalizedInput = normalizeForMatch(asAgentInput);
    if (normalizedInput.length === 0) {
      return { type: 'none' };
    }

    const matches = candidates.filter((agent) =>
      getAgentMatchKeys(agent).some((key) => normalizeForMatch(key) === normalizedInput),
    );

    if (matches.length === 0) {
      return { type: 'none' };
    }
    if (matches.length > 1) {
      return {
        type: 'ambiguous',
        candidateIds: matches
          .map((agent) => agent.id)
          .sort((left, right) => left.localeCompare(right)),
      };
    }

    return { type: 'match', agent: matches[0] as AgentDefinition };
  }
}

export function buildConciergeResponse(registry: AgentRegistry): SlackBlock[] {
  const availableAgents = registry.getAll().filter((agent) => agent.enabled);
  const listedAgents =
    availableAgents.length === 0
      ? '• (사용 가능한 에이전트가 없습니다)'
      : availableAgents
          .map((agent) => {
            const description = agent.description?.trim();
            const details =
              description !== undefined && description.length > 0
                ? description
                : '설명 없음';
            return `• *${agent.displayName}* (\`${agent.id}\`) - ${details}`;
          })
          .join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '이 채널에 배정된 에이전트가 없습니다.',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*사용 가능한 에이전트 목록*\n${listedAgents}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '/nakama assign {agent} 명령어로 에이전트를 배정하세요',
        },
      ],
    },
  ];
}

type MentionMatch =
  | { type: 'none' }
  | { type: 'match'; agent: AgentDefinition }
  | { type: 'ambiguous'; candidateIds: string[] };

function getAgentMatchKeys(agent: AgentDefinition): string[] {
  const keys = [agent.slackDisplayName, agent.displayName, agent.id]
    .map((value) => value?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0);

  return [...new Set(keys)];
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function containsWholePhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function extractAsAgentName(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }

  const match = text.match(/(?:^|\s)\/as\s+([^\s]+)/iu);
  if (match === null) {
    return undefined;
  }

  const candidate = match[1]?.trim() ?? '';
  if (candidate.length === 0) {
    return undefined;
  }

  return candidate.replace(/^[^\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+$/gu, '');
}

function getChannelMode(agent: AgentDefinition, channelId: string): 'mention' | 'proactive' {
  return agent.channels[channelId]?.mode ?? 'mention';
}
