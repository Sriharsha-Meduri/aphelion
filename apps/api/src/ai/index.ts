import type { AppConfig } from '../config/env';
import { createMockProvider, type LlmProvider } from './provider';
import { createGeminiProvider } from './gemini';

export type { LlmProvider, LlmRequest } from './provider';

export function createLlmProvider(config: AppConfig): LlmProvider {
  switch (config.llm.provider) {
    case 'gemini':
      return createGeminiProvider(config);
    case 'mock':
    default:
      return createMockProvider();
  }
}
