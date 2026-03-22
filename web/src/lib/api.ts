export type ChannelMode = "mention" | "proactive";

export interface ChannelConfig {
  mode: ChannelMode;
  default?: boolean;
}

export interface Agent {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  model?: string;
  channels: Record<string, ChannelConfig>;
  slackUsers: string[];
  heartbeat?: { enabled: boolean; intervalMin: number; prompt?: string };
  cron?: { schedule: string; prompt: string }[];
  status: "idle" | "running" | "disabled" | "error" | "disposed";
  enabled: boolean;
  limits?: { maxConcurrentSessions?: number; dailyTokenLimit?: number; maxMessageLength?: number };
  reactionTriggers?: string[];
}

type ApiAgent = Omit<Agent, "status" | "channels"> & {
  channels?: Record<string, { mode?: unknown }>;
  // Deprecated alias for old payloads.
  slackChannels?: string[];
  status?: Agent["status"];
};

export interface CreateAgentInput {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  model: string;
  channels: Record<string, ChannelConfig>;
  slackUsers?: string[];
  agentsMd?: string;
}

export interface HealthInfo {
  status: string;
  slackConnected: boolean;
  agentCount: number;
  uptimeSec: number;
}

export interface UsageBucket {
  period: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentSessionSummary {
  sessionId: string;
  fileName: string;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
}

export interface AgentSessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface AgentSessionDetail extends AgentSessionSummary {
  rawJsonl: string;
  messages: AgentSessionMessage[];
}

export interface SessionUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  recordCount: number;
}

interface AgentEnvelope {
  agent: ApiAgent;
}

interface UsagePeriod {
  period: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(buildApiErrorMessage(res.status, text, res.statusText));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const fetchAgents = () =>
  api<{agents: ApiAgent[]}>("/api/agents").then((r) =>
    (r.agents ?? []).map((agent) => normalizeAgent(agent))
  );
export const fetchAgent = (id: string) =>
  api<AgentEnvelope>(`/api/agents/${encodeURIComponent(id)}`).then((r) => normalizeAgent(r.agent));
export const createAgent = (data: CreateAgentInput) =>
  api<AgentEnvelope>("/api/agents", {
    method: "POST",
    body: JSON.stringify(normalizeCreateAgentInput(data)),
  })
    .then((r) => normalizeAgent(r.agent));
export const updateAgent = (id: string, data: Partial<Agent>) => {
  const payload: Record<string, unknown> = { ...data };
  if ("slackDisplayName" in payload) {
    payload.slackDisplayName = normalizeOptionalPatchString(payload.slackDisplayName);
  }
  if ("slackIcon" in payload) {
    payload.slackIcon = normalizeOptionalPatchString(payload.slackIcon);
  }
  if ("limits" in payload) {
    payload.limits = normalizeLimitsPatchPayload(payload.limits);
  }
  if ("channels" in payload) {
    payload.channels = normalizeChannels(payload.channels);
  }
  return api<AgentEnvelope>(`/api/agents/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) })
    .then((r) => normalizeAgent(r.agent));
};
export const deleteAgent = (id: string) =>
  api<void>(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
export const fetchHealth = () => api<HealthInfo>("/api/health");
export const fetchAgentUsage = (
  id: string,
  period: "day" | "week" | "month" = "day"
) =>
  api<{ usage: UsagePeriod[] }>(`/api/agents/${encodeURIComponent(id)}/usage?period=${encodeURIComponent(period)}`)
    .then((r) =>
      (r.usage ?? []).map((item) => ({
        period: item.period,
        inputTokens: toFiniteNumber(item.inputTokens),
        outputTokens: toFiniteNumber(item.outputTokens),
        totalTokens: toFiniteNumber(item.totalTokens),
      }))
    );
export const fetchAgentsMd = (id: string) =>
  api<{ content: string }>(`/api/agents/${encodeURIComponent(id)}/agents-md`);
export const updateAgentsMd = (id: string, content: string) =>
  api<AgentEnvelope>(`/api/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ agentsMd: content }),
  }).then(() => undefined);
export interface SessionListItem {
  sessionId: string;
  agentId: string;
  status: 'active' | 'archived';
  messageCount: number;
  createdAt: string;
  lastActivityAt: string;
}

export const fetchAllSessions = (agent?: string) =>
  api<SessionListItem[]>(`/api/sessions/all${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`);

export const fetchAgentSessions = (id: string) =>
  api<{ sessions: AgentSessionSummary[] }>(`/api/agents/${encodeURIComponent(id)}/sessions`)
    .then((r) => r.sessions ?? []);
export const fetchAgentSession = (id: string, sessionId: string) =>
  api<{ session: AgentSessionDetail }>(
    `/api/agents/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`
  ).then((r) => r.session);
export const fetchAgentSessionUsage = (
  id: string,
  sessionId: string,
  period: "day" | "week" | "month" = "day"
) =>
  api<{ usage: UsagePeriod[]; summary?: SessionUsageSummary }>(
    `/api/agents/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/usage?period=${encodeURIComponent(period)}`
  ).then((r) => ({
    usage: (r.usage ?? []).map((item) => ({
      period: item.period,
      inputTokens: toFiniteNumber(item.inputTokens),
      outputTokens: toFiniteNumber(item.outputTokens),
      totalTokens: toFiniteNumber(item.totalTokens),
    })),
    summary: r.summary,
  }));

