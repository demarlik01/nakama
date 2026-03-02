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

    if (event.type === 'app_mention' && event.botUserId !== undefined) {
      const byMention = this.registry.findByBotUserId(event.botUserId);
      if (byMention !== undefined) {
        return { agent: byMention, threadTs };
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
      const first = channelAgents[0];
      if (first !== undefined) {
        // TODO: Support disambiguation when multiple agents are mapped to the same channel.
        return { agent: first, threadTs };
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
}