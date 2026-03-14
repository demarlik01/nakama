import { PiLlmProvider } from './pi-provider.js';
import type { LlmProvider } from './provider.js';

export interface CreateLlmProviderInput {
  provider: string;
}

export function createLlmProvider(input: CreateLlmProviderInput): LlmProvider {
  return new PiLlmProvider(input.provider);
}
