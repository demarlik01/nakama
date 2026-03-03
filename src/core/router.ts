import type { AgentDefinition, MessageRouteResult, SlackMessageEvent } from '../types.js';
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

    if (threadTs !== undefined) {
      const bySession = this.sessionManager.resolveAgentIdByThread(threadTs);
      if (bySession !== undefined) {
        const sessionAgent = this.registry.getById(bySession);
        if (sessionAgent !== undefined) {
          return { agent: sessionAgent, threadTs };
        }
      }

      const byRegistry = this.registry.findByThread(threadTs);
      if (byRegistry !== undefined) {
        return { agent: byRegistry, threadTs };
      }
    }

    if (event.type === 'app_mention') {
      const byAgentName = this.findAgentByMentionedName(
        event.text,
        this.registry.getAll().filter((agent) => agent.enabled),
      );
      if (byAgentName.type === 'match') {
        return { agent: byAgentName.agent, threadTs };
      }

      if (event.botUserId !== undefined) {
        const byBotUserId = this.registry.findByBotUserId(event.botUserId);
        if (byBotUserId !== undefined) {
          return { agent: byBotUserId, threadTs };
        }
      }

      if (byAgentName.type === 'ambiguous') {
        this.logger.debug('Skipping route for ambiguous app mention', {
          text: event.text,
          candidateIds: byAgentName.candidateIds,
        });
        return null;
      }
    }

    const channelType = event.channelType ?? event.channel_type;
    if (channelType === 'im' && event.user !== undefined) {
      const byDm = this.registry.findBySlackUser(event.user);
      if (byDm !== undefined) {
        return { agent: byDm, threadTs };
      }
    }

    if (event.channel !== undefined) {
      const channelAgents = this.registry.findBySlackChannel(event.channel);
      const selected = this.selectChannelAgent(channelAgents, event.user, event.text);
      if (selected !== undefined) {
        return { agent: selected, threadTs };
      }
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
