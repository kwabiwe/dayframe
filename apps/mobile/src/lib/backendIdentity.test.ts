import { describe, expect, it, vi } from "vitest";
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://dayframe-staging.vercel.app" }));
import { resolveBackendIdentity } from "./backendIdentity";

describe("Health backend identity", () => {
  it("binds the stable aliases and rejects conflicting explicit identities", () => {
    for (const [url, identity, wrong] of [
      ["https://dayframe-staging.vercel.app", "dayframe-staging", "dayframe-production"],
      ["https://dayframe-web.vercel.app", "dayframe-production", "dayframe-staging"],
    ]) {
      expect(resolveBackendIdentity(url)).toBe(identity);
      expect(resolveBackendIdentity(url, identity)).toBe(identity);
      expect(() => resolveBackendIdentity(url, wrong)).toThrow("does not match");
    }
  });
  it("requires a configured identity for custom origins and preserves a staging Preview identity", () => {
    expect(resolveBackendIdentity("https://synthetic-preview.vercel.app")).toBeNull();
    expect(resolveBackendIdentity("https://synthetic-preview.vercel.app", "dayframe-staging")).toBe("dayframe-staging");
    expect(() => resolveBackendIdentity("http://localhost:3000", "invalid identity")).toThrow("Invalid");
  });
});