function normalizeAgent(agent: ApiAgent): Agent {
  const normalizedStatus = normalizeAgentStatus(agent.status);
  return {
    ...agent,
    channels: normalizeChannels(agent.channels, agent.slackChannels),
    status: normalizedStatus ?? (agent.enabled ? "idle" : "disabled"),
  };
}

function normalizeCreateAgentInput(input: CreateAgentInput): CreateAgentInput {
  return {
    ...input,
    channels: normalizeChannels(input.channels),
  };
}

function normalizeChannels(
  channels: unknown,
  legacySlackChannels?: unknown,
): Record<string, ChannelConfig> {
  const normalized: Record<string, ChannelConfig> = {};

  if (isRecord(channels)) {
    for (const [channelId, rawConfig] of Object.entries(channels)) {
      if (rawConfig === undefined || rawConfig === null || !isRecord(rawConfig)) {
        normalized[channelId] = { mode: "mention" };
        continue;
      }

      const mode = rawConfig.mode === "proactive" ? "proactive" : "mention";
      const isDefault = rawConfig.default === true ? true : undefined;
      normalized[channelId] = { mode, ...(isDefault !== undefined ? { default: isDefault } : {}) };
    }
    return normalized;
  }

  if (Array.isArray(legacySlackChannels)) {
    for (const channelId of legacySlackChannels) {
      if (typeof channelId !== "string") {
        continue;
      }
      const trimmed = channelId.trim();
      if (trimmed.length === 0) {
        continue;
      }
      normalized[trimmed] = { mode: "mention" };
    }
  }

  return normalized;
}

function normalizeOptionalPatchString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 ? value : 0;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed >= 0 ? parsed : 0;
    }
  }

  return 0;
}

function normalizeAgentStatus(value: unknown): Agent["status"] | undefined {
  return value === "idle" ||
    value === "running" ||
    value === "disabled" ||
    value === "error" ||
    value === "disposed"
    ? value
    : undefined;
}

function normalizeLimitsPatchPayload(
  value: unknown
): Record<string, number | undefined> | undefined {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  return {
    maxConcurrentSessions: normalizeOptionalLimit(raw.maxConcurrentSessions),
    dailyTokenLimit: normalizeOptionalLimit(raw.dailyTokenLimit),
    maxMessageLength: normalizeOptionalLimit(raw.maxMessageLength),
  };
}

function normalizeOptionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

// --- Cron Job Types & API ---

export type CronScheduleKind = 'at' | 'every' | 'cron';

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'cron'; expr: string; tz?: string };

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  consecutiveErrors: number;
}

export interface CronJob {
  id: string;
  agentId: string;
  schedule: CronSchedule;
  sessionTarget: 'main' | 'isolated';
  payload: {
    message: string;
    model?: string;
    thinking?: string;
  };
  enabled: boolean;
  deleteAfterRun: boolean;
  source: 'config' | 'api';
  deliverTo?: string;
  state: CronJobState;
}

export interface CreateCronJobInput {
  agentId: string;
  schedule: CronSchedule | string;
  message: string;
  model?: string;
  thinking?: string;
  sessionTarget?: 'main' | 'isolated';
  enabled?: boolean;
  deleteAfterRun?: boolean;
  deliverTo?: string;
}

export interface UpdateCronJobInput {
  schedule?: CronSchedule | string;
  payload?: { message: string; model?: string; thinking?: string };
  sessionTarget?: 'main' | 'isolated';
  enabled?: boolean;
  deleteAfterRun?: boolean;
  deliverTo?: string;
}

export const fetchCronJobs = (agentId?: string) => {
  const params = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  return api<{ jobs: CronJob[] }>(`/api/cron${params}`).then((r) => r.jobs ?? []);
};

export const createCronJob = (data: CreateCronJobInput) =>
  api<{ job: CronJob }>('/api/cron', {
    method: 'POST',
    body: JSON.stringify({
      agentId: data.agentId,
      schedule: data.schedule,
      message: data.message,
      model: data.model,
      thinking: data.thinking,
      sessionTarget: data.sessionTarget ?? 'main',
      enabled: data.enabled ?? true,
      deleteAfterRun: data.deleteAfterRun ?? false,
      deliverTo: data.deliverTo,
    }),
  }).then((r) => r.job);

export const updateCronJob = (id: string, patch: UpdateCronJobInput) =>
  api<{ job: CronJob }>(`/api/cron/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((r) => r.job);

export const deleteCronJob = (id: string) =>
  api<{ ok: boolean }>(`/api/cron/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const runCronJob = (id: string) =>
  api<{ ok: boolean; response?: string }>(`/api/cron/${encodeURIComponent(id)}/run`, { method: 'POST' });

function buildApiErrorMessage(status: number, raw: string, fallback: string): string {
  let detail = raw.trim();

  if (detail !== "") {
    try {
      const parsed = JSON.parse(detail) as unknown;
      if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
        const errorValue = (parsed as { error?: unknown }).error;
        if (typeof errorValue === "string" && errorValue.trim() !== "") {
          detail = errorValue.trim();
        }
      }
    } catch {
      // Keep original text when body is not JSON.
    }
  }

  if (detail === "") {
    detail = fallback || "Request failed";
  }

  return `API ${status}: ${detail}`;
}
