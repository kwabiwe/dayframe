import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const locationReviewSource = readFileSync(
  fileURLToPath(new URL("./location/location-review-service.ts", import.meta.url)),
  "utf8"
);
const genericReviewSource = readFileSync(
  fileURLToPath(new URL("./review-mutation-service.ts", import.meta.url)),
  "utf8"
);

describe("overlap save policy", () => {
  it("keeps every user-confirmed location Review path free of overlap blockers", () => {
    for (const action of [
      "confirm",
      "edit_and_confirm",
      "record_once",
      "save_place_and_confirm",
      "split_and_confirm",
      "merge_and_confirm"
    ]) {
      expect(locationReviewSource).toContain(`"${action}"`);
    }

    expect(locationReviewSource).not.toContain("validateNoConfirmedOverlap");
    expect(locationReviewSource).not.toContain("overlap_conflict");
    expect(locationReviewSource).toContain("insert into time_entries");
  });

  it("keeps generic edit-and-confirm free of overlap blockers while retaining receipts", () => {
    expect(genericReviewSource).toContain('"edit_and_confirm"');
    expect(genericReviewSource).not.toContain("validateNoOverlap");
    expect(genericReviewSource).not.toContain("overlap_conflict");
    expect(genericReviewSource).toContain("insert into review_mutation_receipts");
  });
});
