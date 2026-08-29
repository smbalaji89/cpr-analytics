import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { readEnv } from "@/lib/utils/env";

/**
 * Per-device privileged access.
 *
 * The site is PUBLIC by default and shows a redacted view: no data source, no
 * provider symbols, no system status. A device becomes privileged by posting
 * the access key once to `/unlock`, which sets a long-lived cookie.
 *
 * ── Why a cookie rather than an env flag ───────────────────────────────────
 * The owner needs the full view from a laptop AND a phone, so "run it locally"
 * is not an option and a build-time flag cannot distinguish two browsers
 * hitting the same deployment.
 *
 * ── Why the cookie does not contain the key ────────────────────────────────
 * It carries an HMAC of a fixed message under the key. That is verifiable with
 * no server-side storage (this runs on serverless, there is no session table),
 * reveals nothing if the cookie is read off the device, and rotating
 * ADMIN_ACCESS_KEY invalidates every device at once.
 *
 * Cookie flags: httpOnly so page JavaScript cannot read it (an XSS cannot
 * exfiltrate it), Secure so it never crosses plain HTTP, SameSite=Lax so it is
 * not attached to cross-site requests.
 *
 * ── Failure direction ──────────────────────────────────────────────────────
 * Every path here fails to UNPRIVILEGED. A missing key, a malformed cookie, a
 * throw while reading cookies — all yield the public view. The consequence of
 * a false negative is that the owner re-unlocks; the consequence of a false
 * positive is that a stranger sees everything.
 */

export const ACCESS_COOKIE = "cpr_access";

/** Long enough that unlocking is a one-off per device. */
export const ACCESS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Fixed message — the secret is the HMAC key, not the payload. */
const TOKEN_MESSAGE = "cpr-analytics/privileged/v1";

/**
 * The cookie value proving a device unlocked.
 *
 * Returns null when no key is configured, which is what makes the public
 * deployment safe by default: with ADMIN_ACCESS_KEY unset there is no value a
 * cookie could hold that would ever verify.
 */
export function accessToken(): string | null {
  const key = readEnv("ADMIN_ACCESS_KEY");
  if (!key) return null;
  return createHmac("sha256", key).update(TOKEN_MESSAGE).digest("hex");
}

/** Constant-time compare that tolerates length mismatches without throwing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on unequal lengths, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Does this submitted key match the configured one? */
export function isValidAccessKey(submitted: string): boolean {
  const key = readEnv("ADMIN_ACCESS_KEY");
  if (!key || !submitted) return false;
  return safeEqual(submitted, key);
}

/** Is the access key configured at all? */
export function accessConfigured(): boolean {
  return accessToken() !== null;
}

/**
 * Is the CURRENT REQUEST privileged?
 *
 * Call this at every point where output differs. It is deliberately not cached
 * across requests — two different devices hit the same server instance.
 */
export async function isPrivileged(): Promise<boolean> {
  const expected = accessToken();
  if (!expected) return false;
  try {
    const store = await cookies();
    const presented = store.get(ACCESS_COOKIE)?.value;
    if (!presented) return false;
    return safeEqual(presented, expected);
  } catch {
    // Outside a request scope (the sync job renders nothing) — treat as public.
    return false;
  }
}
