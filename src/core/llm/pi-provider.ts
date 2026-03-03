import { getModel } from '@mariozechner/pi-ai';

import {
  parseModelSpec,
  type PiSessionLlmProvider,
  type ResolvedLlmModel,
} from './provider.js';

export class PiLlmProvider implements PiSessionLlmProvider {
  readonly implementation = 'pi' as const;
  readonly capabilities = {
    supportsPiSession: true,
    supportsDirectApi: false,
  } as const;

  constructor(
    private readonly fallbackProvider: string,
    // Reserved for parity with direct provider implementations.
    private readonly _auth?: string,
  ) {}

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
