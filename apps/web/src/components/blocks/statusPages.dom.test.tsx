// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <span data-image={String(props.src)} />
}));

const { default: NotFound } = await import("@/app/not-found");
const { default: AppError } = await import("@/app/error");
const { default: SettingsError } = await import("@/app/settings/error");

afterEach(cleanup);

const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// Web UI audit P6a (WUI-039, WUI-047, WUI-048; owner 17 Oct 2026).
describe("missing and failed pages (WUI-048)", () => {
  it("shows a branded 404 with a way back to Today", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "This page isn’t here" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Go to Today" }).getAttribute("href")).toBe("/");
  });

  it("offers Try again and Today when a page fails, Settings included", () => {
    const reset = vi.fn();
    const view = render(<AppError error={new Error("boom")} reset={reset} />);
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Go to Today" })).not.toBeNull();
    view.unmount();

    render(<SettingsError error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings are unavailable" })).not.toBeNull();
  });
});

describe("avatars and live durations", () => {
  it("draws every avatar as a circle at 36, 40 or 56 px (WUI-039)", () => {
    expect(styles).toMatch(/\.df-profile > span:first-child,\s*\.df-mtop-avatar > span \{[^}]*width: 36px;[^}]*height: 36px;[^}]*border-radius: 50%;/);
    expect(styles).toMatch(/\.df-profile-pop-card > span \{[^}]*width: 40px;[^}]*border-radius: 50%;/);
    expect(styles).toMatch(/\.df-av-lg \{[^}]*width: 56px;[^}]*border-radius: 999px;/);
    expect(styles).not.toMatch(/\.df-profile-pop-card > span \{[^}]*border-radius: 12px;/);
  });

  it("keeps a running block's duration neutral on Today as in Reports (WUI-047)", () => {
    expect(styles).toMatch(/\.df-erow\.is-live \.df-erow-dur,\s*\.df-report-row\.df-erow\.is-live \.df-erow-dur \{\s*color: var\(--text-primary\);/);
    expect(styles).not.toMatch(/\.df-erow\.is-live \.df-erow-dur \{\s*color: var\(--accent-text\);/);
  });
});
