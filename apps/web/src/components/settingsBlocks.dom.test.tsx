// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), beforeSessionChange: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));
vi.mock("@/lib/session-change", () => ({
  beforeSessionChange: mocks.beforeSessionChange,
  onBeforeSessionChange: () => () => undefined,
  onSessionChangeFailed: () => () => undefined,
  sessionChangeRequest: (send: () => Promise<Response>) => send()
}));

const { AppShellRuntimeProvider } = await import("@/components/AppShellRuntime");
const { AccountSettings, HelpSettings } = await import("./SettingsForms");
const { OPEN_SHORTCUTS_EVENT } = await import("@/lib/shell-nav");

const user = { email: "person@example.test", name: "Sam Example" };
const workspaces = [{ id: "w1", name: "Personal" }, { id: "w2", name: "Studio" }];

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  mocks.beforeSessionChange.mockImplementation(async () => { order.push("held decisions saved"); });
  mocks.fetch.mockImplementation(async (url: string) => {
    order.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

afterEach(() => {
  cleanup();
  order.length = 0;
  mocks.fetch.mockReset();
  mocks.refresh.mockReset();
  mocks.beforeSessionChange.mockReset();
});

function mountAccount(authMode: "provider" | "token" = "provider") {
  return render(
    <AppShellRuntimeProvider>
      <AccountSettings authMode={authMode} user={user} workspace={workspaces[0]} workspaces={workspaces} />
    </AppShellRuntimeProvider>
  );
}

describe("Settings in Blocks", () => {
  it("shows the account card with initials, email and workspace, reachable as #account", () => {
    const { container } = mountAccount();
    const card = container.querySelector("#account")!;
    expect(card.textContent).toContain("SE");
    expect(card.textContent).toContain("person@example.test · Personal");
    expect(within(card as HTMLElement).getByRole("button", { name: /Change password/ })).toBeTruthy();
  });

  it("offers Change password only for email and password sign-in", () => {
    mountAccount("token");
    expect(screen.queryByRole("button", { name: /Change password/ })).toBeNull();
  });

  it("edits the profile in a dialog that closes with a confirmation", async () => {
    const userEvents = userEvent.setup();
    mountAccount();
    await userEvents.click(screen.getByRole("button", { name: /Edit profile/ }));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await userEvents.clear(name);
    await userEvents.type(name, "Sam E");
    await userEvents.click(within(dialog).getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Profile saved."));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Sam E" }) }));
  });

  it("saves held Review decisions before switching or creating a workspace", async () => {
    const userEvents = userEvent.setup();
    mountAccount();
    await userEvents.click(screen.getByRole("button", { name: /Switch workspace/ }));
    await userEvents.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Workspace"), "w2");
    await waitFor(() => expect(order).toContain("/api/workspace/switch"));
    expect(order.indexOf("held decisions saved")).toBeLessThan(order.indexOf("/api/workspace/switch"));
  });

  it("keeps a workspace switch's confirmation on the card after the card is re-created", async () => {
    const userEvents = userEvent.setup();
    // As on the Settings page: the notice lives above the card, and a workspace change re-keys it.
    function Harness() {
      const [notice, setNotice] = useState<string | null>(null);
      const [current, setCurrent] = useState(workspaces[0]);
      return (
        <AppShellRuntimeProvider>
          <AccountSettings
            authMode="provider"
            key={current.id}
            notice={notice}
            onNotice={(next) => {
              setNotice(next);
              if (next?.startsWith("Switched")) setCurrent(workspaces[1]);
            }}
            user={user}
            workspace={current}
            workspaces={workspaces}
          />
        </AppShellRuntimeProvider>
      );
    }
    render(<Harness />);
    await userEvents.click(screen.getByRole("button", { name: /Switch workspace/ }));
    await userEvents.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Workspace"), "w2");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Switched to Studio."));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("#account")?.textContent).toContain("· Studio");
  });

  it("closes the workspace dialog after a rename and confirms on the card", async () => {
    const userEvents = userEvent.setup();
    mountAccount();
    await userEvents.click(screen.getByRole("button", { name: /Switch workspace/ }));
    const dialog = screen.getByRole("dialog");
    await userEvents.click(within(dialog).getByRole("button", { name: "Rename" }));
    const name = within(dialog).getByLabelText("Workspace name");
    await userEvents.clear(name);
    await userEvents.type(name, "Home life");
    await userEvents.click(within(dialog).getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Workspace name saved."));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the shell's keyboard shortcuts and links to Review from Help", async () => {
    const userEvents = userEvent.setup();
    const opened = vi.fn();
    window.addEventListener(OPEN_SHORTCUTS_EVENT, opened);
    render(<HelpSettings authMode="provider" reviewCount={2} />);
    expect(screen.getByText("2 moments waiting.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Review" }).getAttribute("href")).toBe("/review");
    await userEvents.click(screen.getByRole("button", { name: "Show" }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_SHORTCUTS_EVENT, opened);
  });
});
