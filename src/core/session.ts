import type { Message } from '@mariozechner/pi-ai';
import { getModel } from '@mariozechner/pi-ai';
import {
  type AgentSession,
  type AgentSessionEvent,
  codingTools,
  createAgentSession,
  SessionManager as PiSessionManager,
} from '@mariozechner/pi-coding-agent';

import type {
  AgentDefinition,
  AppConfig,
  SessionMessageContext,
  SessionState,
  SessionStatus,
} from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { buildSystemPrompt } from './memory.js';
import type { AgentRegistry } from './registry.js';
import type { UsageTracker } from './usage.js';

interface QueuedMessage {
  message: string;
  context: SessionMessageContext;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

interface SessionRuntime {
  state: SessionState;
  queue: QueuedMessage[];
  processing: boolean;
  idleTimer?: NodeJS.Timeout;
  piSession?: AgentSession;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly config: AppConfig,
    private readonly logger: Logger = createLogger('SessionManager'),
    private readonly usageTracker?: UsageTracker,
  ) {}

  async handleMessage(
    agentId: string,
    message: string,
    context: SessionMessageContext,
  ): Promise<string> {
    const agent = this.registry.getById(agentId);
    if (agent === undefined) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const runtime = this.ensureSession(agent, context);

    if (runtime.queue.length >= this.config.session.maxQueueSize) {
      return 'Agent is currently busy. Please try again in a moment.';
    }

    return new Promise<string>((resolve, reject) => {
      runtime.queue.push({ message, context, resolve, reject });
      runtime.state.queueDepth = runtime.queue.length;
      runtime.state.lastActivityAt = new Date();
      void this.processQueue(agent, runtime);
    });
  }

  getActiveSession(agentId: string): SessionState | undefined {
    return this.sessions.get(agentId)?.state;
  }

  getAllSessions(): SessionState[] {
    return [...this.sessions.values()].map((runtime) => runtime.state);
  }

  getSessionByThreadTs(threadTs: string): SessionState | undefined {
    return [...this.sessions.values()]
      .map((runtime) => runtime.state)
      .find((state) => state.threadTs === threadTs);
  }

  resolveAgentIdByThread(threadTs: string): string | undefined {
    return this.getSessionByThreadTs(threadTs)?.agentId;
  }

  async disposeSession(agentId: string): Promise<void> {
    const runtime = this.sessions.get(agentId);
    if (runtime === undefined) {
      return;
    }

    if (runtime.idleTimer !== undefined) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = undefined;
    }

    runtime.state.status = 'disposed';
    runtime.state.lastActivityAt = new Date();

    // Clean up Pi SDK session
    runtime.piSession = undefined;

    this.sessions.delete(agentId);

