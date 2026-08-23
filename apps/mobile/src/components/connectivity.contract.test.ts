import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("connectivity overlay ownership", () => {
  it("mounts once at the root and nowhere in screen or sheet content", () => {
    const layout = source("../../app/_layout.tsx");
    const content = [
      source("./DayframeDashboard.tsx"),
      source("./ActiveTimerEditSheet.tsx"),
      source("./FloatingDatePicker.tsx"),
      source("./OverflowMenu.tsx"),
      source("../../app/place-editor.tsx"),
      source("../../app/places.tsx"),
      source("../../app/review.tsx"),
      source("../../app/review/[id].tsx"),
      source("../../app/settings.tsx")
    ].join("\n");

    expect(count(layout, "<ConnectivityStatusOverlay />")).toBe(1);
    expect(content).not.toContain("ConnectivityStatusOverlay");
    expect(content).not.toContain("ConnectivityStatusStrip");
  });

  it("keeps the root pill revisitable without mutating presentation state during render", () => {
    const overlay = source("./ConnectivityStatusStrip.tsx");

    expect(overlay).toContain("accessibilityLabel={viewModel.accessibilityLabel}");
    expect(overlay).toContain("accessibilityRole=\"text\"");
    expect(overlay).toContain("accessible");
    expect(overlay).not.toContain("accessibilityElementsHidden");
    expect(overlay).not.toContain("no-hide-descendants");
    expect(overlay).not.toContain("presentation.current =");
    expect(overlay).toContain("const viewModel = updated.viewModel");
    expect(overlay).toContain("setPresentation(updated.state)");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function count(value: string, needle: string) {
  return value.split(needle).length - 1;
}
