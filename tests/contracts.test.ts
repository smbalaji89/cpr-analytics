import { describe, expect, it } from "vitest";
import {
  CONTRACT_SPECS,
  generateContractSymbols,
  median,
} from "@/lib/market-data/contracts";
import { INSTRUMENTS, requireInstrument } from "@/lib/instruments";

/**
 * Futures contract resolution.
 *
 * These guard the fix for Yahoo's defective `=F` aliases, which understated the
 * median daily range by 58 % (silver) and 29 % (gold) against the identical
 * contract fetched explicitly.
 */

describe("generateContractSymbols", () => {
  it("generates COMEX gold months (Feb/Apr/Jun/Aug/Oct/Dec)", () => {
    expect(generateContractSymbols(CONTRACT_SPECS.GOLD, "2026-08-24", 4)).toEqual(
      ["GCQ26.CMX", "GCV26.CMX", "GCZ26.CMX", "GCG27.CMX"],
    );
  });

  it("generates COMEX silver months (Mar/May/Jul/Sep/Dec)", () => {
    expect(
      generateContractSymbols(CONTRACT_SPECS.SILVER, "2026-08-24", 4),
    ).toEqual(["SIU26.CMX", "SIZ26.CMX", "SIH27.CMX", "SIK27.CMX"]);
  });

  it("generates every month for NYMEX crude", () => {
    expect(generateContractSymbols(CONTRACT_SPECS.CRUDE, "2026-08-24", 3)).toEqual(
      ["CLQ26.NYM", "CLU26.NYM", "CLV26.NYM"],
    );
  });

  it("rolls the year over correctly", () => {
    expect(generateContractSymbols(CONTRACT_SPECS.GOLD, "2026-12-15", 3)).toEqual(
      ["GCZ26.CMX", "GCG27.CMX", "GCJ27.CMX"],
    );
    expect(
      generateContractSymbols(CONTRACT_SPECS.CRUDE, "2029-11-02", 4),
    ).toEqual(["CLX29.NYM", "CLZ29.NYM", "CLF30.NYM", "CLG30.NYM"]);
  });

  it("includes the current month so an unexpired front contract stays a candidate", () => {
    // August is a listed gold month; the liquidity probe decides whether it is
    // still the front month or has already rolled away.
    const symbols = generateContractSymbols(
      CONTRACT_SPECS.GOLD,
      "2026-08-01",
      1,
    );
    expect(symbols[0]).toBe("GCQ26.CMX");
  });

  it("never emits a month the product does not list", () => {
    const gold = generateContractSymbols(CONTRACT_SPECS.GOLD, "2026-01-01", 12);
    // Gold lists no January (F), March (H), May (K), July (N), Sep (U), Nov (X).
    for (const forbidden of ["GCF", "GCH", "GCK", "GCN", "GCU", "GCX"]) {
      expect(gold.some((s) => s.startsWith(forbidden))).toBe(false);
    }
  });

  it("returns exactly the requested count", () => {
    for (const spec of Object.values(CONTRACT_SPECS)) {
      expect(generateContractSymbols(spec, "2026-08-24", 6)).toHaveLength(6);
    }
  });

  it("rejects an unknown month code rather than emitting a bad symbol", () => {
    expect(() =>
      generateContractSymbols(
        { root: "XX", exchangeSuffix: "CMX", monthCodes: ["A"], label: "bogus" },
        "2026-08-24",
        1,
      ),
    ).toThrow(/month code/);
  });
});

describe("median", () => {
  it("handles odd and even lengths", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("instrument contract wiring", () => {
  it("configures explicit contracts for every futures instrument", () => {
    for (const symbol of ["GOLD", "SILVER", "CRUDEOIL"]) {
      const instrument = requireInstrument(symbol);
      expect(instrument.futuresContract).toBeDefined();
      // The `=F` alias must never be the symbol actually queried.
      expect(instrument.futuresContract!.exchangeSuffix).toMatch(/^(CMX|NYM)$/);
    }
  });

  it("leaves indices and crypto on their static symbols", () => {
    for (const symbol of ["NIFTY50", "BANKNIFTY", "SENSEX", "BTC"]) {
      expect(requireInstrument(symbol).futuresContract).toBeUndefined();
    }
  });

  it("gives every instrument a Yahoo symbol EXCEPT the MCX contracts", () => {
    // Yahoo has no MCX coverage at all — every MCX symbol returns 404 — so the
    // MCX instruments are reachable only through Upstox. They report
    // unavailable on the default provider, which is correct: showing a COMEX
    // proxy under an MCX name would be worse than showing nothing.
    for (const instrument of INSTRUMENTS) {
      if (instrument.market === "MCX") {
        expect(instrument.providerSymbols.yahoo).toBeUndefined();
        expect(instrument.upstoxContract).toBeDefined();
      } else {
        expect(instrument.providerSymbols.yahoo).toBeTruthy();
      }
    }
  });
});
