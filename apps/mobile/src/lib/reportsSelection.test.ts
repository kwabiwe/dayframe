import { describe, expect, it } from "vitest";
import {
  applyReportFilterDraft,
  openReportFilterDraft,
  refreshReportFilterDraft,
  selectAllReportFilterDraft,
  toggleReportCategory,
  toggleReportFilterDraftKey
} from "./reportsSelection";

describe("Reports category selection", () => {
  it("supports All to one to All and additive/removal selection", () => {
    const one = toggleReportCategory({ mode: "all" }, "a");
    expect(one).toEqual({ mode: "include", keys: ["a"] });
    const two = toggleReportCategory(one, "b");
    expect(two).toEqual({ mode: "include", keys: ["a", "b"] });
    const bOnly = toggleReportCategory(two, "a");
    expect(bOnly).toEqual({ mode: "include", keys: ["b"] });
    expect(toggleReportCategory(bOnly, "b")).toEqual({ mode: "all" });
  });

  it("keeps a draft atomic and rejects an empty applied subset", () => {
    const opened = openReportFilterDraft({ mode: "all" }, ["a", "b"]);
    const withoutA = toggleReportFilterDraftKey(opened, "a");
    expect(applyReportFilterDraft(withoutA)).toEqual({ mode: "include", keys: ["b"] });
    expect(applyReportFilterDraft(toggleReportFilterDraftKey(withoutA, "b"))).toBeNull();
    expect(applyReportFilterDraft(selectAllReportFilterDraft(withoutA))).toEqual({ mode: "all" });
  });

  it("does not select a category that arrives while an explicit draft is open", () => {
    const draft = openReportFilterDraft({ mode: "include", keys: ["a"] }, ["a", "b"]);
    expect(refreshReportFilterDraft(draft, ["a", "b", "c"])).toEqual({
      mode: "include",
      keys: ["a"],
      universe: ["a", "b", "c"]
    });
  });

  it("does not silently include a category that arrives after an All draft opens", () => {
    const draft = openReportFilterDraft({ mode: "all" }, ["a", "b"]);
    expect(refreshReportFilterDraft(draft, ["a", "b", "c"])).toEqual({
      mode: "include",
      keys: ["a", "b"],
      universe: ["a", "b", "c"]
    });
  });

  it("preserves missing IDs, duplicate-name identities, and Uncategorized keys", () => {
    const draft = openReportFilterDraft(
      { mode: "include", keys: ["same-name-a", "same-name-b", "uncategorized", "missing"] },
      ["same-name-a", "same-name-b", "uncategorized"]
    );
    expect(applyReportFilterDraft(draft)).toEqual({
      mode: "include",
      keys: ["same-name-a", "same-name-b", "uncategorized", "missing"]
    });
  });
});
