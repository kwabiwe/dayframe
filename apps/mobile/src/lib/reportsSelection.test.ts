import { describe, expect, it } from "vitest";
import {
  applyReportFilterDraft,
  normalizeReportSelection,
  openReportFilterDraft,
  reportSelectionIncludes,
  selectAllReportFilterDraft,
  toggleReportCategory,
  toggleReportFilterDraftKey,
} from "./reportsSelection";
describe("Revision 2 all/some/none", () => {
  const universe = ["a", "b", "uncategorized"];
  it("all toggles exclude one, final deselection is none and final selection is all", () => {
    const first = toggleReportCategory({ mode: "all" }, "a", universe);
    expect(first).toEqual({ mode: "include", keys: ["b", "uncategorized"] });
    expect(
      toggleReportCategory({ mode: "include", keys: ["a"] }, "a", universe),
    ).toEqual({ mode: "none" });
    expect(toggleReportCategory(first, "a", universe)).toEqual({ mode: "all" });
    expect(toggleReportCategory({ mode: "none" }, "a", universe)).toEqual({
      mode: "include",
      keys: ["a"],
    });
  });
  it("All is a genuine toggle and zero selection applies", () => {
    const none = selectAllReportFilterDraft(
      openReportFilterDraft({ mode: "all" }, universe),
    );
    expect(applyReportFilterDraft(none)).toEqual({ mode: "none" });
    expect(selectAllReportFilterDraft(none).mode).toBe("all");
    expect(toggleReportFilterDraftKey(none, "b").mode).toBe("include");
    expect(reportSelectionIncludes(none, "a")).toBe(false);
  });
  it("preserves unavailable IDs and deduplicates stable IDs", () => {
    expect(
      normalizeReportSelection(
        { mode: "include", keys: ["gone", "gone"] },
        universe,
      ),
    ).toEqual({ mode: "include", keys: ["gone"] });
    expect(normalizeReportSelection({ mode: "include", keys: [] })).toEqual({
      mode: "none",
    });
  });
});
