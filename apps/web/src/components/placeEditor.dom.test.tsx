// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow, PlaceRow } from "@/lib/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn() }));
vi.mock("./PlaceMapPreview", () => ({ PlaceMapPreview: () => <div data-testid="map" /> }));
vi.mock("./PlaceSearchCombobox", () => ({ PlaceSearchCombobox: () => <input aria-label="Search for a place" /> }));

const { PlaceEditor } = await import("./PlaceEditor");
const { PlaceEditorPage } = await import("./PlaceEditorPage");

const categories = [{ id: "c1", name: "Gym", color: "mint", isPinned: false, icon: null }] as unknown as CategoryRow[];
const place = (overrides: Partial<PlaceRow> = {}) => ({
  id: "30000000-0000-4000-8000-000000000001",
  name: "Gym",
  latitude: 51.5,
  longitude: -0.1,
  radiusMeters: 100,
  priority: 5,
  role: null,
  loggingEnabled: true,
  defaultCategoryId: null,
  defaultActivityDescription: null,
  ...overrides
}) as unknown as PlaceRow;

afterEach(() => cleanup());

describe("Place editor in Blocks (UIA-308)", () => {
  it("has the iPhone's back link, title and groups, with coral only for Save", () => {
    render(
      <PlaceEditorPage subtitle="Changes apply to new visits." title="Edit place">
        <PlaceEditor categories={categories} mode="edit" place={place()} places={[place()]} />
      </PlaceEditorPage>
    );
    expect(screen.getByRole("link", { name: "Places" }).getAttribute("href")).toBe("/places");
    expect(screen.getByRole("heading", { level: 1, name: "Edit place" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Where", "Name", "Size", "Visits", "Advanced"]);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("ui-button-primary");
    expect(screen.getByRole("link", { name: "Cancel" }).className).toContain("df-rbtn--ghost");
    expect(screen.getByLabelText("Default description")).toBeTruthy();
  });

  it("picks a size from 50, 100 and 200 m and keeps another saved size until one is picked", () => {
    render(<PlaceEditor categories={categories} mode="edit" place={place({ radiusMeters: 150 })} places={[place()]} />);
    const sizes = within(screen.getByRole("radiogroup", { name: "Place radius" }));
    expect(sizes.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, false, false]);
    expect(screen.getByText(/This place uses 150 m/)).toBeTruthy();
    expect((screen.getByLabelText("Exact size") as HTMLInputElement).value).toBe("150");
    fireEvent.click(sizes.getByRole("radio", { name: "200 m" }));
    expect((sizes.getByRole("radio", { name: "200 m" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Exact size") as HTMLInputElement).value).toBe("200");
    expect(screen.queryByText(/This place uses/)).toBeNull();
    // Native radios share one name, so arrow keys move between sizes.
    expect(new Set(sizes.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).name))).toEqual(new Set(["df-pe-radius"]));
  });

});
