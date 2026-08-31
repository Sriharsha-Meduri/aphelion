import { GoogleGenAI, ApiError } from '@google/genai';
import type { AppConfig } from '../config/env';
import { LLMError } from '../util/errors';
import { retry, isPreRequestConnectionError } from '../util/async';
import type { LlmProvider, LlmRequest } from './provider';

/**
 * Google Gemini provider. Thinking is disabled by default for latency, and the
 * response is requested as JSON. Errors map to a log-safe LLMError that never
 * includes the API key; the caller falls back to the deterministic decision on
 * any failure, so a model outage never blocks the financial pipeline.
 */
export function createGeminiProvider(config: AppConfig): LlmProvider {
  const ai = new GoogleGenAI({ apiKey: config.llm.apiKey });
  const model = config.llm.model;
  const thinkingBudget = config.llm.thinkingBudget;

  return {
    name: 'gemini',
    async generate(req: LlmRequest): Promise<string> {
      const doCall = async (): Promise<string> => {
        const res = await Promise.resolve().then(() =>
          ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: req.user }] }],
            config: {
              systemInstruction: req.system,
              responseMimeType: 'application/json',
              maxOutputTokens: config.llm.maxTokens,
              httpOptions: { timeout: req.timeoutMs },
              ...(typeof thinkingBudget === 'number' ? { thinkingConfig: { thinkingBudget } } : {}),
            },
          }),
        );
        const blockReason = res.promptFeedback?.blockReason;
        if (blockReason) throw new LLMError(`Gemini blocked the prompt (${String(blockReason)})`);
        const text = (res.text ?? '').trim();
        if (!text) throw new LLMError('Gemini returned no text');
        return text;
      };

      try {
        return await retry(doCall, { retries: req.maxRetries, shouldRetry: isRetryable });
      } catch (err) {
        if (err instanceof LLMError) throw err;
        throw new LLMError(mapError(err));
      }
    },
  };
}

function isRetryable(err: unknown): boolean {
  if (err instanceof LLMError) return false;
  const name = (err as { name?: string } | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const status = (err as { status?: number } | undefined)?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return isPreRequestConnectionError(err);
}

function mapError(err: unknown): string {
  if (err instanceof ApiError) return `Gemini API error ${err.status}: ${err.name}`;
  const name = (err as { name?: string } | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'Gemini request timed out';
  return `Gemini call failed: ${(err as Error)?.message ?? String(err)}`;
}
