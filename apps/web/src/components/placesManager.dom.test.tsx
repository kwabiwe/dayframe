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
  latitude: 10.5,
  longitude: 20.1,
  radiusMeters: 100,
  priority: 5,
  role: null,
  loggingEnabled: true,
  autoLog: false,
  defaultCategoryId: null,
  defaultActivityDescription: null
} as unknown as PlaceRow;

const NOW = "2026-10-21T10:00:00.000Z";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Places delete (location v3 bug 6)", () => {
  it("shows a refused delete's sentence inside the open dialog, and clears it when reopened", async () => {
    const sentence = "This place couldn't be deleted because some of its location history couldn't be cleared. Nothing was changed.";
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ error: sentence, code: "place_delete_blocked" }), { status: 409 }));
    render(<PlacesManager learnedPlaces={[]} now={NOW} places={[place]} />);

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

describe("Archive place (location v3 PR 15, PRD D19 A10)", () => {
  it("archives from the delete dialog instead of deleting", async () => {
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<PlacesManager learnedPlaces={[]} now={NOW} places={[place]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Gym" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Archive instead keeps its name on past blocks");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    const init = mocks.clientFetch.mock.calls.find(([url]) => url === "/api/places/archive")![1];
    expect(JSON.parse(init.body)).toEqual({ id: place.id, archived: true });
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toContain("Place archived. Past blocks keep its name.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("lists archived places with Restore", async () => {
    mocks.clientFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const archived = { id: "30000000-0000-4000-8000-000000000009", name: "Old flat", archivedAt: "2026-10-20T09:00:00.000Z" };
    render(<PlacesManager archivedPlaces={[archived]} learnedPlaces={[]} now={NOW} places={[place]} />);
    const section = screen.getByRole("region", { name: "Archived" });
    expect(within(section).getByText("Old flat")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Restore Old flat" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    const init = mocks.clientFetch.mock.calls.find(([url]) => url === "/api/places/archive")![1];
    expect(JSON.parse(init.body)).toEqual({ id: archived.id, archived: false });
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toContain("Place restored.");
  });

  it("shows no Archived section without archived places", () => {
    render(<PlacesManager learnedPlaces={[]} now={NOW} places={[place]} />);
    expect(screen.queryByRole("region", { name: "Archived" })).toBeNull();
  });
});


describe("Places search, sections and last visit (location v3 PR 16c)", () => {
  // Synthetic places in Exampleton.
  const named = (index: number, name: string, role: "home" | "work" | null = null) =>
    ({ ...place, id: `30000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, name, role }) as unknown as PlaceRow;
  const many = [
    named(0, "1 Example Road", "home"),
    named(1, "Alder Café"), named(2, "Birch Library"), named(3, "Cedar Pool"), named(4, "Dock Market"),
    named(5, "Elm Park"), named(6, "Fern School"), named(7, "Gorse Clinic"), named(8, "Hazel Studio"), named(9, "Ivy Bakery")
  ];
  const visits = [
    { placeId: many[0].id, lastVisitAt: "2026-10-21T07:00:00.000Z", visitsLast30Days: 25 },
    { placeId: many[3].id, lastVisitAt: "2026-10-19T18:00:00.000Z", visitsLast30Days: 4 },
    { placeId: many[5].id, lastVisitAt: "2026-10-20T12:00:00.000Z", visitsLast30Days: 1 }
  ];
  const regionNames = () => screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby") && region.querySelector("h2")?.textContent);

  it("keeps a short list as one list with no search, and shows the last visit", () => {
    render(<PlacesManager learnedPlaces={[]} now={NOW} places={[place]} timeZone="Europe/London"
      visits={[{ placeId: place.id, lastVisitAt: "2026-10-20T19:00:00.000Z", visitsLast30Days: 1 }]} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    const list = screen.getByRole("region", { name: "Your places" });
    expect(within(list).getByText("Last visit yesterday")).toBeTruthy();
  });

  it("adds search and Frequent, Recent and All from nine places, Home only in All", () => {
    render(<PlacesManager learnedPlaces={[]} now={NOW} places={many} timeZone="Europe/London" visits={visits} />);
    expect(screen.getByRole("searchbox", { name: "Search places" })).toBeTruthy();
    expect(regionNames()).toEqual(expect.arrayContaining(["Frequent", "Recent", "All places"]));
    const frequent = screen.getByRole("region", { name: "Frequent" });
    expect(within(frequent).getByText("Cedar Pool")).toBeTruthy();
    expect(within(frequent).getByText("4 visits in 30 days · Last visit Monday")).toBeTruthy();
    expect(within(frequent).queryByText("Home")).toBeNull();
    const recent = screen.getByRole("region", { name: "Recent" });
    expect(within(recent).getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual(["Elm Park"]);
    const all = screen.getByRole("region", { name: "All places" });
    expect(within(all).getAllByRole("heading", { level: 3 })).toHaveLength(many.length);
    // One anchor per place, on its All row.
    expect(document.querySelectorAll(`#place-${many[3].id}`)).toHaveLength(1);
    expect(within(all).getByRole("link", { name: "Edit Cedar Pool" }).closest("article")?.id).toBe(`place-${many[3].id}`);
  });

  it("searches saved and archived places, and Escape or Clear search brings the sections back", () => {
    const archived = { id: "30000000-0000-4000-8000-000000000199", name: "Old Cedar Hall", archivedAt: "2026-10-20T09:00:00.000Z" };
    render(<PlacesManager archivedPlaces={[archived]} learnedPlaces={[]} now={NOW} places={many} visits={visits} />);
    const input = screen.getByRole("searchbox", { name: "Search places" });
    fireEvent.change(input, { target: { value: "cedar" } });
    expect(screen.queryByRole("region", { name: "Frequent" })).toBeNull();
    const results = screen.getByRole("region", { name: "Results" });
    expect(within(results).getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual(["Cedar Pool"]);
    expect(within(screen.getByRole("region", { name: "Archived" })).getByText("Old Cedar Hall")).toBeTruthy();
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toContain("2 places match, 1 archived.");

    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("region", { name: "Frequent" })).toBeTruthy();

    fireEvent.change(input, { target: { value: "nowhere" } });
    expect(screen.getByText("No places match “nowhere”")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });
});
