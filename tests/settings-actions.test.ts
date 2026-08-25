import { afterEach, describe, expect, it } from "vitest";
import { cleanupNowAction, syncNowAction } from "@/app/settings/actions";

/**
 * Settings page server actions.
 *
 * The button must ALWAYS end up with a result. A pending state that never
 * resolves is the worst outcome here: the user cannot tell whether the work
 * ran, and pressing again risks doing it twice.
 */

const SECRET = "test-secret-value-for-actions";
const original = process.env.CRON_SECRET;

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  delete process.env.DATABASE_URL;
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

describe("authorisation", () => {
  it("refuses when no secret is configured on the server", async () => {
    delete process.env.CRON_SECRET;
    const result = await cleanupNowAction(null, form({ secret: "anything" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not configured");
  });

  it("refuses an empty secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const result = await cleanupNowAction(null, form({ secret: "" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Enter the admin secret");
  });

  it("refuses a wrong secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const result = await cleanupNowAction(null, form({ secret: "wrong-value" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Incorrect");
  });

  it("refuses a wrong secret of matching length without throwing", async () => {
    // timingSafeEqual throws on length mismatch if the guard is missing.
    process.env.CRON_SECRET = SECRET;
    const same = "x".repeat(SECRET.length);
    await expect(
      cleanupNowAction(null, form({ secret: same })),
    ).resolves.toMatchObject({ ok: false });
  });

  it("applies the same rules to sync", async () => {
    process.env.CRON_SECRET = SECRET;
    const result = await syncNowAction(null, form({ secret: "nope" }));
    expect(result.ok).toBe(false);
  });
});

describe("actions always resolve", () => {
  it("cleanup returns a result with no database configured", async () => {
    process.env.CRON_SECRET = SECRET;
    delete process.env.DATABASE_URL;
    const result = await cleanupNowAction(null, form({ secret: SECRET }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("0 row(s) removed");
  });

  it("sync returns a per-instrument report rather than throwing", async () => {
    process.env.CRON_SECRET = SECRET;
    process.env.MARKET_DATA_PROVIDER = "mock";
    const result = await syncNowAction(
      null,
      form({ secret: SECRET, instrument: "NIFTY50" }),
    );
    // The mock provider is refused for writes, so this reports a failure —
    // but it REPORTS it rather than hanging or throwing.
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("message");
    expect(Array.isArray(result.detail)).toBe(true);
  }, 30_000);

  it("never returns the secret back to the client", async () => {
    process.env.CRON_SECRET = SECRET;
    const result = await cleanupNowAction(null, form({ secret: SECRET }));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
