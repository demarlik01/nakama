import { PiLlmProvider } from './pi-provider.js';
import type { LlmImplementation, LlmProvider } from './provider.js';

export interface CreateLlmProviderInput {
  implementation?: LlmImplementation;
  provider: string;
  auth: string;
}

export class UnsupportedLlmImplementationError extends Error {
  constructor(implementation: LlmImplementation) {
    super(
      `LLM implementation "${implementation}" is not implemented yet. Use "pi" for now.`,
    );
    this.name = 'UnsupportedLlmImplementationError';
  }
}

export function createLlmProvider(input: CreateLlmProviderInput): LlmProvider {
  const implementation = input.implementation ?? 'pi';

  switch (implementation) {
    case 'pi':
      return new PiLlmProvider(input.provider, input.auth);
    case 'anthropic-direct':
    case 'openai-direct':
      throw new UnsupportedLlmImplementationError(implementation);
    default: {
      const exhaustive: never = implementation;
      throw new UnsupportedLlmImplementationError(exhaustive);
    }
  }
}
