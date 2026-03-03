export interface Agent {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description: string;
  model: string;
  slackChannels: string[];
  slackUsers: string[];
  heartbeat?: { enabled: boolean; intervalMin: number; prompt?: string };
  cron?: { schedule: string; prompt: string }[];
  status: "idle" | "running" | "disabled" | "error";
  enabled: boolean;
  limits?: { maxConcurrentSessions?: number; dailyTokenLimit?: number; maxMessageLength?: number };
  reactionTriggers?: string[];
}

export interface CreateAgentInput {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description: string;
  model: string;
  slackChannels: string[];
  slackUsers: string[];
  agentsMd?: string;
}

export interface HealthInfo {
  status: string;
  slackConnected: boolean;
  agentCount: number;
  uptimeSec: number;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
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
  messages: AgentSessionMessage[];
}

interface AgentEnvelope {
  agent: Agent;
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
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const fetchAgents = () => api<{agents: Agent[]}>("/api/agents").then(r => r.agents ?? []);
export const fetchAgent = (id: string) =>
  api<AgentEnvelope>(`/api/agents/${id}`).then((r) => r.agent);
export const createAgent = (data: CreateAgentInput) =>
  api<AgentEnvelope>("/api/agents", { method: "POST", body: JSON.stringify(data) }).then((r) => r.agent);
export const updateAgent = (id: string, data: Partial<Agent>) => {
  const payload: Record<string, unknown> = { ...data };
  if (payload.slackDisplayName === "") {
    payload.slackDisplayName = null;
  }
  if (payload.slackIcon === "") {
    payload.slackIcon = null;
  }
  return api<AgentEnvelope>(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(payload) })
    .then((r) => r.agent);
};
export const deleteAgent = (id: string) =>
  api<void>(`/api/agents/${id}`, { method: "DELETE" });
export const fetchHealth = () => api<HealthInfo>("/api/health");
export const fetchAgentUsage = (id: string) =>
  api<{ usage: UsagePeriod[] }>(`/api/agents/${id}/usage`)
    .then((r) => ({
      daily: (r.usage ?? []).map((item) => ({
        date: item.period,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
      })),
    }));
export const fetchAgentsMd = (id: string) =>
  api<{ content: string }>(`/api/agents/${id}/agents-md`);
export const updateAgentsMd = (id: string, content: string) =>
  api<void>(`/api/agents/${id}/agents-md`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
export const fetchAgentSessions = (id: string) =>
  api<{ sessions: AgentSessionSummary[] }>(`/api/agents/${id}/sessions`)
    .then((r) => r.sessions ?? []);
export const fetchAgentSession = (id: string, sessionId: string) =>
  api<{ session: AgentSessionDetail }>(
    `/api/agents/${id}/sessions/${encodeURIComponent(sessionId)}`
  ).then((r) => r.session);
