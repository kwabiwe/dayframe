// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.fetch }));

const { TagManager } = await import("./TagManager");

const acme = { id: "20000000-0000-4000-8000-000000000001", name: "acme", normalizedName: "acme", usageCount: 3 };

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
  mocks.refresh.mockReset();
});

describe("Library › Tags", () => {
  it("lists tags with their block count and named Rename / Delete actions", () => {
    render(<TagManager tags={[acme]} />);
    expect(screen.getByText("#acme")).toBeTruthy();
    expect(screen.getByText("3 blocks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename acme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete acme" })).toBeTruthy();
  });

  it("keeps a refused new tag's name, and clears the field once one is created", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "That tag already exists." }), { status: 409 }));
    render(<TagManager tags={[acme]} />);
    const field = screen.getByPlaceholderText("New tag, like Planning") as HTMLInputElement;
    await user.type(field, "acme");
    await user.click(screen.getByRole("button", { name: /Create tag/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    expect(field.value).toBe("acme");

    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await user.clear(field);
    await user.type(field, "Planning");
    await user.click(screen.getByRole("button", { name: /Create tag/ }));
    await waitFor(() => expect(field.value).toBe(""));
    expect(mocks.fetch).toHaveBeenLastCalledWith("/api/tags", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Planning" }) }));
  });

  it("renames inline and deletes after confirming", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<TagManager tags={[acme]} />);
    await user.click(screen.getByRole("button", { name: "Rename acme" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "client-acme");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(`/api/tags/${acme.id}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "client-acme" }) })));

    await user.click(await screen.findByRole("button", { name: "Delete acme" }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.getByRole("dialog"));
    expect(dialog.textContent).toContain("#acme will be removed from 3 blocks. The blocks stay.");
    await user.click(within(dialog).getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(`/api/tags/${acme.id}`, { method: "DELETE" }));
  });
});
