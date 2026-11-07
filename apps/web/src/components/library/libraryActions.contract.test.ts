import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UIA-316 and Trello 206: the Library switch never moves, adding is each tab's first row, and the
// row actions are the prototype's simple ones.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const head = read("./LibraryHead.tsx");
const placesPage = read("../../app/places/page.tsx");
const places = read("../PlacesManager.tsx");
const roles = read("../PlaceRoleSlots.tsx");
const css = read("../../app/globals.css");

describe("Library actions (UIA-316)", () => {
  it("keeps the tab switch alone in the head; Add place is the Places tab's first row", () => {
    expect(head).not.toContain("{action}");
    expect(placesPage).toContain('<LibraryHead current="/places" />');
    const addPlace = places.indexOf('href="/places/new">Add place</Link>');
    const roleSlots = places.indexOf("<PlaceRoleSlots");
    expect(addPlace).toBeGreaterThan(-1);
    expect(roleSlots).toBeGreaterThan(-1);
    expect(addPlace).toBeLessThan(roleSlots);
  });

  it("uses the simple ghost row actions and a neutral delete icon, like Tags", () => {
    // Rows only: the learned place's details dialog keeps its primary action.
    expect(places).not.toContain("ui-button-secondary");
    expect(roles).not.toMatch(/ui-button-(primary|secondary)/);
    expect(roles).not.toContain('variant="danger"');
    expect(places).toContain('className="df-icon-action df-icon-action--44"');
    expect(roles.match(/df-rbtn df-rbtn--sm df-rbtn--ghost/g)?.length).toBe(4);
  });

  it("gives each activity row a flexible Edit area and a separate 44 px pin column", () => {
    expect(css).toMatch(/\.df-lrow \{[^}]*grid-template-columns: minmax\(0, 1fr\) 44px;/);
    expect(css).toMatch(/\.df-lrow-edit \{[^}]*min-height: 48px;/);
  });
});
