import 'server-only';

/**
 * Fixed-window rate limiting for the expensive and abusable routes: AI
 * generation, invitations and auth.
 *
 * This is an in-process counter, which means it limits per serverless
 * instance rather than globally. That is a deliberate MVP trade-off: it stops
 * a single client hammering the OpenAI key in a loop, which is the failure
 * mode that actually costs money, without adding Redis to the stack. Move to
 * a shared store before relying on it as a security control.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

export const LIMITS = {
  ai: { limit: 20, windowMs: 60 * 60 * 1000 },
  invite: { limit: 50, windowMs: 60 * 60 * 1000 },
  write: { limit: 120, windowMs: 60 * 1000 },
} as const;
