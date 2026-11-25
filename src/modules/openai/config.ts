import "server-only";
import { env } from "@/modules/core/env";
import { OpenAIClient } from "./client";

/** Resolves the OpenAI credential without ever exposing the key value. */
export function openaiCredential(): { credential: string | null; source: string | null; problem: string | null } {
  const key = env().OPENAI_API_KEY?.trim();
  if (!key) return { credential: null, source: null, problem: "No OpenAI API key found. Set OPENAI_API_KEY in .env." };
  return { credential: key, source: "OPENAI_API_KEY", problem: null };
}

export function openaiStatus() {
  const c = openaiCredential();
  return { configured: Boolean(c.credential), credentialVariable: c.source, problem: c.problem };
}

let override: OpenAIClient | null = null;
/** Tests inject a client backed by a mock fetch. */
export const __setOpenAIClient = (c: OpenAIClient | null) => {
  override = c;
};

export function openaiClient(): OpenAIClient | null {
  if (override) return override;
  const c = openaiCredential();
  return c.credential ? new OpenAIClient(c.credential, env().OPENAI_API_BASE) : null;
}
