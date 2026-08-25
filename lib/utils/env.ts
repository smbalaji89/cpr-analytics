/**
 * Environment variable reading.
 *
 * ── Why a helper for something this small ──────────────────────────────────
 * A variable declared with a BLANK value is not the same as an unset one to
 * JavaScript: `process.env.X ?? "default"` yields `""`, because `??` only falls
 * back on null/undefined. Hosting dashboards make blank values easy to create —
 * you add the key, forget the value, and save.
 *
 * That exact mistake took the deployed app down: `MARKET_DATA_PROVIDER` was set
 * to `""` in Vercel, `??` passed the empty string through, and the provider
 * factory threw "Unknown MARKET_DATA_PROVIDER" on every render.
 *
 * Everything here treats blank and whitespace-only as UNSET, so a forgotten
 * value falls back to the documented default instead of crashing.
 */

/** Trimmed value, or `undefined` when unset, blank or whitespace-only. */
export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Trimmed value, or `fallback` when unset or blank. */
export function readEnvOr(name: string, fallback: string): string {
  return readEnv(name) ?? fallback;
}

export function hasEnv(name: string): boolean {
  return readEnv(name) !== undefined;
}

/** Positive integer, or `fallback` when unset, blank or not a positive number. */
export function readEnvInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** True only for an explicit "true". Anything else, including blank, is false. */
export function readEnvBool(name: string): boolean {
  return readEnv(name)?.toLowerCase() === "true";
}