    this.logger.info('Session disposed', { agentId });
  }

  private ensureSession(agent: AgentDefinition, context: SessionMessageContext): SessionRuntime {
    const existing = this.sessions.get(agent.id);
    if (existing !== undefined) {
      this.touchIdleTimer(agent.id, existing);
      if (context.slackThreadTs !== undefined) {
        existing.state.threadTs = context.slackThreadTs;
        this.registry.registerThread(context.slackThreadTs, agent.id);
      }
      return existing;
    }

    const runtime: SessionRuntime = {
      state: {
        agentId: agent.id,
        threadTs: context.slackThreadTs,
        status: 'idle',
        queueDepth: 0,
        lastActivityAt: new Date(),
      },
      queue: [],
      processing: false,
    };

    if (context.slackThreadTs !== undefined) {
      this.registry.registerThread(context.slackThreadTs, agent.id);
    }

    this.sessions.set(agent.id, runtime);
    this.touchIdleTimer(agent.id, runtime);
    return runtime;
  }

  private touchIdleTimer(agentId: string, runtime: SessionRuntime): void {
    if (runtime.idleTimer !== undefined) {
      clearTimeout(runtime.idleTimer);
    }

    const idleTimeoutMs = this.config.session.idleTimeoutMin * 60_000;
    runtime.idleTimer = setTimeout(() => {
      void this.disposeSession(agentId).catch((error: unknown) => {
        this.logger.error('Failed to dispose timed-out session', {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, idleTimeoutMs);
  }

  private async processQueue(agent: AgentDefinition, runtime: SessionRuntime): Promise<void> {
    if (runtime.processing) {
      return;
    }

    runtime.processing = true;

    // Suspend idle timer while processing to prevent disposal mid-turn
    if (runtime.idleTimer !== undefined) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = undefined;
    }

    while (runtime.queue.length > 0) {
      const item = runtime.queue.shift();
      if (item === undefined) {
        break;
      }

      runtime.state.queueDepth = runtime.queue.length;
      runtime.state.status = 'running';
      runtime.state.lastActivityAt = new Date();

      try {
        const response = await this.runAgentTurn(agent, item.message, item.context, runtime);
        runtime.state.status = 'idle';
        runtime.state.error = undefined;
        runtime.state.lastActivityAt = new Date();
        item.resolve(response);
      } catch (error) {
        runtime.state.status = 'error';
        runtime.state.error = error instanceof Error ? error.message : String(error);
        runtime.state.lastActivityAt = new Date();
        item.reject(error);
      }
    }

    runtime.processing = false;
    this.touchIdleTimer(agent.id, runtime);
    runtime.state.queueDepth = runtime.queue.length;
  }

  private async getOrCreatePiSession(
    agent: AgentDefinition,
    runtime: SessionRuntime,
  ): Promise<AgentSession> {
    if (runtime.piSession !== undefined) {
      return runtime.piSession;
    }

    const systemPrompt = await buildSystemPrompt(agent);
    const modelSpec = agent.model ?? this.config.llm.defaultModel;
    const [provider, modelId] = parseModelSpec(modelSpec, this.config.llm.provider);

    const model = getModel(provider as any, modelId as any);

    const { session } = await createAgentSession({
      cwd: agent.workspacePath,
      model,
      tools: codingTools,
      sessionManager: PiSessionManager.inMemory(agent.workspacePath),
    });

    session.agent.setSystemPrompt(systemPrompt);

    runtime.piSession = session;

    this.logger.info('Pi SDK session created', {
      agentId: agent.id,
      model: modelSpec,
      promptChars: systemPrompt.length,
    });

    return session;
  }

  private recordUsageFromMessages(agent: AgentDefinition, messages: readonly unknown[]): void {
    if (!this.usageTracker) return;

    // Walk backwards to find assistant messages from the latest turn
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as Record<string, unknown>;
      if (msg.role !== 'assistant') break;
      const usage = msg.usage as { input?: number; output?: number; totalTokens?: number } | undefined;
      if (usage && (usage.input || usage.output)) {
        try {
          this.usageTracker.record({
            agentId: agent.id,
            timestamp: Date.now(),
            inputTokens: usage.input ?? 0,
            outputTokens: usage.output ?? 0,
            model: (msg.model as string) ?? agent.model ?? 'unknown',
          });
        } catch (err) {
          this.logger.error('Failed to record usage', {
            agentId: agent.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  private async runAgentTurn(
    agent: AgentDefinition,
    message: string,
    context: SessionMessageContext,
    runtime: SessionRuntime,
  ): Promise<string> {
    const session = await this.getOrCreatePiSession(agent, runtime);

    this.logger.info('Sending message to Pi SDK agent', {
      agentId: agent.id,
      channelId: context.slackChannelId,
      hasThread: context.slackThreadTs !== undefined,
      messageLength: message.length,
    });

    await session.prompt(message);

    // Record usage from all new assistant messages
    this.recordUsageFromMessages(agent, session.state.messages as unknown as readonly unknown[]);

    const messages = session.state.messages;
    const lastMessage = messages[messages.length - 1];

    if (lastMessage === undefined || lastMessage.role !== 'assistant') {
      return '(No response from agent)';
    }

    const assistantMsg = lastMessage as Message & { role: 'assistant' };
    if ('stopReason' in assistantMsg) {
      const stopReason = (assistantMsg as unknown as Record<string, unknown>).stopReason;
      if (stopReason === 'error' || stopReason === 'aborted') {
        const errorMsg = (assistantMsg as unknown as Record<string, unknown>).errorMessage;
        throw new Error(typeof errorMsg === 'string' ? errorMsg : `Agent ${String(stopReason)}`);
      }
    }

    return extractTextFromMessage(lastMessage);
  }
}

function parseModelSpec(spec: string, fallbackProvider: string): [string, string] {
  const slashIndex = spec.indexOf('/');
  if (slashIndex > 0) {
    return [spec.slice(0, slashIndex), spec.slice(slashIndex + 1)];
  }
  return [fallbackProvider, spec];
}

function extractTextFromMessage(message: unknown): string {
  const msg = message as Record<string, unknown>;

  if (typeof msg.content === 'string') {
    return msg.content;
  }

  if (Array.isArray(msg.content)) {
    const textParts: string[] = [];
    for (const part of msg.content) {
      if (typeof part === 'object' && part !== null && 'type' in part) {
        const typed = part as Record<string, unknown>;
        if (typed.type === 'text' && typeof typed.text === 'string') {
          textParts.push(typed.text);
        }
      }
    }
    if (textParts.length > 0) {
      return textParts.join('');
    }
  }

  return '(No text content in response)';
}

export function isSessionRunning(state: SessionState): boolean {
  return state.status === 'running';
}

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return status === 'disposed' || status === 'error';
}
