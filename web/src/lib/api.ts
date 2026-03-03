export interface Agent {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  notifyChannel?: string;
  // Deprecated alias for old payloads.
  errorNotificationChannel?: string;
  model?: string;
  slackChannels: string[];
  slackUsers: string[];
  heartbeat?: { enabled: boolean; intervalMin: number; prompt?: string };
  cron?: { schedule: string; prompt: string }[];
  status: "idle" | "running" | "disabled" | "error" | "disposed";
  enabled: boolean;
  limits?: { maxConcurrentSessions?: number; dailyTokenLimit?: number; maxMessageLength?: number };
  reactionTriggers?: string[];
}

type ApiAgent = Omit<Agent, "status"> & {
  status?: Agent["status"];
};

export interface CreateAgentInput {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  notifyChannel?: string;
  // Deprecated alias for old payloads.
  errorNotificationChannel?: string;
  model: string;
  slackChannels: string[];
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
  if ("notifyChannel" in payload) {
    payload.notifyChannel = normalizeOptionalPatchString(payload.notifyChannel);
  }
  if (!("notifyChannel" in payload) && "errorNotificationChannel" in payload) {
    payload.notifyChannel = normalizeOptionalPatchString(payload.errorNotificationChannel);
  }
  if ("limits" in payload) {
    payload.limits = normalizeLimitsPatchPayload(payload.limits);
  }
  delete payload.errorNotificationChannel;
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
    notifyChannel: agent.notifyChannel ?? agent.errorNotificationChannel,
    status: normalizedStatus ?? (agent.enabled ? "idle" : "disabled"),
  };
}

function normalizeCreateAgentInput(input: CreateAgentInput): CreateAgentInput {
  const notifyChannel = normalizeOptionalCreateString(input.notifyChannel);
  const legacyNotifyChannel = normalizeOptionalCreateString(input.errorNotificationChannel);
  const mergedNotifyChannel = notifyChannel ?? legacyNotifyChannel;

  return {
    ...input,
    notifyChannel: mergedNotifyChannel,
    errorNotificationChannel: undefined,
  };
}

function normalizeOptionalPatchString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeOptionalCreateString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
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
