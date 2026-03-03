import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

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
import type { SSEManager } from '../api/sse.js';
import type { Notifier } from './notifier.js';
import { getAgentSessionDir, listPersistedSessions } from './session-files.js';

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
  sessionFilePath?: string;
  sessionId?: string;
}

const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class SessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly cleanupTimer?: NodeJS.Timeout;
  private cleanupAgentAddedListener?: (agent: AgentDefinition) => void;
  private lastCleanupAt = 0;

  private sseManager?: SSEManager;
  private notifier?: Notifier;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly config: AppConfig,
    private readonly logger: Logger = createLogger('SessionManager'),
    private readonly usageTracker?: UsageTracker,
  ) {
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

    if (this.cleanupAgentAddedListener !== undefined) {
      this.registry.off('agent:added', this.cleanupAgentAddedListener);
      this.cleanupAgentAddedListener = undefined;
    }
  }

  async handleMessage(
    agentId: string,
    message: string,
    context: SessionMessageContext,
  ): Promise<string> {
    const agent = this.registry.getById(agentId);
    if (agent === undefined) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.maybeCleanupExpiredSessions();

    const runtime = this.ensureSession(agent, context);

    if (runtime.queue.length >= this.config.session.maxQueueSize) {
      return 'Agent is currently busy. Please try again in a moment.';
    }

    this.sseManager?.emit('session:message', {
      agentId,
      role: 'user',
      preview: message.slice(0, 200),
    });

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

  private async restorePersistedSessions(): Promise<void> {
    const agents = this.registry.getAll();
    if (agents.length === 0) {
      return;
    }

    let restoredCount = 0;

    for (const agent of agents) {
      if (this.sessions.has(agent.id)) {
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

        this.sessions.set(agent.id, runtime);
        this.touchIdleTimer(agent.id, runtime);
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
    runtime.sessionFilePath = undefined;
    runtime.sessionId = undefined;
    runtime.state.sessionId = undefined;

    this.sessions.delete(agentId);

    this.sseManager?.emit('session:end', { agentId });
    this.sseManager?.emit('agent:status', { agentId, status: 'disposed' });

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

    this.sseManager?.emit('session:start', {
      agentId: agent.id,
      threadTs: context.slackThreadTs,
    });
    this.sseManager?.emit('agent:status', {
      agentId: agent.id,
      status: 'idle',
    });

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

      this.sseManager?.emit('agent:status', {
        agentId: agent.id,
        status: 'running',
      });

      try {
        const response = await this.runAgentTurn(agent, item.message, item.context, runtime);
        runtime.state.status = 'idle';
        runtime.state.error = undefined;
        runtime.state.lastActivityAt = new Date();

        this.sseManager?.emit('agent:status', {
          agentId: agent.id,
          status: 'idle',
        });
        this.sseManager?.emit('session:message', {
          agentId: agent.id,
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
          });
        }

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
    const sessionDir = getAgentSessionDir(agent);

    const model = getModel(provider as any, modelId as any);
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

    const { session } = await createAgentSession({
      cwd: agent.workspacePath,
      model,
      tools: codingTools,
      sessionManager,
    });

    session.agent.setSystemPrompt(systemPrompt);

    runtime.piSession = session;
    runtime.sessionFilePath = session.sessionFile ?? runtime.sessionFilePath;
    runtime.sessionId = session.sessionId ?? resolveSessionIdFromFilePath(runtime.sessionFilePath);
    runtime.state.sessionId = runtime.sessionId;

    this.logger.info('Pi SDK session created', {
      agentId: agent.id,
      model: modelSpec,
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
    this.recordUsageFromMessages(
      agent,
      runtime,
      session.state.messages as unknown as readonly unknown[],
    );

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

function parseModelSpec(spec: string, fallbackProvider: string): [string, string] {
  const slashIndex = spec.indexOf('/');
  if (slashIndex > 0) {
    return [spec.slice(0, slashIndex), spec.slice(slashIndex + 1)];
  }
  return [fallbackProvider, spec];
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
