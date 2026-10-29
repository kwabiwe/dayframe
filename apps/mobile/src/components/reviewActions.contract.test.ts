import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// The Review deck, its More menu and the Location evidence screen are gone (location v4 step 15): every "?" is
// answered in Calendar › List with the one rule below. What they shared with the List and the sheets stays pinned.
const answerSource = source("../lib/reviewAnswer.ts");
const evidenceMapSource = source("./location/LocationEvidenceMap.tsx");
const helperSource = source("../lib/review.ts");
const editSheetSource = source("./ActiveTimerEditSheet.tsx");

describe("mobile Review action contracts", () => {
  it("answers with the deck's mutations, in the one rule Calendar › List uses (location v4 step 14, part 3b)", () => {
    expect(answerSource).toMatch(/\{ action: "confirm" \} : \{ action: "accept" \}[\s\S]*?\{ action: "ignore_once_location" \} : \{ action: "ignore_once" \}/);
    expect(helperSource).toContain("Confirm commute");
  });

  it("keeps the shared activity chips at 44-point targets", () => {
    const chipsSource = source("./ActivityChips.tsx");
    // 38-point chips with 6 points of slop above and below: at least 44-point targets.
    expect(chipsSource).toContain("minHeight: 38");
    expect(chipsSource).toContain("const CHIP_HIT_SLOP = { top: 6, bottom: 6 };");
    expect(chipsSource).not.toContain("CheckGlyph");
  });

  it("keeps technical map evidence out of the simplified mobile presentation", () => {
    expect(evidenceMapSource).toContain("showDetails = true");
    expect(evidenceMapSource).toContain('title="Start"');
    expect(evidenceMapSource).toContain('title="End"');
    expect(evidenceMapSource).toContain("Approximate route · detailed path unavailable");
    // Time away is an absence: no commute map wording (the server sends no route line for it).
    expect(evidenceMapSource).toContain('? "Map of readings while you were away."');
    expect(evidenceMapSource).toContain("showDetails ? evidence.map.anchors.map");
  });

  it("focuses the entry sheet's description once the modal has shown", () => {
    expect(editSheetSource).toContain("onShow={handleModalShow}");
    expect(editSheetSource).toContain("descriptionInputRef.current?.focus()");
    expect(editSheetSource).not.toContain("focusDescriptionOnShow");
  });
});
