/**
 * Tiny in-process TTL cache (PRD §26).
 *
 * A completed trading session's CPR is immutable, so repeatedly recomputing it
 * from the provider is pure waste. This caches within a warm serverless
 * instance; the durable cache is the database, and HTTP `Cache-Control` headers
 * handle the CDN layer. Deliberately not a distributed cache — the stakes do not
 * justify the dependency.
 *
 * Stored on `globalThis` so Next's dev hot-reload does not drop the cache on
 * every edit.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store: Map<string, Entry<unknown>> =
  (globalThis as { __cprCache?: Map<string, Entry<unknown>> }).__cprCache ??
  new Map();
(globalThis as { __cprCache?: Map<string, Entry<unknown>> }).__cprCache = store;

/** Keep the map from growing without bound in a long-lived instance. */
const MAX_ENTRIES = 500;

export const TTL = {
  /** Settled sessions never change. */
  historical: 60 * 60 * 1000,
  /** Forward-looking CPR changes when a new session completes. */
  forward: 5 * 60 * 1000,
} as const;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    // Evict the oldest insertion; Map preserves insertion order.
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await produce();
  cacheSet(key, value, ttlMs);
  return value;
}

export function cacheClear(): void {
  store.clear();
}
