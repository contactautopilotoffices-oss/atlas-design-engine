import { AppError } from "@/modules/core/util";

/**
 * Sliding-window limiter for expensive operations (uploads, AI generation).
 * In-memory: correct for a single server process. On multi-instance deployments
 * pair it with the provider's own limits (Higgsfield returns 429 when its queue is full).
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (arr.length >= limit) {
    const retry = Math.ceil((windowMs - (t - arr[0])) / 1000);
    throw new AppError(`Too many requests. Try again in about ${retry} seconds.`, 429, "rate_limited");
  }
  arr.push(t);
  hits.set(key, arr);
}

export const __resetRateLimits = () => hits.clear();
