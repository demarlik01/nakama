import type { Model } from '@mariozechner/pi-ai';

export interface ResolvedLlmModel {
  provider: string;
  modelId: string;
  modelSpec: string;
  model: Model<any>;
}

export type LlmImplementation = 'pi' | 'anthropic-direct' | 'openai-direct';

export interface LlmProviderCapabilities {
  // Session runtime backed by Pi SDK model adapters.
  supportsPiSession: boolean;
  // Direct provider SDK/API call path (planned extension point).
  supportsDirectApi: boolean;
}

interface BaseLlmProvider {
  readonly implementation: LlmImplementation;
  readonly capabilities: LlmProviderCapabilities;
}

export interface PiSessionLlmProvider extends BaseLlmProvider {
  readonly capabilities: {
    supportsPiSession: true;
    supportsDirectApi: boolean;
  };
  resolveModel(modelSpec: string): ResolvedLlmModel;
}

export type DirectLlmMessageRole = 'system' | 'user' | 'assistant';

export interface DirectLlmMessage {
  role: DirectLlmMessageRole;
  content: string;
}

export interface DirectLlmTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface DirectLlmRequest {
  model: string;
  messages: DirectLlmMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  tools?: DirectLlmTool[];
}

export interface DirectLlmResponse {
  text: string;
  stopReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  raw?: unknown;
}

export interface DirectLlmProvider extends BaseLlmProvider {
  readonly capabilities: {
    supportsPiSession: boolean;
    supportsDirectApi: true;
  };
  complete(request: DirectLlmRequest): Promise<DirectLlmResponse>;
}

export type LlmProvider = PiSessionLlmProvider | DirectLlmProvider;

export function supportsPiSession(provider: LlmProvider): provider is PiSessionLlmProvider {
  return provider.capabilities.supportsPiSession;
}

export function supportsDirectApi(provider: LlmProvider): provider is DirectLlmProvider {
  return provider.capabilities.supportsDirectApi;
}

export function parseModelSpec(spec: string, fallbackProvider: string): [string, string] {
  const slashIndex = spec.indexOf('/');
  if (slashIndex > 0) {
    return [spec.slice(0, slashIndex), spec.slice(slashIndex + 1)];
  }
  return [fallbackProvider, spec];
}
