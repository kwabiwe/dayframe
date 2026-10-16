// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceRow } from "@/lib/queries";

const mocks = vi.hoisted(() => ({ clientFetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: mocks.clientFetch }));

const { PlacesManager } = await import("./PlacesManager");

HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

const place = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Gym",
  latitude: 51.5,
  longitude: -0.1,
  radiusMeters: 100,
  priority: 5,
  role: null,
  loggingEnabled: true,
  autoLog: false,
  defaultCategoryId: null,
  defaultActivityDescription: null
} as unknown as PlaceRow;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Places delete (location v3 bug 6)", () => {
  it("shows a refused delete's sentence inside the open dialog, and clears it when reopened", async () => {
    const sentence = "This place couldn't be deleted because some of its location history couldn't be cleared. Nothing was changed.";
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ error: sentence, code: "place_delete_blocked" }), { status: 409 }));
    render(<PlacesManager learnedPlaces={[]} places={[place]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Gym" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert").textContent).toBe(sentence));
    expect(mocks.clientFetch).toHaveBeenCalledWith(`/api/places?id=${place.id}`, { method: "DELETE" });
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Gym" }));
    expect(within(screen.getByRole("alertdialog")).queryByRole("alert")).toBeNull();
  });
});
