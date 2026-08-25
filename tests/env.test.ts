import { afterEach, describe, expect, it } from "vitest";
import {
  hasEnv,
  readEnv,
  readEnvBool,
  readEnvInt,
  readEnvOr,
} from "@/lib/utils/env";
import { getMarketDataProvider } from "@/lib/market-data";
import { isDatabaseConfigured } from "@/lib/db/client";
import { retentionDays } from "@/lib/services/retention";

/**
 * Blank environment variables must behave exactly like unset ones.
 *
 * This is a regression suite for a real production outage: `MARKET_DATA_PROVIDER`
 * was declared with an empty value in Vercel, `process.env.X ?? "yahoo"` passed
 * the empty string straight through (`??` only catches null/undefined), and the
 * provider factory threw "Unknown MARKET_DATA_PROVIDER" on every render — which
 * reached users as an opaque Server Components digest error.
 */

const KEYS = [
  "MARKET_DATA_PROVIDER",
  "DATA_RETENTION_DAYS",
  "DATABASE_URL",
  "CRON_SECRET",
  "ALLOW_MOCK_PROVIDER_IN_PRODUCTION",
  "__TEST_ENV_KEY",
] as const;
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("readEnv", () => {
  it("treats unset, empty and whitespace-only alike", () => {
    delete process.env.__TEST_ENV_KEY;
    expect(readEnv("__TEST_ENV_KEY")).toBeUndefined();

    process.env.__TEST_ENV_KEY = "";
    expect(readEnv("__TEST_ENV_KEY")).toBeUndefined();

    process.env.__TEST_ENV_KEY = "   ";
    expect(readEnv("__TEST_ENV_KEY")).toBeUndefined();
  });

  it("trims a real value", () => {
    process.env.__TEST_ENV_KEY = "  yahoo  ";
    expect(readEnv("__TEST_ENV_KEY")).toBe("yahoo");
    expect(hasEnv("__TEST_ENV_KEY")).toBe(true);
  });

  it("falls back for blank values, which `??` would not", () => {
    process.env.__TEST_ENV_KEY = "";
    expect(readEnvOr("__TEST_ENV_KEY", "fallback")).toBe("fallback");
    // The exact expression that caused the outage:
    expect(process.env.__TEST_ENV_KEY ?? "fallback").toBe("");
  });

  it("parses positive integers and rejects nonsense", () => {
    for (const [value, expected] of [
      ["30", 30],
      ["", 90],
      ["   ", 90],
      ["0", 90],
      ["-5", 90],
      ["abc", 90],
      ["45.7", 45],
    ] as const) {
      process.env.__TEST_ENV_KEY = value;
      expect(readEnvInt("__TEST_ENV_KEY", 90)).toBe(expected);
    }
  });

  it("only accepts an explicit true", () => {
    for (const [value, expected] of [
      ["true", true],
      ["TRUE", true],
      ["", false],
      ["yes", false],
      ["1", false],
    ] as const) {
      process.env.__TEST_ENV_KEY = value;
      expect(readEnvBool("__TEST_ENV_KEY")).toBe(expected);
    }
  });
});

describe("the production outage cannot recur", () => {
  it("a BLANK MARKET_DATA_PROVIDER falls back to yahoo instead of throwing", () => {
    process.env.MARKET_DATA_PROVIDER = "";
    expect(() => getMarketDataProvider()).not.toThrow();
    expect(getMarketDataProvider().id).toBe("yahoo");
  });

  it("whitespace-only also falls back", () => {
    process.env.MARKET_DATA_PROVIDER = "  ";
    expect(getMarketDataProvider().id).toBe("yahoo");
  });

  it("a genuinely wrong value still throws — the guard is not blanket", () => {
    process.env.MARKET_DATA_PROVIDER = "bloomberg";
    expect(() => getMarketDataProvider()).toThrow(/Unknown MARKET_DATA_PROVIDER/);
  });

  it("a blank DATABASE_URL reads as not configured, not as a bad URL", () => {
    process.env.DATABASE_URL = "";
    expect(isDatabaseConfigured()).toBe(false);
    process.env.DATABASE_URL = "   ";
    expect(isDatabaseConfigured()).toBe(false);
  });

  it("a blank DATA_RETENTION_DAYS keeps the 90-day default", () => {
    process.env.DATA_RETENTION_DAYS = "";
    expect(retentionDays()).toBe(90);
  });
});
