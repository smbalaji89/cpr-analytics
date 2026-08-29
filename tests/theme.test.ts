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
    expect(readVar("@theme", "color-brand")).toBe(palette.accent.toLowerCase());
    expect(readVar("@theme", "color-brand-soft")).toBe(
      palette.accentSoft.toLowerCase(),
    );
    expect(readVar("@theme", "color-brand-tint")).toBe(
      palette.accentTint.toLowerCase(),
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

describe("filled surfaces stay legible in both modes", () => {
  /**
   * The bug this pins: `--color-brand` flipped from a dark neutral (light
   * mode) to a near-white one (dark mode), but the logo, the DECIDES chip and
   * the category filters paired `bg-brand` with a hardcoded `text-white`.
   * In dark mode that rendered white on white — the elements vanished.
   *
   * A colour and the text placed ON it are a PAIR. Asserting the pair rather
   * than either value is what makes this catchable.
   */
  function contrast(a: string, b: string): number {
    const channel = (hex: string) =>
      (hex.replace("#", "").match(/../g) ?? []).map((pair) => {
        const v = parseInt(pair, 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
    const luminance = (hex: string) => {
      const [r, g, b2] = channel(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  it("pairs a foreground with the brand fill in BOTH modes", () => {
    const lightBrand = readVar("@theme", "color-brand");
    const lightOn = readVar("@theme", "color-on-brand");
    const darkBrand = readVar(".dark", "color-brand");
    const darkOn = readVar(".dark", "color-on-brand");

    for (const [fill, text, mode] of [
      [lightBrand, lightOn, "light"],
      [darkBrand, darkOn, "dark"],
    ] as const) {
      // A missing token would otherwise sail through as a null comparison.
      expect(fill, `${mode}: --color-brand is defined`).toBeTruthy();
      expect(text, `${mode}: --color-on-brand is defined`).toBeTruthy();
      expect(
        contrast(fill!, text!),
        `${mode}: text on brand fill`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the brand fill and its foreground on opposite sides of mid-grey", () => {
    // If both land light (or both dark) the element disappears, which is
    // exactly what happened, so assert they genuinely invert.
    const lightBrand = readVar("@theme", "color-brand");
    const darkBrand = readVar(".dark", "color-brand");
    expect(lightBrand).not.toBe(darkBrand);
    expect(readVar("@theme", "color-on-brand")).not.toBe(
      readVar(".dark", "color-on-brand"),
    );
  });

  it("no component hardcodes a text colour on a brand fill", async () => {
    // The token only helps if nothing bypasses it.
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir("components", { recursive: true });
    for (const file of files) {
      if (!String(file).endsWith(".tsx")) continue;
      const source = await readFile(`components/${file}`, "utf8");
      for (const line of source.split(/\r?\n/)) {
        if (line.includes("bg-brand") && !line.includes("bg-brand-")) {
          expect(line, `${file}: pair bg-brand with text-on-brand`).not.toMatch(
            /text-white|text-black/,
          );
        }
      }
    }
  });
});
