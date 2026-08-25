import { PRICE_DECIMALS, roundTo } from "@/lib/utils/number";
import type { PivotLevels } from "./types";

/**
 * Standard floor-trader pivot support/resistance levels (PRD §14).
 *
 * Derived from the same previous-session H/L/C as the CPR itself, so the levels
 * and the Central Pivot Range are always mutually consistent.
 *
 * Convention used (the `H + n(P − L)` / `L − n(H − P)` family):
 *
 *   R1 = 2P − L                 S1 = 2P − H
 *   R2 = P + (H − L)            S2 = P − (H − L)
 *   R3 = H + 2(P − L)           S3 = L − 2(H − P)
 *   R4 = H + 3(P − L)           S4 = L − 3(H − P)
 *   R5 = H + 4(P − L)           S5 = L − 4(H − P)
 *
 * R1–R3/S1–S3 are unambiguous across sources. R4/R5 and S4/S5 have more than one
 * convention in circulation; this file uses the self-consistent linear extension
 * above. If you need a different house convention, change it HERE only — nothing
 * else in the app derives these levels.
 */
export function calculatePivotLevels(
  high: number,
  low: number,
  pivot: number,
): PivotLevels {
  const range = high - low;
  const upLeg = pivot - low;
  const downLeg = high - pivot;

  const round = (v: number) => roundTo(v, PRICE_DECIMALS);

  return {
    r1: round(2 * pivot - low),
    r2: round(pivot + range),
    r3: round(high + 2 * upLeg),
    r4: round(high + 3 * upLeg),
    r5: round(high + 4 * upLeg),
    s1: round(2 * pivot - high),
    s2: round(pivot - range),
    s3: round(low - 2 * downLeg),
    s4: round(low - 3 * downLeg),
    s5: round(low - 4 * downLeg),
  };
}
