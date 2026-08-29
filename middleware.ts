import { NextResponse, type NextRequest } from "next/server";

/**
 * Makes `/settings` a genuine 404 for unprivileged visitors.
 *
 * The page component already calls `notFound()`, and that correctly renders
 * the not-found UI with no privileged content — but the STATUS stays 200,
 * because Next has committed the response before the component body runs.
 * A 200 on a "missing" page still tells a prober the route exists, which is
 * the one thing 404-instead-of-login was chosen to avoid.
 *
 * Middleware runs before any of that, so the status is decided cleanly here.
 * The component keeps its own check: this is a status-code fix, not the
 * security boundary, and the boundary must not depend on middleware matching.
 *
 * Runs on the Edge runtime, so it uses Web Crypto rather than `node:crypto` —
 * `lib/auth/access.ts` cannot be imported here.
 */

const ACCESS_COOKIE = "cpr_access";
const TOKEN_MESSAGE = "cpr-analytics/privileged/v1";

async function expectedToken(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(TOKEN_MESSAGE),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const key = process.env.ADMIN_ACCESS_KEY;
  const presented = request.cookies.get(ACCESS_COOKIE)?.value;

  if (key && presented && presented === (await expectedToken(key))) {
    return NextResponse.next();
  }

  // Rewriting to a path with no route makes Next render its own not-found UI
  // with a real 404, rather than returning a bare bodyless response.
  return NextResponse.rewrite(new URL("/__private", request.url), {
    status: 404,
  });
}

export const config = { matcher: ["/settings/:path*", "/settings"] };
