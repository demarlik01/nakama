import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Message } from '@mariozechner/pi-ai';
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
  SessionMode,
  SessionState,
  SessionStatus,
} from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { buildSystemPrompt } from './memory.js';
import type { AgentRegistry } from './registry.js';
import type { UsageTracker } from './usage.js';
import type { SSEManager } from '../api/sse.js';
import type { Notifier } from './notifier.js';
import { getAgentSessionDir, listPersistedSessions } from './session-files.js';
import {
  type LlmProvider,
  type PiSessionLlmProvider,
  supportsPiSession,
} from './llm/provider.js';
import { createLlmProvider } from './llm/factory.js';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import {
  createWebSearchTool,
  createWebFetchTool,
  createMemoryReadTool,
  createMemoryWriteTool,
} from '../tools/index.js';

interface QueuedMessage {
  message: string;
  context: SessionMessageContext;
  images?: import('@mariozechner/pi-ai').ImageContent[];
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

interface SessionRuntime {
  state: SessionState;
  queue: QueuedMessage[];
  processing: boolean;
  idleTimer?: NodeJS.Timeout;
  piSession?: AgentSession;
  sessionFilePath?: string;
  sessionId?: string;
}

const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_GC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOG_REDACTED = '[REDACTED]';

/**
 * Resolve the effective session mode for an agent.
 * Default is 'per-thread' when not specified.
 */
export function resolveSessionMode(agent: AgentDefinition): SessionMode {
  return agent.sessionMode ?? 'per-thread';
}

/**
 * Get the main (single) session key for an agent.
 * Used by heartbeat and cron which always operate on the primary session.
 */
export function getMainSessionKey(agentId: string): string {
  return agentId;
}

/**
 * Generate a composite session key based on the agent's session mode.
 *
 * - `single`      → `agentId`
 * - `per-channel`  → `agentId:channelId`
 * - `per-thread`   → `agentId:threadTs` (falls back to per-channel if no thread)
 */
export function buildSessionKey(
  agent: AgentDefinition,
  context: SessionMessageContext,
): string {
  const mode = resolveSessionMode(agent);
  switch (mode) {
    case 'single':
      return agent.id;
    case 'per-channel':
      return `${agent.id}:${context.slackChannelId}`;
    case 'per-thread': {
      if (context.slackThreadTs !== undefined) {
        return `${agent.id}:${context.slackThreadTs}`;
      }
      // Fallback to per-channel when there's no thread
      return `${agent.id}:${context.slackChannelId}`;
    }
    default:
      return agent.id;
  }
}
const SECRET_VALUE_PATTERNS = [
  /\bxox[baprs]-[A-Za-z0-9-]+\b/g,
  /\bxapp-[A-Za-z0-9-]+\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
];

export class SessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly cleanupTimer?: NodeJS.Timeout;
  private gcTimer?: NodeJS.Timeout;
  private cleanupAgentAddedListener?: (agent: AgentDefinition) => void;
  private lastCleanupAt = 0;
  private readonly llmProvider: PiSessionLlmProvider;

