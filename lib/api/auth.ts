import { timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/utils/env";

/**
 * Cron / admin endpoint protection (PRD §21, §32).
 *
 * Fails CLOSED: with no `CRON_SECRET` configured, these endpoints are denied
 * outright rather than left open. An unprotected sync endpoint is a free way for
 * anyone to burn the provider quota and hammer the database.
 */

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type AuthResult =
  | { authorized: true }
  | { authorized: false; message: string };

/**
 * Compare a caller-supplied secret against `CRON_SECRET`.
 *
 * Shared by the cron/admin routes and the Settings page server actions, so
 * there is exactly one place that decides what counts as authorised.
 */
export function authorizeSecret(provided: string | null): AuthResult {
  const secret = readEnv("CRON_SECRET");
  if (!secret) {
    return {
      authorized: false,
      message:
        "CRON_SECRET is not configured on the server, so admin actions are disabled.",
    };
  }
  const candidate = provided?.trim();
  if (!candidate) return { authorized: false, message: "Enter the admin secret." };
  if (!safeEqual(candidate, secret)) {
    return { authorized: false, message: "Incorrect admin secret." };
  }
  return { authorized: true };
}

/**
 * Accepts either header form:
 *   Authorization: Bearer <secret>   (what Vercel Cron sends)
 *   x-cron-secret: <secret>          (convenient for manual curl)
 */
export function authorizeCronRequest(request: Request): AuthResult {
  const secret = readEnv("CRON_SECRET");
  if (!secret) {
    return {
      authorized: false,
      message:
        "CRON_SECRET is not configured on the server. This endpoint is disabled until it is set.",
    };
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const direct = request.headers.get("x-cron-secret")?.trim() ?? null;

  const provided = bearer ?? direct;
  if (!provided) {
    return { authorized: false, message: "Missing cron credentials." };
  }
  if (!safeEqual(provided, secret)) {
    return { authorized: false, message: "Invalid cron credentials." };
  }
  return { authorized: true };
}
