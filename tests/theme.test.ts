import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classificationColors,
  classificationColorsDark,
  colorForClassification,
  palette,
} from "@/lib/theme/tokens";

/**
 * Guards the "centralized theme configuration" claim (PRD §18).
 *
 * Colours live in two places by necessity — `tokens.ts` for Recharts, which
 * needs literal strings at runtime, and `globals.css` for Tailwind utilities.
 * This test parses the stylesheet and asserts the two agree, so the claim cannot
 * quietly become false when someone edits one and not the other.
 */

const css = readFileSync(
  join(process.cwd(), "app", "globals.css"),
  "utf8",
);

/** Read a custom property from a specific block of the stylesheet. */
function readVar(block: string, name: string): string | null {
  const blockMatch = css.match(
    new RegExp(`${block}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"),
  );
  if (!blockMatch) return null;
  const varMatch = blockMatch[1].match(
    new RegExp(`--${name}:\\s*([^;]+);`),
  );
  return varMatch ? varMatch[1].trim().toLowerCase() : null;
}

describe("theme tokens stay in sync with globals.css", () => {
  it.each([
    ["cls-narrow", classificationColors.NARROW],
    ["cls-mixed", classificationColors.MIXED],
    ["cls-wider", classificationColors.WIDER],
    ["cls-conflicting", classificationColors.CONFLICTING],
    ["cls-unclassified", classificationColors.UNCLASSIFIED],
  ])("light --color-%s matches tokens.ts", (name, expected) => {
    expect(readVar("@theme", `color-${name}`)).toBe(expected.toLowerCase());
  });

  it.each([
    ["cls-narrow", classificationColorsDark.NARROW],
    ["cls-mixed", classificationColorsDark.MIXED],
    ["cls-wider", classificationColorsDark.WIDER],
    ["cls-conflicting", classificationColorsDark.CONFLICTING],
    ["cls-unclassified", classificationColorsDark.UNCLASSIFIED],
  ])("dark --color-%s matches tokens.ts", (name, expected) => {
    expect(readVar("\\.dark", `color-${name}`)).toBe(expected.toLowerCase());
  });

  it("uses the PRD §18 base palette", () => {
    expect(readVar("@theme", "color-surface")).toBe(
      palette.background.toLowerCase(),
    );
    expect(readVar("@theme", "color-ink")).toBe(
      palette.primaryDark.toLowerCase(),
    );
    expect(readVar("@theme", "color-brand")).toBe(
      palette.primaryPurple.toLowerCase(),
    );
    expect(readVar("@theme", "color-brand-soft")).toBe(
      palette.secondaryPurple.toLowerCase(),
    );
    expect(readVar("@theme", "color-brand-tint")).toBe(
      palette.lightPurple.toLowerCase(),
    );
    expect(readVar("@theme", "color-line")).toBe(palette.border.toLowerCase());
  });

  it("defines a dark override for every classification colour", () => {
    for (const key of Object.keys(classificationColors)) {
      expect(classificationColorsDark).toHaveProperty(key);
    }
  });
});

describe("colorForClassification", () => {
  it("resolves each verdict to its own colour", () => {
    expect(colorForClassification("NARROW")).toBe(classificationColors.NARROW);
    expect(colorForClassification("CONFLICTING")).toBe(
      classificationColors.CONFLICTING,
    );
  });

  it("uses the dark step when asked", () => {
    expect(colorForClassification("NARROW", true)).toBe(
      classificationColorsDark.NARROW,
    );
  });

  it("falls back to the neutral grey for out-of-band markers", () => {
    // BELOW_RANGE/ABOVE_RANGE are not verdicts, so they must not borrow a
    // verdict's colour and imply one.
    expect(colorForClassification("BELOW_RANGE")).toBe(
      classificationColors.UNCLASSIFIED,
    );
    expect(colorForClassification("ABOVE_RANGE")).toBe(
      classificationColors.UNCLASSIFIED,
    );
    expect(colorForClassification("anything-else")).toBe(
      classificationColors.UNCLASSIFIED,
    );
  });
});
