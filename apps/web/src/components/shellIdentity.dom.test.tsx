// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellProfileIdentity, ShellProfileInitials } from "./ShellProfileIdentity";
import { ThemeToggleButton } from "./ThemeToggleButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem("dayframe.theme"); } catch { /* storage unavailable */ }
});

describe("App shell identity before data arrives", () => {
  it("shows a neutral placeholder rather than a made-up name or workspace", () => {
    render(<><ShellProfileInitials identity={null} /><ShellProfileIdentity identity={null} /></>);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Local User|Workspace|Dayframe User|\bDU\b|\bDF\b/);
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("is what the app shell uses for the sidebar and phone account button", () => {
    const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, "utf8");
    expect(shell).not.toMatch(/"Local User"|"Dayframe User"|\?\? "Workspace"/);
    expect(shell.match(/<ShellProfileInitials identity=\{shellIdentity\} \/>/g)).toHaveLength(2);
    expect(shell).toContain("<ShellProfileIdentity identity={shellIdentity} />");
  });

  it("shows the real name, workspace and initials once known", () => {
    render(<>
      <ShellProfileInitials identity={{ userName: "Ada Lovelace", workspaceName: "Analytical" }} />
      <ShellProfileIdentity identity={{ userName: "Ada Lovelace", workspaceName: "Analytical" }} />
    </>);
    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
    expect(screen.getByText("Analytical")).not.toBeNull();
    expect(screen.getAllByText("AL")).toHaveLength(1);
  });
});

describe("Theme toggle on first paint", () => {
  it("renders the same icons on the server and after hydrating into a dark choice", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ThemeToggleButton />);
    document.body.append(container);
    const serverIcons = iconClasses(container);

    localStorage.setItem("dayframe.theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => { root = hydrateRoot(container, <ThemeToggleButton />); });

    expect(iconClasses(container)).toEqual(serverIcons);
    expect(serverIcons).toEqual(expect.arrayContaining([expect.stringContaining("lucide-moon"), expect.stringContaining("lucide-sun")]));
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Switch to light mode");
    await act(async () => root?.unmount());
  });
});

function iconClasses(container: HTMLElement) {
  return Array.from(container.querySelectorAll("svg")).map((svg) => svg.getAttribute("class") ?? "");
}
