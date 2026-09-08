import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./reviewSyncStore.ts", import.meta.url)),
  "utf8"
);

describe("Review sync transport contract", () => {
  it("uses the bounded cookie-free mobile request boundary", () => {
    expect(source).toContain("mobileJsonRequest(");
    expect(source).toContain("REVIEW_SYNC_REQUEST_TIMEOUT_MS = 15_000");
    expect(source).toContain("Review sync timed out. Your saved change is preserved.");
    expect(source).toContain("error instanceof MobileRequestTimeoutError");
    expect(source).toContain("scheduleRetry(");
  });
});
