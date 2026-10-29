// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellSidebarNav, ShellTabBar } from "./ShellNav";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a>
}));

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: reduced && query.includes("reduce"), addEventListener: vi.fn(), removeEventListener: vi.fn() })
  });
}

function thumb() {
  return document.querySelector<HTMLElement>(".df-nav-thumb")!;
}

afterEach(() => {
  cleanup();
});

describe("Blocks sidebar navigation", () => {
  it("marks the current section and has no Review section (location v4 step 15)", () => {
    setReducedMotion(false);
    render(<ShellSidebarNav activeId="reports" />);
    const current = document.querySelector("[aria-current='page']");
    expect(current?.getAttribute("href")).toBe("/reports");
    expect(screen.queryByRole("link", { name: /Review/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Library" }).getAttribute("href")).toBe("/categories");
  });

  it("badges Calendar with the things to check, and says so (location v4 step 14)", () => {
    setReducedMotion(false);
    render(<ShellSidebarNav activeId="today" checkCount={3} />);
    const calendar = screen.getByRole("link", { name: "Calendar, 3 to check in the last 7 days" });
    expect(calendar.querySelector(".df-nav-count")?.textContent).toBe("3");
    expect(calendar.getAttribute("href")).toBe("/timeline");
  });

  it("opens Calendar on today with the badge showing: no oldest day, no date= (owner bug, 29 Oct 2026)", () => {
    setReducedMotion(false);
    render(<ShellSidebarNav activeId="today" checkCount={2} />);
    const sidebar = screen.getByRole("link", { name: "Calendar, 2 to check in the last 7 days" }).getAttribute("href");
    cleanup();
    render(<ShellTabBar activeId="calendar" checkCount={2} />);
    const tab = screen.getByRole("link", { name: "Calendar, 2 to check in the last 7 days" }).getAttribute("href");
    // A bare /timeline: the page opens today (timelineStateFromSearchParams) and nothing of an earlier visit carries over.
    for (const href of [sidebar, tab]) {
      expect(href).toBe("/timeline");
      expect(href).not.toMatch(/date=|check=/);
    }
    // The badge is a count inside the tab's one link, never a link of its own.
    expect(document.querySelectorAll(".df-tabbar a .df-tab-count")).toHaveLength(1);
  });

  it("places the thumb without travel first, then springs it, and fades it out on Settings", () => {
    setReducedMotion(false);
    const { rerender } = render(<ShellSidebarNav activeId="today" />);
    expect(thumb().style.transition).toBe("none");
    expect(thumb().style.opacity).toBe("1");

    rerender(<ShellSidebarNav activeId="reports" />);
    expect(thumb().style.transition).toMatch(/^transform \d+ms /);

    rerender(<ShellSidebarNav activeId={null} />);
    expect(thumb().style.opacity).toBe("0");
  });

  it("moves the thumb without travel under Reduce Motion", () => {
    setReducedMotion(true);
    const { rerender } = render(<ShellSidebarNav activeId="today" />);
    rerender(<ShellSidebarNav activeId="calendar" />);
    expect(thumb().style.transition).not.toContain("transform");
  });
});

describe("Blocks phone tab bar", () => {
  it("offers the same four sections with the current one marked", () => {
    render(<ShellTabBar activeId="calendar" />);
    const links = Array.from(document.querySelectorAll(".df-tabbar a"));
    expect(links.map((link) => link.textContent)).toEqual(["Today", "Calendar", "Reports", "Library"]);
    expect(document.querySelector(".df-tabbar [aria-current='page']")?.getAttribute("href")).toBe("/timeline");
  });
});

describe("Blocks shell contract", () => {
  const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, "utf8");

  it("never sends the Calendar nav to the oldest question (owner bug, 29 Oct 2026)", () => {
    expect(shell).not.toContain("oldestCheckHref");
    expect(shell).not.toContain("calendarHref");
  });
  const styles = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");

  it("keeps workspace switching, Settings and Log out one tap from the profile on every width", () => {
    // Both avatars open it; while it is open, the popover itself takes their click (WUI-022).
    expect(shell.match(/data-profile-trigger="" onClick=\{\(\) => setOverlay\("profile"\)\}/g)).toHaveLength(2);
    expect(shell).toContain('href="/settings#account"');
    expect(shell).toContain("<SignOutControl");
  });

  it("never leaves a page by G sequence while a dialog or editor owns the keyboard", () => {
    expect(shell).toMatch(/if \(goTo \|\| startsGoToSequence\(event\)\) \{\s*\/\/[^\n]*\n\s*if \(event\.defaultPrevented \|\| hasOpenDialog\(\)\) return;/);
    expect(shell).toContain("if (isTypingTarget(event.target)) return;");
  });

  it("uses neutral selection and 44-pixel phone targets; coral only on the current page's icon (W10)", () => {
    const shellCss = styles.slice(styles.indexOf("Dayframe Blocks web shell"), styles.indexOf("Dayframe Blocks command timer"));
    const currentIcon = /\.df-(?:nav a\[aria-current="page"\] > svg|tabbar a\[aria-current="page"\] \.df-tab-icon > svg) \{\s*color: var\(--accent-text\);\s*\}/g;
    expect(shellCss.match(currentIcon)).toHaveLength(2);
    expect(shellCss.replace(currentIcon, "")).not.toMatch(/var\(--accent/);
    expect(shellCss).toMatch(/\.df-tabbar a \{[^}]*min-height: 52px;/s);
    expect(shellCss).toMatch(/\.df-tabbar \{[^}]*bottom: calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\);/s);
  });
});

describe("G sequence guard", () => {
  const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, "utf8");

  it("uses the shared keyboard-ownership check (tested in lib/keyboard-ownership.dom.test.ts)", () => {
    expect(shell).toContain('import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";');
  });
});

describe("Settings thumb fade", () => {
  it("fades the thumb out even when it was last placed without travel", () => {
    setReducedMotion(false);
    const { rerender } = render(<ShellSidebarNav activeId="today" />);
    rerender(<ShellSidebarNav activeId={null} />);
    expect(thumb().style.transition).toBe("opacity 140ms ease-out");
    expect(thumb().style.opacity).toBe("0");
  });
});
