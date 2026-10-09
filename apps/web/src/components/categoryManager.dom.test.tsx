// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { CategoryManager } = await import("./CategoryManager");

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
  mocks.refresh.mockReset();
});

const focus = { id: "10000000-0000-4000-8000-000000000001", name: "Focus", color: "lime", isPinned: false };

// Blocks 6b-2: a refused change is said, and what was typed stays for another try.
describe("CategoryManager refusals", () => {
  it("keeps the typed name and shows the message when a rename is refused", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "An activity with that name already exists." }), { status: 409 }));
    render(<CategoryManager categories={[focus]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    const name = screen.getAllByRole("textbox").find((input) => input.getAttribute("name") === "name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Writing");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect(name.value).toBe("Writing");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps a refused new activity's name, and clears the form once one is created", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "An activity with that name already exists." }), { status: 409 }));
    render(<CategoryManager categories={[focus]} />);
    const user = userEvent.setup();
    const name = screen.getByPlaceholderText("Deep work") as HTMLInputElement;
    await user.type(name, "Focus");
    await user.click(screen.getByRole("button", { name: /Create activity/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect(name.value).toBe("Focus");

    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, category: { ...focus, id: "x", name: "Piano" } }), { status: 201 }));
    await user.clear(name);
    await user.type(name, "Piano");
    await user.click(screen.getByRole("button", { name: /Create activity/ }));
    await waitFor(() => expect(name.value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
