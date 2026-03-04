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

export type ChannelMode = 'mention' | 'proactive';

export interface ChannelConfig {
  mode: ChannelMode;
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
  channels: Record<string, ChannelConfig>;
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
  channels: Record<string, ChannelConfig>;
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
  channels: Record<string, ChannelConfig>;
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
  channels?: Record<string, ChannelConfig>;
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

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export type MessageRouteResult =
  | {
      type: 'agent';
      agent: AgentDefinition;
      threadTs?: string;
    }
  | {
      type: 'concierge';
      response: SlackBlock[];
      threadTs?: string;
    };

export interface AgentRegistryEvents {
  'agent:added': [agent: AgentDefinition];
  'agent:removed': [agentId: string];
  'agent:updated': [agent: AgentDefinition];
}
