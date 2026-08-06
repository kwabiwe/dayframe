import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentRoot = fileURLToPath(new URL("./", import.meta.url));
const dashboard = readFileSync(`${componentRoot}DayframeDashboard.tsx`, "utf8");

describe("auth keyboard navigation contract", () => {
  it("removes the custom keyboard accessory implementation and references", () => {
    expect(existsSync(`${componentRoot}KeyboardAccessory.tsx`)).toBe(false);
    expect(dashboard).not.toMatch(/KeyboardAccessory|inputAccessoryViewID|authKeyboard/);
  });

  it("keeps Return-key navigation and final-field submission", () => {
    expect(dashboard).toContain("onSubmitEditing={() => authWorkspaceRef.current?.focus()}");
    expect(dashboard).toContain("onSubmitEditing={() => authEmailRef.current?.focus()}");
    expect(dashboard).toContain("onSubmitEditing={() => authPasswordRef.current?.focus()}");
    expect(dashboard).toContain("onSubmitEditing={submitAuth}");
    expect(dashboard).toContain('returnKeyType="done"');
    expect(dashboard).toContain("if (authSubmittingRef.current) return;");
  });
});
