import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const locationStoreSource = source("./location/store.ts");
const reviewSyncStoreSource = source("./reviewSyncStore.ts");

describe("background session invalidation contracts", () => {
  it("guards delayed location upload and replay rejections with their captured bearer", () => {
    expect(locationStoreSource.match(/invalidateMobileSessionIfCurrent\(token\)/g)).toHaveLength(2);
    expect(locationStoreSource).not.toContain("invalidateMobileSession()");
  });

  it("guards delayed Review sync rejections with their captured bearer", () => {
    expect(reviewSyncStoreSource).toContain("invalidateMobileSessionIfCurrent(token)");
    expect(reviewSyncStoreSource).not.toContain("invalidateMobileSession()");
  });
});
