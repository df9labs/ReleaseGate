export * from './contracts.ts';
export { createDemoEngine } from './demo.ts';
export { createLlmAnalyser, LLM_LIMITS, type AnalyserOptions } from './llm.ts';
import { createDemoEngine } from './demo.ts';
import { createLlmAnalyser } from './llm.ts';
import type { DemoEngine, ProposalOnlyEngine } from './contracts.ts';

export function createConfiguredEngine(
  env: Record<string, string | undefined> = process.env,
): DemoEngine | ProposalOnlyEngine {
  if (!env.LLM_API_KEY?.trim()) return createDemoEngine();
  return createLlmAnalyser({
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    endpoint: env.LLM_ENDPOINT,
    timeoutMs: env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : undefined,
  });
}
