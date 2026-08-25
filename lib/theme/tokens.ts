/**
 * Centralized theme configuration (PRD §18).
 *
 * This file is the SINGLE SOURCE OF TRUTH for every colour used in the app.
 *
 * Two consumers need these values in different forms:
 *   1. Tailwind utilities  -> `app/globals.css` mirrors these hexes in its `@theme` block.
 *   2. Recharts / canvas   -> needs literal colour strings at runtime, imported from here.
 *
 * `tests/theme.test.ts` parses `globals.css` and asserts the two stay in sync, so
 * changing a colour here without updating the stylesheet fails the test suite.
 */

/** Base palette from PRD §18. Change colours HERE (and in globals.css). */
export const palette = {
  background: "#FFFFFF",
  primaryDark: "#111827",
  secondaryDark: "#1F2937",
  primaryPurple: "#7C3AED",
  secondaryPurple: "#A78BFA",
  lightPurple: "#F3E8FF",
  border: "#E5E7EB",
} as const;

/**
 * Classification colours — the app's categorical palette.
 *
 * Deliberately NOT a red/green profit-loss scale: a wide CPR is not "bad" and a
 * narrow CPR is not "good", they imply different expected session behaviour
 * (trending vs range-bound). A categorical hue set avoids implying a value
 * judgement.
 *
 * ── Validated, not eyeballed ───────────────────────────────────────────────
 * The four meaningful classifications were checked with the dataviz palette
 * validator over ALL pairs, not just adjacent ones, since any combination can
 * appear in one chart:
 *
 *   light  #7C3AED #D97706 #0891B2 #DB2777  — all checks pass, no warnings
 *          (worst all-pairs CVD ΔE 10.3 deutan, normal-vision floor 20.3)
 *   dark   #8B5CF6 #D97706 #0EA5B9 #EC4899  — all checks pass
 *          (worst all-pairs CVD ΔE 6.3 deutan, normal-vision floor 20.1)
 *
 * The dark pair CONFLICTING↔WIDER sits in the 6–8 ΔE floor band, which is only
 * permissible alongside secondary encoding. That condition is met everywhere the
 * colours are used: classification is always accompanied by its text label
 * (badges, chart legend, tooltips) and the table view repeats it as text, so
 * colour is never the sole carrier of identity.
 *
 * UNCLASSIFIED is intentionally desaturated grey. It is a null/not-applicable
 * state rather than a data series, so it is excluded from the categorical
 * validation — reading as "no value" is exactly what it should do.
 */
export const classificationColors = {
  NARROW: "#7C3AED",
  MIXED: "#D97706",
  WIDER: "#0891B2",
  CONFLICTING: "#DB2777",
  UNCLASSIFIED: "#64748B",
} as const;

/** Dark-mode steps of the same palette — re-validated against the dark surface. */
export const classificationColorsDark = {
  NARROW: "#8B5CF6",
  MIXED: "#D97706",
  WIDER: "#0EA5B9",
  CONFLICTING: "#EC4899",
  UNCLASSIFIED: "#94A3B8",
} as const;

export const chartColors = {
  grid: "#E5E7EB",
  axis: "#6B7280",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E5E7EB",
  tooltipText: "#111827",
} as const;

export const chartColorsDark = {
  grid: "#374151",
  axis: "#9CA3AF",
  tooltipBg: "#1F2937",
  tooltipBorder: "#374151",
  tooltipText: "#F9FAFB",
} as const;

export type ClassificationColorKey = keyof typeof classificationColors;

/**
 * Resolve a classification to its theme colour.
 *
 * `BELOW_RANGE` / `ABOVE_RANGE` are single-method out-of-band markers rather
 * than verdicts, so they share the neutral UNCLASSIFIED grey.
 */
export function colorForClassification(key: string, dark = false): string {
  const source = dark ? classificationColorsDark : classificationColors;
  return source[key as ClassificationColorKey] ?? source.UNCLASSIFIED;
}
