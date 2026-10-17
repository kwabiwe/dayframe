// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  it("shows the value the server stored even when the refresh after it fails (Codex r1 on #462)", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, logTripsAutomatically: false }), { status: 200 }));
    const refresh = vi.fn(async () => { throw new Error("offline"); });
    render(<TripLoggingSwitch refresh={refresh} stored userId="user-1" />);
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
    render(<TripLoggingSwitch refresh={vi.fn(async () => null)} stored={false} userId="user-1" />);
    const toggle = screen.getByRole("switch", { name: "Log trips automatically" }) as HTMLInputElement;
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("different account"));
    expect(toggle.checked).toBe(false);
  });

  it("takes a newer value from the server over the one it saved", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, logTripsAutomatically: true }), { status: 200 }));
    const { rerender } = render(<TripLoggingSwitch refresh={vi.fn(async () => null)} stored={false} userId="user-1" />);
    const toggle = screen.getByRole("switch", { name: "Log trips automatically" }) as HTMLInputElement;
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(toggle.checked).toBe(true));
    rerender(<TripLoggingSwitch refresh={vi.fn(async () => null)} stored={true} userId="user-1" />);
    rerender(<TripLoggingSwitch refresh={vi.fn(async () => null)} stored={false} userId="user-1" />);
    expect(toggle.checked).toBe(false);
  });
});
