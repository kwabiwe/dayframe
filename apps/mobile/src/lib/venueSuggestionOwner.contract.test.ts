/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8"
);

const screenSource = readSource("../../app/review/[id].tsx");
const apiSource = readSource("./api.ts");

// Location v3 PR 8b: a venue suggestion is sent only under the account its evidence was read for.
describe("venue suggestion ownership (Codex r1/r2 on #522)", () => {
  it("pairs only network-read evidence with its account, never cached evidence", () => {
    const assignments = [...screenSource.matchAll(/evidenceOwner\.current = ([^;]+);/g)].map((match) => match[1].trim());
    // Cleared when cached evidence is shown; set only from the account the network read used.
    expect(assignments).toEqual([
      "null",
      "{ userId: owner.userId, workspaceId: owner.workspaceId }",
      "{ userId: owner.userId, workspaceId: owner.workspaceId }"
    ]);
    expect(screenSource).not.toMatch(/evidenceOwner\.current = cachedOwner/);
    const networkReads = [...screenSource.matchAll(/await revalidateLocationReviewEvidence\(\{\s*reviewItemId: id,\s*workspaceId: owner\.workspaceId,\s*userId: owner\.userId/g)];
    expect(networkReads).toHaveLength(2);
  });

  it("reports only with that account's session, in the foreground, checked again before sending", () => {
    const body = apiSource.slice(apiSource.indexOf("export async function reportVenueSuggestion"), apiSource.indexOf("export function normaliseLocationReviewRequestError"));
    expect(body).toContain("readOwnedAuthenticatedSessionSnapshot(owner)");
    expect(body.match(/AppState\.currentState !== "active"/g)).toHaveLength(2);
    expect(body).toContain("isAuthenticatedSessionSnapshotCurrent(session.snapshot)");
    expect(body).toContain('body: JSON.stringify({ placeId })');
  });
});
