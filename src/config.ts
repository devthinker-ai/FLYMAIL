/** Single place for LLM-pen settings. Never hardcode the model elsewhere. */

export const OLLAMA_MODEL = "qwen2.5:7b";
export const OLLAMA_TEMPERATURE = 0;
export const OLLAMA_SEED = 42;
export const OLLAMA_TIMEOUT_MS = 30_000;
export const OLLAMA_MAX_WORDS = 300;

/**
 * Dev: Vite proxies `/ollama` → localhost:11434 (CORS-safe).
 * Production/static `dist/`: call Ollama directly (CORS allowed from localhost).
 */
export function ollamaGenerateUrl(): string {
  if (import.meta.env.DEV) return "/ollama/api/generate";
  return "http://127.0.0.1:11434/api/generate";
}
