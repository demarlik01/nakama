import type { Model } from '@mariozechner/pi-ai';

export interface ResolvedLlmModel {
  provider: string;
  modelId: string;
  modelSpec: string;
  model: Model<any>;
}

export interface LlmProvider {
  resolveModel(modelSpec: string): ResolvedLlmModel;
}

export function parseModelSpec(spec: string, fallbackProvider: string): [string, string] {
  const slashIndex = spec.indexOf('/');
  if (slashIndex > 0) {
    return [spec.slice(0, slashIndex), spec.slice(slashIndex + 1)];
  }
  return [fallbackProvider, spec];
}
