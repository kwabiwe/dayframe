// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlocksToast } from "./BlocksToast";

afterEach(cleanup);

const source = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

// Web UI audit P5c (WUI-027, WUI-043; owner 17 Oct 2026): one toast, an error variant, one grammar.
describe("BlocksToast error variant", () => {
  it("is the same pill, announced as an alert, with its action", () => {
    const retry = vi.fn();
    render(<BlocksToast actionLabel="Try again" message="Couldn't delete that block." onAction={retry} tone="error" />);
    const toast = screen.getByRole("alert");
    expect(toast.className).toContain("df-toast");
    expect(toast.className).toContain("is-error");
    expect(toast.getAttribute("aria-live")).toBe("assertive");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("stays a polite status otherwise", () => {
    render(<BlocksToast message="Deleted Shop run" />);
    expect(screen.getByRole("status").className).not.toContain("is-error");
  });

  it("is what Calendar uses for its errors, and every delete toast puts the verb first", () => {
    const calendar = source("components/TimeReviewViews.tsx");
    expect(calendar).toMatch(/deleteError \? \([\s\S]*?<BlocksToast[\s\S]*?actionLabel="Try again"[\s\S]*?tone="error"/);
    expect(calendar).not.toContain("timeline-delete-error");
    for (const path of ["components/TimeReviewViews.tsx", "components/today/TodayView.tsx"]) {
      expect(source(path), path).not.toMatch(/” deleted`|occurrences deleted/);
    }
    expect(source("app/globals.css")).toMatch(/\.df-toast\.is-error \.df-toast-swatch \{\s*background: var\(--danger\);/);
  });
});
