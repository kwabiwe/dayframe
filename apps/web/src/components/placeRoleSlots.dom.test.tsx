// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceRow } from "@/lib/queries";

const clientFetch = vi.fn();
vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>
}));

const { PlaceRoleSlots } = await import("./PlaceRoleSlots");

const home = place({ id: "30000000-0000-4000-8000-000000000001", name: "12 Example Street", role: "home" });
const flat = place({ id: "30000000-0000-4000-8000-000000000002", name: "34 Sample Road" });
const gym = place({ id: "30000000-0000-4000-8000-000000000003", name: "Gym" });

describe("PlaceRoleSlots", () => {
  beforeEach(() => {
    clientFetch.mockReset();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("shows Home with its address underneath and an empty Work slot", () => {
    render(<PlaceRoleSlots places={[home, flat, gym]} onChanged={vi.fn()} />);

    const homeRow = screen.getByRole("heading", { name: "Home" }).closest("article")!;
    expect(within(homeRow).getByText("12 Example Street")).toBeTruthy();
    const workRow = screen.getByRole("heading", { name: "Work" }).closest("article")!;
    expect(within(workRow).getByText("Not set")).toBeTruthy();
    expect(within(workRow).getByRole("button", { name: "Set Work" })).toBeTruthy();
  });

  it("moves Home to another place and renames the old one Previous home", async () => {
    clientFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onChanged = vi.fn();
    render(<PlaceRoleSlots places={[home, flat, gym]} onChanged={onChanged} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Change Home" }));
    const dialog = screen.getByRole("dialog", { name: "Set Home" });
    expect(within(dialog).queryByRole("textbox", { name: "Rename the old home" })).toBeNull();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Home place" }), flat.id);
    const rename = within(dialog).getByRole("textbox", { name: "Rename the old home" }) as HTMLInputElement;
    expect(rename.value).toBe("Previous home");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("Home updated."));
    expect(clientFetch).toHaveBeenCalledTimes(1);
    const [url, init] = clientFetch.mock.calls[0]!;
    expect(url).toBe("/api/places/role");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ role: "home", placeId: flat.id, previousPlaceName: "Previous home" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears Home keeping its name by default, and offers a new place in the slot", async () => {
    clientFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const onChanged = vi.fn();
    render(<PlaceRoleSlots places={[home, flat]} onChanged={onChanged} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Change Home" }));
    expect(screen.getByRole("link", { name: "Add a new place as Home" }).getAttribute("href")).toBe("/places/new?role=home");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Clear Home" }));
    const dialog = screen.getByRole("dialog", { name: "Clear Home?" });
    expect((within(dialog).getByRole("textbox", { name: "Name for this place" }) as HTMLInputElement).value).toBe("12 Example Street");
    await user.click(within(dialog).getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("Home cleared."));
    expect(JSON.parse(clientFetch.mock.calls[0]![1].body)).toEqual({ role: "home", placeId: null, previousPlaceName: null });
  });

  it("keeps the dialog and the typed name when saving fails, and sends once per click", async () => {
    let resolve: (response: Response) => void = () => undefined;
    clientFetch.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const onChanged = vi.fn();
    render(<PlaceRoleSlots places={[home, flat]} onChanged={onChanged} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Change Home" }));
    const dialog = screen.getByRole("dialog", { name: "Set Home" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Home place" }), flat.id);
    const rename = within(dialog).getByRole("textbox", { name: "Rename the old home" });
    await user.clear(rename);
    await user.type(rename, "Old flat");
    const save = within(dialog).getByRole("button", { name: "Save" });
    await user.click(save);
    await user.click(within(dialog).getByRole("button", { name: "Saving…" }));
    resolve(new Response(JSON.stringify({ error: "Another change to this place role happened at the same time. Try again." }), { status: 409 }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("Try again");
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect((within(dialog).getByRole("textbox", { name: "Rename the old home" }) as HTMLInputElement).value).toBe("Old flat");
  });

  it("offers to rename a place named Home when Home is first given to another place", async () => {
    clientFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const namedHome = place({ id: "30000000-0000-4000-8000-000000000009", name: "Home" });
    render(<PlaceRoleSlots places={[namedHome, flat]} onChanged={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Set Home" }));
    const dialog = screen.getByRole("dialog", { name: "Set Home" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Home place" }), flat.id);
    expect((within(dialog).getByRole("textbox", { name: "Rename the old home" }) as HTMLInputElement).value).toBe("Previous home");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(clientFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(clientFetch.mock.calls[0]![1].body)).toEqual({ role: "home", placeId: flat.id, previousPlaceName: "Previous home" });
  });

  it("says when choosing the Work place will empty Work", async () => {
    const office = place({ id: "30000000-0000-4000-8000-000000000004", name: "Office tower", role: "work" });
    render(<PlaceRoleSlots places={[home, office]} onChanged={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Change Home" }));
    const dialog = screen.getByRole("dialog", { name: "Set Home" });
    expect(within(dialog).queryByRole("note")).toBeNull();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Home place" }), office.id);
    expect(within(dialog).getByRole("note").textContent).toBe("This place is your Work, so Work will be empty.");
  });

  it("goes straight to adding a place when none are saved yet", () => {
    render(<PlaceRoleSlots places={[]} onChanged={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Set Home" }).getAttribute("href")).toBe("/places/new?role=home");
    expect(screen.getByRole("link", { name: "Set Work" }).getAttribute("href")).toBe("/places/new?role=work");
  });

  it("asks for a place before saving an empty slot", async () => {
    render(<PlaceRoleSlots places={[flat]} onChanged={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Set Work" }));
    await user.click(within(screen.getByRole("dialog", { name: "Set Work" })).getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Choose a saved place.");
    expect(clientFetch).not.toHaveBeenCalled();
  });
});

function place(overrides: Partial<PlaceRow> & Pick<PlaceRow, "id" | "name">): PlaceRow {
  return {
    role: null,
    latitude: 51.5,
    longitude: -0.12,
    radiusMeters: 100,
    priority: 5,
    defaultProjectId: null,
    defaultProjectName: null,
    defaultCategoryId: null,
    defaultCategoryName: null,
    defaultActivityDescription: null,
    autoStart: false,
    loggingEnabled: true,
    ...overrides
  };
}
