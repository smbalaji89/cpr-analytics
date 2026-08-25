import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getCPR } from "@/app/api/cpr/route";
import { GET as getInstruments } from "@/app/api/instruments/route";
import { GET as getRange } from "@/app/api/cpr/range/route";
import { GET as cronCleanup } from "@/app/api/cron/cleanup/route";
import { GET as cronSync } from "@/app/api/cron/sync/route";
import { POST as adminSync } from "@/app/api/admin/sync/route";
import { INSTRUMENTS } from "@/lib/instruments";
import { addDays, todayInTimeZone } from "@/lib/utils/date";

/**
 * API route tests (PRD §40).
 *
 * These call the route handlers directly rather than over HTTP, so the suite
 * stays fast and hermetic. Every case below short-circuits in validation or the
 * retention check BEFORE any provider call, so no test here touches the network.
 */

const ORIGIN = "http://localhost";

function req(path: string, init?: RequestInit) {
  return new Request(`${ORIGIN}${path}`, init);
}

async function body(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
    meta?: Record<string, unknown>;
  };
}

describe("GET /api/instruments", () => {
  it("returns every registered instrument, grouped", async () => {
    const json = await body(await getInstruments());
    expect(json.ok).toBe(true);

    const groups = json.data!.groups as { instruments: unknown[] }[];
    const total = groups.reduce((n, g) => n + g.instruments.length, 0);
    expect(total).toBe(INSTRUMENTS.length);
    expect(json.data!.defaultInstrument).toBe("NIFTY50");
    expect(json.data!.retentionDays).toBe(90);
  });

  it("covers all seven instruments required by the PRD", async () => {
    const json = await body(await getInstruments());
    const groups = json.data!.groups as {
      instruments: { symbol: string }[];
    }[];
    const symbols = groups.flatMap((g) => g.instruments.map((i) => i.symbol));
    expect(symbols).toEqual(
      expect.arrayContaining([
        "NIFTY50",
        "BANKNIFTY",
        "SENSEX",
        "GOLD",
        "SILVER",
        "CRUDEOIL",
        "BTC",
      ]),
    );
  });
});

describe("GET /api/cpr — validation", () => {
  it("rejects an unknown instrument with the valid list", async () => {
    const response = await getCPR(req("/api/cpr?instrument=TESLA"));
    expect(response.status).toBe(400);
    const json = await body(response);
    expect(json.error!.code).toBe("BAD_REQUEST");
    expect(json.error!.message).toContain("NIFTY50");
  });

  it("rejects a missing instrument", async () => {
    const response = await getCPR(req("/api/cpr"));
    expect(response.status).toBe(400);
  });

  it("rejects a malformed date", async () => {
    const response = await getCPR(
      req("/api/cpr?instrument=NIFTY50&date=24-08-2026"),
    );
    expect(response.status).toBe(400);
    const json = await body(response);
    expect(json.error!.message).toContain("YYYY-MM-DD");
  });

  it("rejects an impossible calendar date", async () => {
    const response = await getCPR(
      req("/api/cpr?instrument=NIFTY50&date=2026-02-31"),
    );
    expect(response.status).toBe(400);
  });

  it("accepts a lowercase instrument symbol", async () => {
    // Reaches validation cleanly; a 400 would mean the transform failed.
    const response = await getCPR(
      req("/api/cpr?instrument=nifty50&date=1999-01-01"),
    );
    expect(response.status).not.toBe(400);
  });
});

describe("GET /api/cpr — 90-day retention window (PRD §6, §30)", () => {
  it("refuses a date older than the window without calling the provider", async () => {
    const response = await getCPR(
      req("/api/cpr?instrument=NIFTY50&date=2019-01-02"),
    );
    // A closed window is a legitimate answer, not a server error.
    expect(response.status).toBe(200);
    const json = await body(response);
    expect(json.data!.available).toBe(false);
    const error = json.data!.error as { reason: string; suggestedDate: string };
    expect(error.reason).toBe("OUT_OF_RANGE");
    expect(error.suggestedDate).toBeTruthy();
  });

  it("reports the earliest selectable date as exactly 90 days back", async () => {
    const response = await getCPR(
      req("/api/cpr?instrument=NIFTY50&date=2019-01-02"),
    );
    const json = await body(response);
    const today = todayInTimeZone("Asia/Kolkata");
    expect(json.meta!.earliestSelectableDate).toBe(addDays(today, -90));
    expect(json.meta!.retentionDays).toBe(90);
  });
});

