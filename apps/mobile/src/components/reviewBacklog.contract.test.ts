import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Review screen and its backlog paging are gone (location v4 step 15); failed presentation reads still reach
// the support details.
describe("Review presentation diagnostics", () => {
  it("keeps failed presentation reads in Sync help's support details", () => {
    const settings = readFileSync(resolve(__dirname, "../../app/settings.tsx"), "utf8");
    // Failed presentation reads stay in the support details (Sync help › Copy details for support).
    // (Read for the exporting account only; Codex r6 on #355.)
    expect(settings).toContain("reviewSync: review ? { diagnostics: review.diagnostics, mutations: review.mutations } : null");
    expect(settings).toContain("readReviewSupportExportForOwner(owner)");
  });
});
