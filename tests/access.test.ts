import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Per-device access control and public redaction.
 *
 * The rule these defend: nothing a public visitor receives may name the data
 * vendor or the plumbing behind a figure. That is easy to get right once and
 * lose silently — the provenance reached `/history` not through the footer but
 * because the charts are CLIENT components, so Next serialised whole record
 * objects into the page source (22 occurrences per page, measured). Any future
 * component taking records as props would reopen it the same way.
 */

const cookieStore = { value: undefined as string | undefined };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "cpr_access" && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

const {
  ACCESS_COOKIE,
  accessConfigured,
  accessToken,
  isPrivileged,
  isValidAccessKey,
} = await import("@/lib/auth/access");
const { redactRecord, redactRecords, redactContext } = await import(
  "@/lib/cpr/redact"
);
const { noteFor } = await import("@/lib/instruments");
const { INSTRUMENTS } = await import("@/lib/instruments");

const KEY = "0123456789abcdef0123456789abcdef";
const originalKey = process.env.ADMIN_ACCESS_KEY;

afterEach(() => {
  cookieStore.value = undefined;
  if (originalKey === undefined) delete process.env.ADMIN_ACCESS_KEY;
  else process.env.ADMIN_ACCESS_KEY = originalKey;
});

function fullRecord() {
  return {
    instrumentSymbol: "NIFTY50",
    tradingDate: "2026-08-28",
    pivot: 24264.7,
    cprWidth: 56.95,
    overallClassification: "MIXED",
    dataSource: "upstox",
    providerSymbol: "NSE_INDEX|Nifty 50",
    isMockData: false,
  } as never;
}

describe("access key verification", () => {
  it("treats an unset key as nothing-to-unlock, never as open access", () => {
    delete process.env.ADMIN_ACCESS_KEY;
    expect(accessConfigured()).toBe(false);
    expect(accessToken()).toBeNull();
    expect(isValidAccessKey("anything")).toBe(false);
    expect(isValidAccessKey("")).toBe(false);
  });

  it("accepts the configured key and rejects near-misses", () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    expect(isValidAccessKey(KEY)).toBe(true);
    expect(isValidAccessKey(KEY.toUpperCase())).toBe(false);
    expect(isValidAccessKey(KEY.slice(0, -1))).toBe(false);
    expect(isValidAccessKey(`${KEY} `)).toBe(false);
    expect(isValidAccessKey("")).toBe(false);
  });

  it("never puts the key itself in the cookie", () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    const token = accessToken()!;
    expect(token).not.toContain(KEY);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the token when the key rotates, revoking every device", () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    const before = accessToken();
    process.env.ADMIN_ACCESS_KEY = `${KEY}00`;
    expect(accessToken()).not.toBe(before);
  });
});

describe("isPrivileged", () => {
  it("is false with no cookie", async () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    expect(await isPrivileged()).toBe(false);
  });

  it("is true for a cookie holding the correct token", async () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    cookieStore.value = accessToken()!;
    expect(await isPrivileged()).toBe(true);
  });

  it("is false for a tampered or stale token", async () => {
    process.env.ADMIN_ACCESS_KEY = KEY;
    const token = accessToken()!;
    cookieStore.value = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await isPrivileged()).toBe(false);

    cookieStore.value = token;
    process.env.ADMIN_ACCESS_KEY = `${KEY}ff`; // rotated
    expect(await isPrivileged()).toBe(false);
  });

  it("is false when no key is configured, whatever the cookie says", async () => {
    delete process.env.ADMIN_ACCESS_KEY;
    cookieStore.value = "f".repeat(64);
    expect(await isPrivileged()).toBe(false);
  });

  it("uses the expected cookie name", () => {
    expect(ACCESS_COOKIE).toBe("cpr_access");
  });
});

describe("record redaction", () => {
  it("removes every field that identifies the vendor or the series", () => {
    const redacted = redactRecord(fullRecord()) as Record<string, unknown>;
    expect(redacted).not.toHaveProperty("dataSource");
    expect(redacted).not.toHaveProperty("providerSymbol");
    expect(redacted).not.toHaveProperty("isMockData");
  });

  it("keeps every figure a reader actually needs", () => {
    const redacted = redactRecord(fullRecord()) as Record<string, unknown>;
    expect(redacted.pivot).toBe(24264.7);
    expect(redacted.cprWidth).toBe(56.95);
    expect(redacted.overallClassification).toBe("MIXED");
    expect(redacted.tradingDate).toBe("2026-08-28");
  });

  it("deletes rather than blanks, so nothing survives serialisation", () => {
    // A null/empty value would still ship the KEY name in the payload.
    const json = JSON.stringify(redactRecords([fullRecord()], false));
    for (const leak of ["dataSource", "providerSymbol", "upstox", "NSE_INDEX"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("passes records through untouched when privileged", () => {
    const [record] = redactRecords([fullRecord()], true) as Record<
      string,
      unknown
    >[];
    expect(record.dataSource).toBe("upstox");
    expect(record.providerSymbol).toBe("NSE_INDEX|Nifty 50");
  });
});

describe("context redaction", () => {
  const context = {
    provider: "upstox",
    providerLabel: "Upstox (Analytics Token)",
    isMockData: false,
    resolvedSymbol: "NSE_INDEX|Nifty 50",
    holidayCoverage: "COMPLETE" as const,
    fromDatabase: true,
  };

  it("strips the provider name and resolved symbol", () => {
    const redacted = redactContext(context, false);
    expect(redacted.providerLabel).toBe("");
    expect(redacted.provider).toBe("");
    expect(redacted.resolvedSymbol).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain("upstox");
  });

  it("PRESERVES isMockData so the synthetic-data warning can never be hidden", () => {
    // Showing invented prices without the banner is the one failure here that
    // could cause real financial harm. Redaction must not be able to suppress
    // it, so this is asserted rather than left to reviewer discipline.
    const mock = { ...context, isMockData: true, providerLabel: "Mock" };
    expect(redactContext(mock, false).isMockData).toBe(true);
  });
});

describe("public instrument notes", () => {
  it("no public note names a vendor or an environment variable", () => {
    for (const instrument of INSTRUMENTS) {
      const note = noteFor(instrument, false);
      if (!note) continue;
      expect(note).not.toMatch(/Upstox|Yahoo|MARKET_DATA_PROVIDER|Analytics Token/);
    }
  });

  it("still discloses the contract mismatch that matters", () => {
    // The point is to drop the sourcing, not the disclosure.
    const gold = INSTRUMENTS.find((i) => i.symbol === "GOLD_MCX")!;
    expect(noteFor(gold, false)).toMatch(/10 grams/);
    expect(noteFor(gold, false)).toMatch(/rolls/);
  });

  it("gives the full note to a privileged reader", () => {
    const gold = INSTRUMENTS.find((i) => i.symbol === "GOLD_MCX")!;
    expect(noteFor(gold, true)).toMatch(/Upstox/);
  });
});
