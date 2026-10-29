import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync("src/lib/reviewSyncStore.ts", "utf8");

// The Review screen and its evidence screen are gone (location v4 step 15); the outbox they used stays, for
// Calendar › List's answers.
describe("offline-first Review outbox", () => {
  it("hides mutations after the local transaction and preserves restore anchors", () => {
    // Every action hides its card in the same local transaction, except "Save this place" (PRD D19),
    // which keeps it open and owns no source effect.
    expect(storeSource).toContain(`keepsCardOpen ? "restore" : "hidden"`);
    expect(storeSource).toContain("if (keepsCardOpen) return;");
    expect(storeSource).toContain("preceding_ids_json");
    expect(storeSource).toContain("following_ids_json");
    expect(storeSource).toContain("restoreReviewItemsWithAnchors");
  });

  it("has no Review screens left to route to", () => {
    expect(() => readFileSync("app/review.tsx", "utf8")).toThrow();
    expect(() => readFileSync("app/review/[id].tsx", "utf8")).toThrow();
  });
});
