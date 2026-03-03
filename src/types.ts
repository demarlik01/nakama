export interface AgentSchedule {
  name: string;
  cron?: string;
  every?: string;
  message: string;
  deliverTo: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMin: number;
  quietHours: [number, number];
}

export interface CronJobConfig {
  name: string;
  schedule: string;
  prompt: string;
  channel: string;
}

export interface LimitsConfig {
  maxConcurrentSessions?: number;
  dailyTokenLimit?: number;
  maxMessageLength?: number;
}

export interface AgentDefinition {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  notifyChannel?: string;
  // Deprecated alias; kept for backward compatibility.
  errorNotificationChannel?: string;
  workspacePath: string;
  slackChannels: string[];
  slackUsers: string[];
  slackBotUserId?: string;
  model?: string;
  enabled: boolean;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
}

export interface AppConfig {
  server: { port: number };
  slack: { appToken: string; botToken: string };
  llm: {
    implementation?: 'pi' | 'anthropic-direct' | 'openai-direct';
    provider: string;
    defaultModel: string;
    auth: string;
  };
  workspaces: { root: string; shared: string };
  api: { enabled: boolean; port: number; auth?: { username: string; password: string } };
  notifications?: { adminSlackUser?: string; defaultChannel?: string };
  session: {
    idleTimeoutMin: number;
    maxQueueSize: number;
    autoSummaryOnDispose: boolean;
    ttlDays: number;
  };
}

export interface AgentMetadata {
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  notifyChannel?: string;
  // Deprecated alias; kept for backward compatibility.
  errorNotificationChannel?: string;
  slackChannels: string[];
  slackUsers: string[];
  slackBotUserId?: string;
  model?: string;
  enabled: boolean;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
}

export interface CreateAgentParams {
  id: string;
  displayName: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  notifyChannel?: string;
  // Deprecated alias; kept for backward compatibility.
  errorNotificationChannel?: string;
  agentsMd?: string;
  slackChannels: string[];
  slackUsers: string[];
  model?: string;
  enabled?: boolean;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
}

export interface UpdateAgentParams {
  displayName?: string;
  slackDisplayName?: string;
  slackIcon?: string;
  description?: string;
  notifyChannel?: string;
  // Deprecated alias; kept for backward compatibility.
  errorNotificationChannel?: string;
  slackChannels?: string[];
  slackUsers?: string[];
  slackBotUserId?: string;
  model?: string;
  enabled?: boolean;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
}

export type SessionStatus = 'idle' | 'running' | 'error' | 'disposed';

export interface SessionMessageContext {
  slackChannelId: string;
  slackThreadTs?: string;
  slackUserId: string;
}

export interface SessionState {
  agentId: string;
  sessionId?: string;
  threadTs?: string;
  status: SessionStatus;
  queueDepth: number;
  lastActivityAt: Date;
  error?: string;
}

export interface SlackMessageEvent {
  type: string;
  text?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  channelType?: string;
  thread_ts?: string;
  threadTs?: string;
  botUserId?: string;
}

export interface MessageRouteResult {
  agent: AgentDefinition;
  threadTs?: string;
}

export interface AgentRegistryEvents {
  'agent:added': [agent: AgentDefinition];
  'agent:removed': [agentId: string];
  'agent:updated': [agent: AgentDefinition];
}