describe("GET /api/cpr/range", () => {
  it("rejects a start date outside the retention window", async () => {
    const response = await getRange(
      req("/api/cpr/range?instrument=NIFTY50&start=2019-01-01&end=2026-08-24"),
    );
    expect(response.status).toBe(400);
    const json = await body(response);
    expect(json.error!.code).toBe("OUT_OF_RANGE");
  });

  it("rejects a start after the end", async () => {
    const response = await getRange(
      req("/api/cpr/range?instrument=NIFTY50&start=2026-08-24&end=2026-08-01"),
    );
    expect(response.status).toBe(400);
    const json = await body(response);
    expect(json.error!.message).toContain("start must be on or before end");
  });

  it("requires both bounds", async () => {
    const response = await getRange(
      req("/api/cpr/range?instrument=NIFTY50&start=2026-08-01"),
    );
    expect(response.status).toBe(400);
  });
});

describe("cron and admin authorisation (PRD §21, §32)", () => {
  const original = process.env.CRON_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("fails CLOSED when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    for (const response of [
      await cronSync(req("/api/cron/sync")),
      await cronCleanup(req("/api/cron/cleanup")),
      await adminSync(req("/api/admin/sync", { method: "POST" })),
    ]) {
      expect(response.status).toBe(401);
      const json = await body(response);
      expect(json.error!.message).toContain("CRON_SECRET is not configured");
    }
  });

  describe("with a secret configured", () => {
    beforeEach(() => {
      process.env.CRON_SECRET = "test-secret-value";
    });

    it("rejects a request with no credentials", async () => {
      const response = await cronCleanup(req("/api/cron/cleanup"));
      expect(response.status).toBe(401);
      expect((await body(response)).error!.message).toContain("Missing");
    });

    it("rejects a wrong secret", async () => {
      const response = await cronCleanup(
        req("/api/cron/cleanup", {
          headers: { authorization: "Bearer wrong-value-x" },
        }),
      );
      expect(response.status).toBe(401);
      expect((await body(response)).error!.message).toContain("Invalid");
    });

    it("rejects a secret of a different length without throwing", async () => {
      // timingSafeEqual throws on length mismatch if not guarded.
      const response = await cronCleanup(
        req("/api/cron/cleanup", {
          headers: { authorization: "Bearer short" },
        }),
      );
      expect(response.status).toBe(401);
    });

    it("accepts the Vercel Cron bearer header", async () => {
      const response = await cronCleanup(
        req("/api/cron/cleanup", {
          headers: { authorization: "Bearer test-secret-value" },
        }),
      );
      expect(response.status).toBe(200);
    });

    it("accepts the x-cron-secret header", async () => {
      const response = await cronCleanup(
        req("/api/cron/cleanup", {
          headers: { "x-cron-secret": "test-secret-value" },
        }),
      );
      expect(response.status).toBe(200);
    });

    it("skips cleanup cleanly when no database is configured", async () => {
      const dbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        const json = await body(
          await cronCleanup(
            req("/api/cron/cleanup", {
              headers: { authorization: "Bearer test-secret-value" },
            }),
          ),
        );
        expect(json.ok).toBe(true);
        expect(json.data!.skipped).toBe(true);
        expect(json.data!.retentionDays).toBe(90);
      } finally {
        if (dbUrl !== undefined) process.env.DATABASE_URL = dbUrl;
      }
    });

    it("rejects a malformed admin sync body before doing any work", async () => {
      const response = await adminSync(
        req("/api/admin/sync", {
          method: "POST",
          headers: { authorization: "Bearer test-secret-value" },
          body: "{not json",
        }),
      );
      expect(response.status).toBe(400);
      expect((await body(response)).error!.message).toContain("valid JSON");
    });

    it("rejects an unknown instrument in the admin sync body", async () => {
      const response = await adminSync(
        req("/api/admin/sync", {
          method: "POST",
          headers: { authorization: "Bearer test-secret-value" },
          body: JSON.stringify({ instruments: ["DOGECOIN"] }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });
});

describe("response envelope", () => {
  it("never caches an error response", async () => {
    const response = await getCPR(req("/api/cpr?instrument=NOPE"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("caches the static instrument registry", async () => {
    const response = await getInstruments();
    expect(response.headers.get("cache-control")).toContain("s-maxage");
  });
});
