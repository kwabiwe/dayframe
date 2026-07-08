import { describe, expect, it } from "vitest";
import { assertUsableApiBase, normalizeApiBase, resolveApiBase } from "./config";

describe("mobile config", () => {
  it("normalizes API base values", () => {
    expect(normalizeApiBase(" https://dayframe.example.com/// ")).toBe("https://dayframe.example.com");
    expect(normalizeApiBase("")).toBe("");
  });

  it("allows localhost for local development", () => {
    expect(assertUsableApiBase("http://localhost:3000/", { allowLocal: true })).toBe("http://localhost:3000");
  });

  it("rejects missing hosted API base values when validating directly", () => {
    expect(() => assertUsableApiBase("", { allowLocal: false })).toThrow(/EXPO_PUBLIC_DAYFRAME_API_BASE/);
  });

  it("falls back to production API when hosted builds have no env value", () => {
    expect(resolveApiBase("", { allowLocal: false })).toBe("https://dayframe-web.vercel.app");
    expect(resolveApiBase(undefined, { allowLocal: false })).toBe("https://dayframe-web.vercel.app");
  });

  it("rejects localhost and http URLs for hosted builds", () => {
    expect(() => assertUsableApiBase("http://localhost:3000", { allowLocal: false })).toThrow(/https/);
    expect(() => assertUsableApiBase("https://127.0.0.1:3000", { allowLocal: false })).toThrow(/localhost/);
    expect(() => assertUsableApiBase("https://192.168.1.10:3000", { allowLocal: false })).toThrow(/localhost/);
  });

  it("accepts hosted https URLs", () => {
    expect(resolveApiBase("https://dayframe.vercel.app/", { allowLocal: false })).toBe("https://dayframe.vercel.app");
  });
});
