import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const locationStoreSource = source("./location/store.ts");
const reviewSyncStoreSource = source("./reviewSyncStore.ts");
const apiSource = source("./api.ts");
const networkSource = source("./mobile-network.ts");
const nativeStorageSource = source("../../ios/Dayframe/DayframeSharedStorage.swift");

describe("background session invalidation contracts", () => {
  it("guards delayed location upload and replay rejections with their captured bearer", () => {
    expect(locationStoreSource.match(/invalidateMobileSessionIfCurrent\(session\.token\)/g)).toHaveLength(2);
    expect(locationStoreSource.match(/executeOwnedLocationRequest\(/g)).toHaveLength(2);
    expect(locationStoreSource).not.toContain("invalidateMobileSession()");
  });

  it("guards delayed Review sync rejections with their captured bearer", () => {
    expect(reviewSyncStoreSource).toContain("invalidateMobileSessionIfCurrent(token)");
    expect(reviewSyncStoreSource).not.toContain("invalidateMobileSession()");
  });

  it("centralises ordinary and queued request rejection on the captured bearer", () => {
    expect(networkSource).toContain("invalidateMobileSessionIfCurrent(rejectedToken)");
    expect(networkSource).toContain("throw new StaleMobileSessionResponseError()");
    expect(apiSource.match(/await clearSessionToken\(\)/g)).toHaveLength(1);
    expect(apiSource).toContain("export async function logout()");
    expect(apiSource).toContain("clearActiveOwnerNativeShortcutQueue(activeOwner)");
  });

  it("clears shortcut native context only when the rejected bearer still owns it", () => {
    expect(nativeStorageSource).toContain("static func clear(sessionToken: String) -> Bool");
    expect(nativeStorageSource).toContain("read(accessGroup: accessGroup)?.sessionToken == sessionToken");
  });
});
