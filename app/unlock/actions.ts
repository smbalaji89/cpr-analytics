"use server";

import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  accessConfigured,
  accessToken,
  isValidAccessKey,
} from "@/lib/auth/access";

/**
 * Unlock / lock this device.
 *
 * The key arrives by POST, never in a URL: a query string lands in browser
 * history, server access logs and the Referer header of every subsequent
 * request, so a "click this link to unlock" design would scatter the secret
 * across places nobody thinks to clean.
 */

export interface UnlockState {
  error: string | null;
}

export async function unlockDevice(
  _previous: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const submitted = String(formData.get("key") ?? "");

  if (!accessConfigured()) {
    return {
      error:
        "No access key is configured on this deployment, so there is nothing to unlock.",
    };
  }

  if (!isValidAccessKey(submitted)) {
    // Identical message whether the key was wrong, blank or malformed — no
    // detail that would help someone narrow down a guess.
    return { error: "That key was not accepted." };
  }

  const token = accessToken();
  if (!token) return { error: "That key was not accepted." };

  const store = await cookies();
  store.set(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });

  return { error: null };
}

export async function lockDevice(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
}
