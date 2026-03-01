export interface AgentSchedule {
  name: string;
  cron?: string;
  every?: string;
  message: string;
  deliverTo: string;
}

export interface AgentDefinition {
  id: string;
  displayName: string;
  workspacePath: string;
  slackChannels: string[];
  slackUsers: string[];
  slackBotUserId?: string;
  model?: string;
  enabled: boolean;
  schedules?: AgentSchedule[];
}

export interface AppConfig {
  server: { port: number };
  slack: { appToken: string; botToken: string };
  llm: { provider: string; defaultModel: string; auth: string };
  workspaces: { root: string; shared: string };
  api: { enabled: boolean; port: number };
  session: {
    idleTimeoutMin: number;
    maxQueueSize: number;
    autoSummaryOnDispose: boolean;
  };
}

export interface AgentMetadata {
  displayName: string;
  slackChannels: string[];
  slackUsers: string[];
  slackBotUserId?: string;
  model?: string;
  enabled: boolean;
  schedules?: AgentSchedule[];
}

export interface CreateAgentParams {
  id: string;
  displayName: string;
  agentsMd: string;
  slackChannels: string[];
  slackUsers: string[];
  model?: string;
  enabled?: boolean;
  schedules?: AgentSchedule[];
}

export interface UpdateAgentParams {
  displayName?: string;
  slackChannels?: string[];
  slackUsers?: string[];
  slackBotUserId?: string;
  model?: string;
  enabled?: boolean;
  schedules?: AgentSchedule[];
}

export type SessionStatus = 'idle' | 'running' | 'error' | 'disposed';

export interface SessionMessageContext {
  slackChannelId: string;
  slackThreadTs?: string;
  slackUserId: string;
}

export interface SessionState {
  agentId: string;
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
