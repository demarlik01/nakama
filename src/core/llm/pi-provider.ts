import { getModel } from '@mariozechner/pi-ai';

import {
  parseModelSpec,
  type LlmProvider,
  type ResolvedLlmModel,
} from './provider.js';

export class PiLlmProvider implements LlmProvider {
  constructor(private readonly fallbackProvider: string) {}

  resolveModel(modelSpec: string): ResolvedLlmModel {
    const [provider, modelId] = parseModelSpec(modelSpec, this.fallbackProvider);

    return {
      provider,
      modelId,
      modelSpec: `${provider}/${modelId}`,
      model: getModel(provider as any, modelId as any),
    };
  }
}
