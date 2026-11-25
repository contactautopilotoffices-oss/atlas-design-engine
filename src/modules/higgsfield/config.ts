import "server-only";
import { env } from "@/modules/core/env";
import { HiggsfieldClient } from "./client";

/**
 * Resolves the Higgsfield credential without ever exposing it.
 * Accepted (first match wins):
 *   HF_API_KEY_ID + HF_API_KEY_SECRET   (names used in the official docs)
 *   HIGGSFIELD_API_KEY="<id>:<secret>"
 *   HIGGSFIELF_API_KEY="<id>:<secret>"  (legacy misspelling present in an existing .env)
 */
export function higgsfieldCredential(): { credential: string | null; source: string | null; problem: string | null } {
  const e = env();
  if (e.HF_API_KEY_ID && e.HF_API_KEY_SECRET) return { credential: `${e.HF_API_KEY_ID}:${e.HF_API_KEY_SECRET}`, source: "HF_API_KEY_ID + HF_API_KEY_SECRET", problem: null };
  for (const name of ["HIGGSFIELD_API_KEY", "HIGGSFIELF_API_KEY"] as const) {
    const v = e[name];
    if (!v) continue;
    if (!/^[^:\s]+:[^:\s]+$/.test(v.trim()))
      return { credential: null, source: name, problem: `${name} is set but is not in the "<key id>:<key secret>" format Higgsfield requires.` };
    return { credential: v.trim(), source: name, problem: null };
  }
  return { credential: null, source: null, problem: "No Higgsfield credential found. Set HF_API_KEY_ID and HF_API_KEY_SECRET (or HIGGSFIELD_API_KEY=id:secret) in .env." };
}

export function higgsfieldStatus() {
  const c = higgsfieldCredential();
  return { configured: Boolean(c.credential), credentialVariable: c.source, problem: c.problem };
}

let override: HiggsfieldClient | null = null;
/** Tests inject a client backed by a mock fetch. */
export const __setHiggsfieldClient = (c: HiggsfieldClient | null) => {
  override = c;
};

export function higgsfieldClient(): HiggsfieldClient | null {
  if (override) return override;
  const c = higgsfieldCredential();
  return c.credential ? new HiggsfieldClient(c.credential, env().HIGGSFIELD_API_BASE) : null;
}
