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
      if (byAgentName !== undefined) {
        return { agent: byAgentName, threadTs };
      }

      if (event.botUserId !== undefined) {
        const byBotUserId = this.registry.findByBotUserId(event.botUserId);
        if (byBotUserId !== undefined) {
          return { agent: byBotUserId, threadTs };
        }
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
    if (byMention !== undefined) {
      return byMention;
    }

    return channelAgents[0];
  }

  private findAgentByMentionedName(
    text: string | undefined,
    candidates: AgentDefinition[],
  ): AgentDefinition | undefined {
    if (text === undefined) {
      return undefined;
    }

    const normalizedText = normalizeForMatch(text);
    if (normalizedText.length === 0) {
      return undefined;
    }

    let bestMatch: { agent: AgentDefinition; keyLength: number } | undefined;
    for (const agent of candidates) {
      for (const key of getAgentMatchKeys(agent)) {
        const normalizedKey = normalizeForMatch(key);
        if (normalizedKey.length === 0 || !containsWholePhrase(normalizedText, normalizedKey)) {
          continue;
        }

        if (bestMatch === undefined || normalizedKey.length > bestMatch.keyLength) {
          bestMatch = { agent, keyLength: normalizedKey.length };
        }
      }
    }

    return bestMatch?.agent;
  }
}

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
