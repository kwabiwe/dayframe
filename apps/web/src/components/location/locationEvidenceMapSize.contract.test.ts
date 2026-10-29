import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Glitch fix 3 (29 Oct 2026): the correction dialog's map placeholder was 180 px while the map's frame was 18rem, so
// the sheet jumped when the map arrived. Both now take one height, at every breakpoint.
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/** Every declaration block for `selector`, media-query copies included. */
function blocks(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|[\\n,}])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
}

describe("the map's placeholder and frame are one size (glitch fix 3)", () => {
  it("defines the frame height once", () => {
    const definitions = [...css.matchAll(/--location-evidence-frame-height:\s*([^;]+);/g)].map((match) => match[1].trim());
    expect(definitions).toEqual(["160px"]);
  });

  it("sizes the frame, the map, the empty state and the loading placeholder from it", () => {
    for (const selector of [".location-evidence-frame", ".location-evidence-map", ".location-evidence-empty"]) {
      const heights = blocks(selector).flatMap((body) => [...body.matchAll(/(?:^|;|\s)(min-height|height):\s*([^;]+);/g)].map((match) => match[2].trim()));
      expect(heights, selector).toEqual(expect.arrayContaining(["var(--location-evidence-frame-height)"]));
      expect(heights.every((value) => value === "var(--location-evidence-frame-height)"), selector).toBe(true);
    }
    const placeholder = blocks(".location-correction-map.is-loading").join("\n");
    expect(placeholder).toMatch(/(?:^|\s)height: var\(--location-evidence-frame-height\);/);
    expect(placeholder).toMatch(/box-sizing: border-box;/);
    expect(placeholder).not.toMatch(/padding/);
    // The wrapper holds the frame's height while the map's chunk loads (Codex r1 on #626).
    expect(blocks(".location-correction-map").join("\n")).toMatch(/min-height: var\(--location-evidence-frame-height\);/);
  });
});

describe("the map's chunk loading holds the frame (Codex r1 on #626)", () => {
  it("gives the dynamic import a loading fallback that is the frame itself", () => {
    const dialog = readFileSync(new URL("./LocationCorrectionDialog.tsx", import.meta.url), "utf8");
    expect(dialog).toMatch(/loading: EvidenceMapChunkLoading, ssr: false/);
    expect(dialog).toMatch(/className="location-evidence-frame" data-testid="evidence-map-loading"/);
  });
});
