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
    // Commute only between Home and Work; Errands with a stop; Travel for every other Move (PRD D19).
    expect(ingestSource).toMatch(
      /const suggestedCategoryId = move\s*\? move\.activity === "commute" \? await ensureCommuteCategoryId[\s\S]*?ensureTravelCategoryId/
    );
    expect(ingestSource.match(/suggestedCategoryId/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("shares automatic-category creation instead of duplicating it in event-service", () => {
    expect(eventSource).toContain('from "./automatic-category-service"');
    expect(eventSource).not.toContain("async function ensureAutomaticCategoryId");
  });

  it("does not use a generated commute title as a confirmed description", () => {
    // A Move is named from its ends and mode (PRD D19); its block keeps no generated description.
    expect(ingestSource).toContain("return (await segmentMoveName(client, session, segment, stayIds)).title;");
    expect(ingestSource).not.toContain('return "Possible journey"');
    expect(reviewSource).toContain("confirmedLocationDescription");
    expect(reviewSource).not.toContain("edit?.description?.trim() || item.title");
  });

  it("separates automatic activity policy from the one-minute presentation threshold", () => {
    expect(ingestSource).toContain("assessAutomaticOverlap");
    expect(ingestSource).not.toContain(">= interval '1 minute'");
    expect(eventSource).toContain(">= interval '1 minute'");
  });
});
