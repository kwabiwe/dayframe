// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));
vi.mock("@/lib/session-change", () => ({ beforeSessionChange: vi.fn() }));

const { TripLoggingSwitch } = await import("./SettingsForms");

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
});

describe("Log trips automatically (PRD D19, A4)", () => {
  const ok = (value: boolean, settingsRevision: number) =>
    new Response(JSON.stringify({ ok: true, logTripsAutomatically: value, settingsRevision }), { status: 200 });

  it("shows the value the server stored even when the refresh after it fails (Codex r1 on #462)", async () => {
    mocks.fetch.mockResolvedValue(ok(false, 6));
    const refresh = vi.fn(async () => { throw new Error("offline"); });
    render(<TripLoggingSwitch refresh={refresh} revision={5} stored userId="user-1" />);
    const toggle = screen.getByRole("switch", { name: "Log trips automatically" }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.checked).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/profile", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ logTripsAutomatically: false, expectedUserId: "user-1" }) }));
  });

  it("puts the switch back and says why when the save is refused", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "You're signed in to a different account now. Reload Settings." }), { status: 409 }));
    render(<TripLoggingSwitch refresh={vi.fn(async () => null)} revision={5} stored={false} userId="user-1" />);
    const toggle = screen.getByRole("switch", { name: "Log trips automatically" }) as HTMLInputElement;
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("different account"));
    expect(toggle.checked).toBe(false);
  });

  it("keeps the saved value over copies read before the write, and shows any copy read after it (Codex r2–r4 on #462)", async () => {
    let acknowledge!: (response: Response) => void;
    mocks.fetch.mockReturnValue(new Promise<Response>((resolve) => { acknowledge = resolve; }));
    const failing = vi.fn(async () => { throw new Error("offline"); });
    const { rerender } = render(<TripLoggingSwitch refresh={failing} revision={5} stored userId="user-1" />);
    const toggle = screen.getByRole("switch", { name: "Log trips automatically" }) as HTMLInputElement;
    await userEvent.setup().click(toggle);
    // While the save is in flight, a bootstrap read before it arrives (still on, revision 5).
    rerender(<TripLoggingSwitch refresh={failing} revision={5} stored userId="user-1" />);
    await act(async () => { acknowledge(ok(false, 6)); });
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.checked).toBe(false);
    // A local timer update keeps the same bootstrap user: still off.
    rerender(<TripLoggingSwitch refresh={failing} revision={5} stored userId="user-1" />);
    expect(toggle.checked).toBe(false);
    // Another tab turned it back on after this save: a copy at revision 7 says so.
    rerender(<TripLoggingSwitch refresh={failing} revision={7} stored userId="user-1" />);
    expect(toggle.checked).toBe(true);
  });
});
