import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const ingestSource = source("./location-ingest-service.ts");
const reviewSource = source("./location-review-service.ts");
const eventSource = source("../event-service.ts");

describe("V2 location review quality contracts", () => {
  it("ensures a Commute category before V2 commute semantic emission", () => {
    expect(ingestSource).toMatch(
      /const suggestedCategoryId = segment\.kind === "commute"[\s\S]*?ensureCommuteCategoryId/
    );
    expect(ingestSource.match(/suggestedCategoryId/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("shares automatic-category creation instead of duplicating it in event-service", () => {
    expect(eventSource).toContain('from "./automatic-category-service"');
    expect(eventSource).not.toContain("async function ensureAutomaticCategoryId");
  });

  it("does not use a generated commute title as a confirmed description", () => {
    expect(ingestSource).toContain('if (segment.kind === "commute") return "Commute"');
    expect(ingestSource).not.toContain('return "Possible journey"');
    expect(reviewSource).toContain("confirmedLocationDescription");
    expect(reviewSource).not.toContain("edit?.description?.trim() || item.title");
  });

  it("uses the shared one-minute product threshold for automatic overlap decisions", () => {
    expect(ingestSource).toContain(">= interval '1 minute'");
    expect(eventSource).toContain(">= interval '1 minute'");
  });
});
