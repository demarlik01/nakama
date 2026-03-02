export interface Agent {
  id: string;
  displayName: string;
  description: string;
  model: string;
  slackChannels: string[];
  slackUsers: string[];
  heartbeat?: { enabled: boolean; intervalMin: number; prompt?: string };
  cron?: { schedule: string; prompt: string }[];
  status: "idle" | "running" | "disabled";
  enabled: boolean;
  limits?: { maxConcurrentSessions?: number; dailyTokenLimit?: number; maxMessageLength?: number };
  reactionTriggers?: string[];
}

export interface CreateAgentInput {
  id: string;
  displayName: string;
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

export const fetchAgents = () => api<Agent[]>("/api/agents");
export const fetchAgent = (id: string) => api<Agent>(`/api/agents/${id}`);
export const createAgent = (data: CreateAgentInput) =>
  api<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) });
export const updateAgent = (id: string, data: Partial<Agent>) =>
  api<Agent>(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteAgent = (id: string) =>
  api<void>(`/api/agents/${id}`, { method: "DELETE" });
export const fetchHealth = () => api<HealthInfo>("/api/health");
export const fetchAgentUsage = (id: string) =>
  api<{ daily: DailyUsage[] }>(`/api/agents/${id}/usage`);
export const fetchAgentsMd = (id: string) =>
  api<{ content: string }>(`/api/agents/${id}/agents-md`);
export const updateAgentsMd = (id: string, content: string) =>
  api<void>(`/api/agents/${id}/agents-md`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