  private sseManager?: SSEManager;
  private notifier?: Notifier;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly config: AppConfig,
    private readonly logger: Logger = createLogger('SessionManager'),
    private readonly usageTracker?: UsageTracker,
    llmProvider?: LlmProvider,
  ) {
    const provider =
      llmProvider ??
      createLlmProvider({
        implementation: this.config.llm.implementation,
        provider: this.config.llm.provider,
        auth: this.config.llm.auth,
      });

    if (!supportsPiSession(provider)) {
      throw new Error(
        `LLM implementation "${provider.implementation}" does not support Pi sessions`,
      );
    }
    this.llmProvider = provider;

    if (this.config.session.ttlDays > 0) {
      this.cleanupTimer = setInterval(() => {
        this.maybeCleanupExpiredSessions();
      }, SESSION_CLEANUP_INTERVAL_MS);
      this.cleanupTimer.unref?.();
      this.cleanupAgentAddedListener = () => {
        this.maybeCleanupExpiredSessions();
      };
      this.registry.on('agent:added', this.cleanupAgentAddedListener);
      this.maybeCleanupExpiredSessions();
    }

    // Start GC timer for per-channel/per-thread sessions
    this.gcTimer = setInterval(() => {
      this.gcExpiredSessions();
    }, SESSION_GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  setSSEManager(sse: SSEManager): void {
    this.sseManager = sse;
  }

  setNotifier(notifier: Notifier): void {
    this.notifier = notifier;
  }

  async initialize(): Promise<void> {
    if (this.config.session.ttlDays > 0) {
      await this.cleanupExpiredSessions().catch((error: unknown) => {
        this.logger.error('Failed to clean up expired session files during startup', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      this.lastCleanupAt = Date.now();
    }

    await this.restorePersistedSessions();
  }

  stop(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
    }

    if (this.gcTimer !== undefined) {
      clearInterval(this.gcTimer);
      this.gcTimer = undefined;
    }

    if (this.cleanupAgentAddedListener !== undefined) {
      this.registry.off('agent:added', this.cleanupAgentAddedListener);
      this.cleanupAgentAddedListener = undefined;
    }
  }

  /**
   * Send a message to the agent's main (single) session.
   * Used by heartbeat and cron — always routes to the primary session
   * regardless of the agent's sessionMode setting.
   */
  async handleMainSessionMessage(
    agentId: string,
    message: string,
    context: SessionMessageContext,
    images?: import('@mariozechner/pi-ai').ImageContent[],
  ): Promise<string> {
    return this.handleMessageInternal(agentId, message, context, images, getMainSessionKey(agentId));
  }

  async handleMessage(
    agentId: string,
    message: string,
    context: SessionMessageContext,
    images?: import('@mariozechner/pi-ai').ImageContent[],
  ): Promise<string> {
    const agent = this.registry.getById(agentId);
    if (agent === undefined) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return this.handleMessageInternal(agentId, message, context, images, buildSessionKey(agent, context));
  }

  private async handleMessageInternal(
    agentId: string,
    message: string,
    context: SessionMessageContext,
    images: import('@mariozechner/pi-ai').ImageContent[] | undefined,
    sessionKey: string,
  ): Promise<string> {
    const agent = this.registry.getById(agentId);
    if (agent === undefined) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.maybeCleanupExpiredSessions();
    const runtime = this.ensureSession(agent, context, sessionKey);

    if (runtime.queue.length >= this.config.session.maxQueueSize) {
      return 'Agent is currently busy. Please try again in a moment.';
    }

    this.sseManager?.emit('session:message', {
      agentId,
      sessionKey,
      role: 'user',
      preview: message.slice(0, 200),
    });

    return new Promise<string>((resolve, reject) => {
      runtime.queue.push({ message, context, images, resolve, reject });
      runtime.state.queueDepth = runtime.queue.length;
      runtime.state.lastActivityAt = new Date();
      this.logger.info('Queued message for Pi SDK agent', {
        agentId,
        sessionKey,
        channelId: context.slackChannelId,
        slackUserId: context.slackUserId,
        hasThread: context.slackThreadTs !== undefined,
        queueDepth: runtime.queue.length,
        messageLength: message.length,
      });
      this.logger.debug('Queued message for Pi SDK agent (payload)', {
        agentId,
        sessionKey,
        channelId: context.slackChannelId,
        slackUserId: context.slackUserId,
        hasThread: context.slackThreadTs !== undefined,
        queueDepth: runtime.queue.length,
        inboundMessage: redactSensitiveLogText(message),
      });
      void this.processQueue(agent, runtime, sessionKey);
    });
  }

  /**
   * Get the current message count for an agent's session.
   * Used by HeartbeatRunner to track pre-heartbeat state for pruning.
   * Looks up by sessionKey first, falls back to agentId (single mode).
   */
  getMessageCount(agentId: string, sessionKey?: string): number {
    const runtime = this.sessions.get(sessionKey ?? agentId);
    return (runtime?.piSession?.state.messages as unknown[] | undefined)?.length ?? 0;
  }

  /**
   * Remove messages from an agent's session starting at the given index.
   * Used to prune HEARTBEAT_OK turns from transcript to save tokens.
   * NOTE: This only prunes in-memory state. The .jsonl file retains entries
   * but they won't be sent to the LLM in subsequent turns.
   */
  pruneMessagesFrom(agentId: string, fromIndex: number, sessionKey?: string): number {
    const runtime = this.sessions.get(sessionKey ?? agentId);
    if (!runtime?.piSession) return 0;

    const messages = runtime.piSession.state.messages as unknown[];
    const toRemove = messages.length - fromIndex;
    if (toRemove > 0) {
      messages.splice(fromIndex);
    }
    return Math.max(0, toRemove);
  }

  /**
   * Prune only the last heartbeat turn from transcript.
   * Walks backward from the end to find and remove the heartbeat user prompt
   * and assistant HEARTBEAT_OK response, without touching other messages.
   */
  pruneHeartbeatTurn(agentId: string, currentLength: number, sessionKey?: string): number {
    const runtime = this.sessions.get(sessionKey ?? agentId);
    if (!runtime?.piSession) return 0;

    const messages = runtime.piSession.state.messages as Array<{ role?: string; content?: unknown }>;
    if (messages.length === 0) return 0;

    // Walk backward to find the heartbeat assistant response
    let endIdx = messages.length;
    let removed = 0;

    // Remove trailing assistant message(s) that are HEARTBEAT_OK
    while (endIdx > 0) {
      const msg = messages[endIdx - 1];
      if (msg?.role === 'assistant') {
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text.trim().startsWith('HEARTBEAT_OK')) {
          endIdx--;
          removed++;
          continue;
        }
      }
      break;
    }

    // Remove the user message that triggered the heartbeat (immediately before)
    if (endIdx > 0 && removed > 0) {
      const msg = messages[endIdx - 1];
      if (msg?.role === 'user') {
        endIdx--;
        removed++;
      }
    }

    if (removed > 0) {
      messages.splice(endIdx, removed);
    }

    return removed;
  }

  /**
   * Run an isolated agent turn (for cron jobs with sessionTarget: "isolated").
   * Creates a temporary session, runs the message, and returns the response.
   * The session is NOT persisted as the main session.
   */
  async runIsolatedTurn(
    agentId: string,
    message: string,
    options?: { model?: string },
  ): Promise<string> {
    const agent = this.registry.getById(agentId);
    if (agent === undefined) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const systemPrompt = await buildSystemPrompt(agent);
    const modelSpec = options?.model ?? agent.model ?? this.config.llm.defaultModel;
    const resolvedModel = this.llmProvider.resolveModel(modelSpec);

    // Use in-memory session for true isolation — no file persistence,
    // no contamination of or from the main session history.
    const sessionManager = PiSessionManager.inMemory();
    const customTools = this.buildCustomTools(agent);

    const { session } = await createAgentSession({
      cwd: agent.workspacePath,
      model: resolvedModel.model,
      tools: codingTools,
      customTools,
      sessionManager,
    });

    session.agent.setSystemPrompt(systemPrompt);
    await session.prompt(message);

    // Record usage
    this.recordUsageFromMessages(agent, {
      state: { agentId, sessionKey: `isolated:${agentId}`, status: 'idle', queueDepth: 0, lastActivityAt: new Date() },
      queue: [],
      processing: false,
    }, session.state.messages as unknown as readonly unknown[]);

    const messages = session.state.messages;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage === undefined || lastMessage.role !== 'assistant') {
      return '(No response from agent)';
    }

    return extractTextFromMessage(lastMessage);
  }

  /**
   * Get the active session by agent ID.
   * For agents with `single` mode, this returns the single session.
   * For multi-session modes, returns the first session found for this agent.
   */
  getActiveSession(agentId: string): SessionState | undefined {
    // Direct key lookup first (single mode)
    const direct = this.sessions.get(agentId);
    if (direct !== undefined) return direct.state;

    // Search through all sessions for this agent
    for (const runtime of this.sessions.values()) {
      if (runtime.state.agentId === agentId) {
        return runtime.state;
      }
    }
    return undefined;
  }

  /**
   * Get all sessions for a specific agent.
   */
  getSessionsForAgent(agentId: string): SessionState[] {
    const results: SessionState[] = [];
    for (const runtime of this.sessions.values()) {
      if (runtime.state.agentId === agentId) {
        results.push(runtime.state);
      }
    }
    return results;
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

  private async restorePersistedSessions(): Promise<void> {
    const agents = this.registry.getAll();
    if (agents.length === 0) {
      return;
    }

    let restoredCount = 0;

    for (const agent of agents) {
      // For restoration, use the agent's single key (agentId).
      // Multi-session modes will create new sessions as messages arrive.
      const sessionKey = agent.id;
      if (this.sessions.has(sessionKey)) {
        continue;
      }

      try {
        const persisted = await listPersistedSessions(agent);
        const latest = persisted[0];
        if (latest === undefined) {
          continue;
        }

        const runtime: SessionRuntime = {
          state: {
            agentId: agent.id,
            sessionKey,
            status: 'idle',
            queueDepth: 0,
            lastActivityAt: new Date(latest.modifiedAt),
            sessionId: latest.sessionId,
          },
          queue: [],
          processing: false,
          sessionFilePath: latest.filePath,
          sessionId: latest.sessionId,
        };

        this.sessions.set(sessionKey, runtime);
        this.touchIdleTimer(sessionKey, runtime);
        restoredCount += 1;
      } catch (error: unknown) {
        this.logger.error('Failed to restore persisted session', {
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (restoredCount > 0) {
      this.logger.info('Persisted sessions restored', {
        restoredCount,
        totalAgents: agents.length,
      });
    }
  }

  /**
   * Dispose a session by session key or agent ID.
   * When called with just agentId, disposes ALL sessions for that agent.
   */
  async disposeSession(agentId: string, sessionKey?: string): Promise<void> {
    if (sessionKey !== undefined) {
      this.disposeSessionByKey(sessionKey);
      return;
    }

    // Dispose all sessions for this agent (backward compatibility)
    const keysToDispose: string[] = [];
    for (const [key, runtime] of this.sessions) {
      if (runtime.state.agentId === agentId) {
        keysToDispose.push(key);
      }
    }

    // Also check direct key
    if (this.sessions.has(agentId) && !keysToDispose.includes(agentId)) {
      keysToDispose.push(agentId);
    }

    for (const key of keysToDispose) {
      this.disposeSessionByKey(key);
    }
  }

  private disposeSessionByKey(sessionKey: string): void {
    const runtime = this.sessions.get(sessionKey);
    if (runtime === undefined) {
      return;
    }

    if (runtime.state.threadTs !== undefined) {
      this.registry.clearThread(runtime.state.threadTs);
      runtime.state.threadTs = undefined;
    }

    if (runtime.idleTimer !== undefined) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = undefined;
    }

    runtime.state.status = 'disposed';
    runtime.state.lastActivityAt = new Date();

    // Clean up Pi SDK session
    runtime.piSession = undefined;
    runtime.sessionFilePath = undefined;
    runtime.sessionId = undefined;
    runtime.state.sessionId = undefined;

    const agentId = runtime.state.agentId;
    this.sessions.delete(sessionKey);

    this.sseManager?.emit('session:end', { agentId, sessionKey });
    this.sseManager?.emit('agent:status', { agentId, status: 'disposed' });

    this.logger.info('Session disposed', { agentId, sessionKey });
  }

  private ensureSession(
    agent: AgentDefinition,
    context: SessionMessageContext,
    sessionKey: string,
  ): SessionRuntime {
    const existing = this.sessions.get(sessionKey);
    if (existing !== undefined) {
      this.touchIdleTimer(sessionKey, existing);
      if (context.slackThreadTs !== undefined) {
        if (
          existing.state.threadTs !== undefined &&
          existing.state.threadTs !== context.slackThreadTs
        ) {
          this.registry.clearThread(existing.state.threadTs);
        }
        existing.state.threadTs = context.slackThreadTs;
        this.registry.registerThread(context.slackThreadTs, agent.id);
      }
      return existing;
    }

    const runtime: SessionRuntime = {
      state: {
        agentId: agent.id,
        sessionKey,
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

    this.sessions.set(sessionKey, runtime);
    this.touchIdleTimer(sessionKey, runtime);

    this.sseManager?.emit('session:start', {
      agentId: agent.id,
      sessionKey,
      threadTs: context.slackThreadTs,
    });
    this.sseManager?.emit('agent:status', {
      agentId: agent.id,
      status: 'idle',
    });

    return runtime;
  }

  private touchIdleTimer(sessionKey: string, runtime: SessionRuntime): void {
    if (runtime.idleTimer !== undefined) {
      clearTimeout(runtime.idleTimer);
    }

    const idleTimeoutMs = this.config.session.idleTimeoutMin * 60_000;
    runtime.idleTimer = setTimeout(() => {
      void this.disposeSession(runtime.state.agentId, sessionKey).catch((error: unknown) => {
        this.logger.error('Failed to dispose timed-out session', {
          agentId: runtime.state.agentId,
          sessionKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, idleTimeoutMs);
  }

  private async processQueue(agent: AgentDefinition, runtime: SessionRuntime, sessionKey: string): Promise<void> {
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

      this.sseManager?.emit('agent:status', {
        agentId: agent.id,
        status: 'running',
      });

      try {
        const response = await this.runAgentTurn(agent, item.message, item.context, runtime, item.images);
        runtime.state.status = 'idle';
        runtime.state.error = undefined;
        runtime.state.lastActivityAt = new Date();

        this.sseManager?.emit('agent:status', {
          agentId: agent.id,
          status: 'idle',
        });
        this.sseManager?.emit('session:message', {
          agentId: agent.id,
          sessionKey,
          role: 'assistant',
          preview: typeof response === 'string' ? response.slice(0, 200) : '',
        });

        item.resolve(response);
      } catch (error) {
        runtime.state.status = 'error';
        runtime.state.error = error instanceof Error ? error.message : String(error);
        runtime.state.lastActivityAt = new Date();

        this.sseManager?.emit('agent:status', {
          agentId: agent.id,
          status: 'error',
          error: runtime.state.error,
        });

        // Notify admin of error
        if (this.notifier) {
          const agentDef = this.registry.getById(agent.id);
          void this.notifier.notifyError({
            agentId: agent.id,
            agentName: agentDef?.displayName ?? agent.id,
            error: runtime.state.error ?? 'Unknown error',
            timestamp: new Date(),
            channel:
              agentDef?.notifyChannel ??
              agentDef?.errorNotificationChannel ??
              agent.notifyChannel ??
              agent.errorNotificationChannel,
          });
        }

        item.reject(error);
      }
    }

    runtime.processing = false;
    this.touchIdleTimer(sessionKey, runtime);
    runtime.state.queueDepth = runtime.queue.length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildCustomTools(agent: AgentDefinition): ToolDefinition<any>[] {
    const toolNames = agent.tools ?? ['coding'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customTools: ToolDefinition<any>[] = [];

    for (const toolName of toolNames) {
      switch (toolName) {
        case 'coding':
          // Built-in tools are already passed via `tools: codingTools`
          break;
        case 'web_search': {
          const braveApiKey = this.config.tools?.webSearch?.braveApiKey;
          if (braveApiKey) {
            customTools.push(createWebSearchTool({ braveApiKey }));
          } else {
            this.logger.warn('web_search tool requested but tools.webSearch.braveApiKey not configured', {
              agentId: agent.id,
            });
          }
          break;
        }
        case 'web_fetch':
          customTools.push(createWebFetchTool());
          break;
        case 'memory':
          customTools.push(createMemoryReadTool(agent.workspacePath));
          customTools.push(createMemoryWriteTool(agent.workspacePath));
          break;
        default:
          this.logger.warn('Unknown tool name in agent config', {
            agentId: agent.id,
            toolName,
          });
      }
    }

    return customTools;
  }

  private async getOrCreatePiSession(
    agent: AgentDefinition,
    runtime: SessionRuntime,
  ): Promise<AgentSession> {
    if (runtime.piSession !== undefined) {
      return runtime.piSession;
    }

    const systemPrompt = await buildSystemPrompt(agent);
    this.logger.debug('System prompt prepared for Pi SDK session', {
      agentId: agent.id,
      promptChars: systemPrompt.length,
      systemPrompt: redactSensitiveLogText(systemPrompt),
    });
    const modelSpec = agent.model ?? this.config.llm.defaultModel;
    const resolvedModel = this.llmProvider.resolveModel(modelSpec);
    const sessionDir = getAgentSessionDir(agent);

    let sessionManager = PiSessionManager.continueRecent(agent.workspacePath, sessionDir);

    const persistedSessionFilePath = runtime.sessionFilePath;
    if (typeof persistedSessionFilePath === 'string' && persistedSessionFilePath.length > 0) {
      try {
        sessionManager = PiSessionManager.open(persistedSessionFilePath, sessionDir);
      } catch (error: unknown) {
        runtime.sessionFilePath = undefined;
        runtime.sessionId = undefined;
        runtime.state.sessionId = undefined;
        this.logger.warn('Failed to reopen persisted session file; creating recent session instead', {
          agentId: agent.id,
          sessionFilePath: persistedSessionFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const customTools = this.buildCustomTools(agent);

    const { session } = await createAgentSession({
      cwd: agent.workspacePath,
      model: resolvedModel.model,
      tools: codingTools,
      customTools,
      sessionManager,
    });

    session.agent.setSystemPrompt(systemPrompt);

    runtime.piSession = session;
    runtime.sessionFilePath = session.sessionFile ?? runtime.sessionFilePath;
    runtime.sessionId = session.sessionId ?? resolveSessionIdFromFilePath(runtime.sessionFilePath);
    runtime.state.sessionId = runtime.sessionId;

    this.logger.info('Pi SDK session created', {
      agentId: agent.id,
      model: resolvedModel.modelSpec,
      provider: resolvedModel.provider,
      sessionId: runtime.sessionId,
      promptChars: systemPrompt.length,
    });

    return session;
  }

  private recordUsageFromMessages(
    agent: AgentDefinition,
    runtime: SessionRuntime,
    messages: readonly unknown[],
  ): void {
    if (!this.usageTracker) return;
    const sessionId = this.resolveRuntimeSessionId(runtime);

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
            sessionId,
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
    images?: import('@mariozechner/pi-ai').ImageContent[],
  ): Promise<string> {
    const session = await this.getOrCreatePiSession(agent, runtime);

    const promptOptions = images !== undefined && images.length > 0 ? { images } : undefined;
    await session.prompt(message, promptOptions);

    // Record usage from all new assistant messages
    this.recordUsageFromMessages(
      agent,
      runtime,
      session.state.messages as unknown as readonly unknown[],
    );

    const messages = session.state.messages;
    const lastMessage = messages[messages.length - 1];

    if (lastMessage === undefined || lastMessage.role !== 'assistant') {
      const fallback = '(No response from agent)';
      this.logAgentResponse(agent.id, context, fallback);
      return fallback;
    }

    const assistantMsg = lastMessage as Message & { role: 'assistant' };
    if ('stopReason' in assistantMsg) {
      const stopReason = (assistantMsg as unknown as Record<string, unknown>).stopReason;
      if (stopReason === 'error' || stopReason === 'aborted') {
        const errorMsg = (assistantMsg as unknown as Record<string, unknown>).errorMessage;
        throw new Error(typeof errorMsg === 'string' ? errorMsg : `Agent ${String(stopReason)}`);
      }
    }

    const responseText = extractTextFromMessage(lastMessage);
    this.logAgentResponse(agent.id, context, responseText);
    return responseText;
  }

  private logAgentResponse(
    agentId: string,
    context: SessionMessageContext,
    responseText: string,
  ): void {
    this.logger.info('Received response from Pi SDK agent', {
      agentId,
      channelId: context.slackChannelId,
      hasThread: context.slackThreadTs !== undefined,
      responseLength: responseText.length,
    });
    this.logger.debug('Received response from Pi SDK agent (payload)', {
      agentId,
      channelId: context.slackChannelId,
      hasThread: context.slackThreadTs !== undefined,
      response: redactSensitiveLogText(responseText),
    });
  }

  private resolveRuntimeSessionId(runtime: SessionRuntime): string | undefined {
    if (typeof runtime.sessionId === 'string' && runtime.sessionId.length > 0) {
      return runtime.sessionId;
    }

    const sessionFile = runtime.piSession?.sessionFile ?? runtime.sessionFilePath;
    if (typeof runtime.piSession?.sessionFile === 'string' && runtime.piSession.sessionFile.length > 0) {
      runtime.sessionFilePath = runtime.piSession.sessionFile;
    }

    const resolved =
      (runtime.piSession?.sessionId ? runtime.piSession.sessionId : undefined) ??
      resolveSessionIdFromFilePath(sessionFile);

    if (typeof resolved === 'string' && resolved.length > 0) {
      runtime.sessionId = resolved;
      runtime.state.sessionId = resolved;
      return resolved;
    }

    return undefined;
  }

  /**
   * Garbage-collect idle per-channel/per-thread sessions that exceeded their TTL.
   * Single-mode sessions are never GC'd by this method.
   */
  private gcExpiredSessions(): void {
    const now = Date.now();
    const keysToDispose: string[] = [];

    for (const [key, runtime] of this.sessions) {
      const agent = this.registry.getById(runtime.state.agentId);
      if (agent === undefined) continue;

      const mode = resolveSessionMode(agent);
      if (mode === 'single') continue; // single-mode sessions don't get GC'd

      // Don't GC running or queued sessions
      if (runtime.processing || runtime.queue.length > 0) continue;

      const idleMs = now - runtime.state.lastActivityAt.getTime();
      if (idleMs > DEFAULT_SESSION_TTL_MS) {
        keysToDispose.push(key);
      }
    }

    for (const key of keysToDispose) {
      const runtime = this.sessions.get(key);
      if (runtime) {
        this.logger.info('GC: disposing expired session', {
          agentId: runtime.state.agentId,
          sessionKey: key,
          idleMs: now - runtime.state.lastActivityAt.getTime(),
        });
        this.disposeSessionByKey(key);
      }
    }
  }

  private async cleanupExpiredSessions(agents: AgentDefinition[] = this.registry.getAll()): Promise<void> {
    if (this.config.session.ttlDays <= 0) {
      return;
    }

    const ttlMs = this.config.session.ttlDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ttlMs;
    const activeSessionFiles = this.getActiveSessionFilePaths();

    await Promise.all(
      agents.map(async (agent) => {
        const sessionDir = getAgentSessionDir(agent);
        let entries: string[];

        try {
          entries = await readdir(sessionDir);
        } catch (error: unknown) {
          if (hasErrorCode(error, 'ENOENT')) {
            return;
          }
          throw error;
        }

        await Promise.all(
          entries
            .filter((name) => name.endsWith('.jsonl'))
            .map(async (name) => {
              const filePath = path.join(sessionDir, name);
              const resolvedPath = path.resolve(filePath);
              if (activeSessionFiles.has(resolvedPath)) {
                return;
              }

              try {
                const fileStat = await stat(filePath);
                if (fileStat.mtime.getTime() >= cutoff) {
                  return;
                }

                await rm(filePath, { force: true });
                this.logger.info('Expired session file removed', {
                  agentId: agent.id,
                  fileName: name,
                  ttlDays: this.config.session.ttlDays,
                });
              } catch (error: unknown) {
                if (hasErrorCode(error, 'ENOENT')) {
                  return;
                }
                throw error;
              }
            }),
        );
      }),
    );
  }

  private getActiveSessionFilePaths(): Set<string> {
    const files = new Set<string>();

    for (const runtime of this.sessions.values()) {
      const sessionFile = runtime.piSession?.sessionFile ?? runtime.sessionFilePath;
      if (typeof sessionFile === 'string' && sessionFile.length > 0) {
        files.add(path.resolve(sessionFile));
      }
    }

    return files;
  }

  private maybeCleanupExpiredSessions(): void {
    if (this.config.session.ttlDays <= 0) {
      return;
    }

    const agents = this.registry.getAll();
    if (agents.length === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastCleanupAt < SESSION_CLEANUP_INTERVAL_MS) {
      return;
    }

    this.lastCleanupAt = now;
    void this.cleanupExpiredSessions(agents).catch((error: unknown) => {
      this.logger.error('Failed to clean up expired session files', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function resolveSessionIdFromFilePath(sessionFilePath: string | undefined): string | undefined {
  if (typeof sessionFilePath !== 'string' || sessionFilePath.length === 0) {
    return undefined;
  }

  const fileName = path.basename(sessionFilePath);
  if (!fileName.endsWith('.jsonl')) {
    return undefined;
  }

  const sessionId = fileName.slice(0, -'.jsonl'.length).trim();
  return sessionId.length > 0 ? sessionId : undefined;
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

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === expectedCode;
}

function redactSensitiveLogText(input: string): string {
  let redacted = input;

  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, `Bearer ${LOG_REDACTED}`);
  redacted = redacted.replace(
    /\b((?:access|refresh|api)[_-]?(?:key|token|secret)|api[_-]?key|token|secret|password|authorization)\b(\s*[:=]\s*)(["'`]?)[^,\s"'`]+(["'`]?)/gi,
    (_match, key: string, separator: string, openQuote: string, closeQuote: string) =>
      `${key}${separator}${openQuote}${LOG_REDACTED}${closeQuote}`,
  );

  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, LOG_REDACTED);
  }

  return redacted;
}
