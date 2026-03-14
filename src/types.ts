export interface AgentSchedule {
  name: string;
  cron?: string;
  every?: string;
  message: string;
  deliverTo: string;
}

export interface HeartbeatConfig {
  every?: string;        // duration ("30m", "1h") default "30m"
  prompt?: string;       // custom prompt
  activeHours?: {
    start?: string;      // "08:00"
    end?: string;        // "23:00"
    timezone?: string;   // IANA timezone
  };
  enabled?: boolean;     // default false
}

export interface CronJobConfig {
  name: string;
  schedule: string;
  message: string;
  channel?: string;
  sessionTarget?: 'main' | 'isolated';
  model?: string;
  thinking?: string;
  deleteAfterRun?: boolean;
}

// --- Cron Store Types ---

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'cron'; expr: string; tz?: string };

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
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: 'ok' | 'error' | 'skipped';
    lastError?: string;
    consecutiveErrors: number;
  };
}

export interface CronStore {
  jobs: CronJob[];
  version: number;
}

export interface LimitsConfig {
  maxConcurrentSessions?: number;
  dailyTokenLimit?: number;
  maxMessageLength?: number;
  proactiveResponseMinIntervalSec?: number;
}

export type SessionMode = 'single' | 'per-channel' | 'per-thread';

export type ChannelMode = 'mention' | 'proactive';

export interface ChannelConfig {
  mode: ChannelMode;
  default?: boolean;
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
  sessionMode?: SessionMode;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
  tools?: string[];
}

export interface LlmAuthApiKey {
  type: 'api-key';
  key: string;
}

export interface LlmAuthOAuth {
  type: 'oauth';
  accessToken: string;
  refreshToken: string;
  expires: number;
}

export type LlmAuth = LlmAuthApiKey | LlmAuthOAuth;

export interface AppConfig {
  server: { port: number };
  slack: { appToken: string; botToken: string };
  llm: {
    provider: string;
    defaultModel: string;
    auth: LlmAuth;
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
  tools?: {
    webSearch?: {
      braveApiKey: string;
    };
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
  sessionMode?: SessionMode;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
  tools?: string[];
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
  sessionMode?: SessionMode;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
  tools?: string[];
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
  sessionMode?: SessionMode;
  schedules?: AgentSchedule[];
  heartbeat?: HeartbeatConfig;
  cron?: CronJobConfig[];
  limits?: LimitsConfig;
  reactionTriggers?: string[];
  tools?: string[];
}

export type SessionStatus = 'idle' | 'running' | 'error' | 'disposed';

export interface SessionMessageContext {
  slackChannelId: string;
  slackThreadTs?: string;
  slackUserId: string;
}

export interface SessionState {
  agentId: string;
  sessionKey: string;
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
