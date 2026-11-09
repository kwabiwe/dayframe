import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Codex r1 on #620: the per-place readings, silences and stops left the place and trip sheets (owner feedback,
// 29 Oct 2026) but stay reachable for support, in Settings › Something not syncing? › Location details.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Location details stay reachable outside the sheets", () => {
  it("lists today's places and trips with the diagnostic summary, from Sync help", () => {
    const route = read("../../../app/location-details.tsx");
    expect(route).toMatch(/evidencePlainSummary\(evidence, time\)/);
    expect(route).toMatch(/fetchTimelineItemEvidence\(/);
    const settings = read("../../../app/settings.tsx");
    expect(settings).toMatch(/router\.push\("\.\/location-details"\)/);
    expect(settings).toMatch(/title="Location details"/);
    expect(read("../../../app/_layout.tsx")).toMatch(/<Stack\.Screen name="location-details"/);
  });

  it("never puts the summary back in the sheets", () => {
    const sheet = read("../calendar/LocationCorrectionSheet.tsx");
    expect(sheet).not.toMatch(/evidencePlainSummary/);
    expect(sheet).toMatch(/caption=\{evidenceSheetCaption\(/);
  });
});
