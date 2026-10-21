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
  latitude: 10.5,
  longitude: 20.1,
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

  it("offers Log automatically only with Suggest visits on, off by default, cautioning Home (owner decision 14 Oct 2026)", () => {
    render(<PlaceEditor categories={categories} mode="edit" place={place()} places={[place()]} />);
    const autoLog = screen.getByRole("switch", { name: "Log automatically" }) as HTMLInputElement;
    expect(autoLog.checked).toBe(false);
    expect(autoLog.disabled).toBe(false);
    expect(screen.getByText("Visits here become blocks without a Review card.")).toBeTruthy();
    expect(autoLog.getAttribute("aria-describedby")).toBe("place-auto-log-help");
    expect(screen.queryByText(/Home visits can be long and broad/)).toBeNull();
    fireEvent.click(autoLog);
    expect(autoLog.checked).toBe(true);
    // Turning Suggest visits off turns it off and disables it.
    fireEvent.click(screen.getByRole("switch", { name: "Suggest visits here" }));
    expect(autoLog.checked).toBe(false);
    expect(autoLog.disabled).toBe(true);
    expect(screen.getByText(/Turn on Suggest visits here first/)).toBeTruthy();
    cleanup();
    render(<PlaceEditor categories={categories} mode="edit" place={place({ role: "home", autoLog: true } as Partial<PlaceRow>)} places={[place()]} />);
    expect((screen.getByRole("switch", { name: "Log automatically" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Home visits can be long and broad; consider leaving this off.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Log automatically" }).getAttribute("aria-describedby")).toBe("place-auto-log-help place-auto-log-caution");
  });
});

describe("Replace the old place (location v3 PR 15, PRD D19 A10)", () => {
  const oldHome = place({ id: "30000000-0000-4000-8000-000000000002", name: "12 Example Street", role: "home" });
  const typeCoordinate = (latitude: string, longitude: string) => {
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: latitude } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: longitude } });
  };

  it("offers to archive the old Home only when the new Home is within 300 m, on by default", () => {
    render(<PlaceEditor categories={categories} mode="create" place={null} places={[oldHome]} role="home" />);
    typeCoordinate("10.51", "20.1"); // about 1.1 km from the old Home
    expect(screen.queryByRole("switch", { name: "Replace the old place" })).toBeNull();
    typeCoordinate("10.502", "20.1"); // about 222 m
    const replace = screen.getByRole("switch", { name: "Replace the old place" }) as HTMLInputElement;
    expect(replace.checked).toBe(true);
    expect(screen.getByText(/The old home is within 300 m/)).toBeTruthy();
  });
});

