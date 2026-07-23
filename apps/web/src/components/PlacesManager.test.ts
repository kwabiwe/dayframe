import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("web Places list and editor contracts", () => {
  const manager = readFileSync(
    fileURLToPath(new URL("./PlacesManager.tsx", import.meta.url)),
    "utf8"
  );
  const editor = readFileSync(
    fileURLToPath(new URL("./PlaceEditor.tsx", import.meta.url)),
    "utf8"
  );
  const combobox = readFileSync(
    fileURLToPath(new URL("./PlaceSearchCombobox.tsx", import.meta.url)),
    "utf8"
  );
  const mapPreview = readFileSync(
    fileURLToPath(new URL("./PlaceMapPreview.tsx", import.meta.url)),
    "utf8"
  );

  it("routes create, edit and learned-place promotion through one editor", () => {
    expect(manager).toContain('href="/places/new"');
    expect(manager).toContain("/places/${encodeURIComponent(place.id)}/edit");
    expect(manager).toContain("/places/new?learnedPlaceId=");
    expect(editor).toContain('type PlaceEditorMode = "create" | "edit" | "learned"');
  });

  it("keeps priority and auto-start out of ordinary editor controls", () => {
    expect(editor).not.toContain('label="Priority"');
    expect(editor).not.toContain(">Auto-start<");
    expect(editor).toContain("autoStart: false");
    expect(editor).toContain("Suggest visits here");
  });

  it("implements the editable combobox semantics without nested suggestion buttons", () => {
    expect(combobox).toContain('role="combobox"');
    expect(combobox).toContain('aria-autocomplete="list"');
    expect(combobox).toContain('role="listbox"');
    expect(combobox).toContain('role="option"');
    expect(combobox).toContain("aria-activedescendant");
    expect(combobox).not.toMatch(/role="option"[\\s\\S]{0,400}<button/);
  });

  it("does not expose project or client controls", () => {
    const source = `${manager}\n${editor}`;
    expect(source).not.toMatch(/label="Project/);
    expect(source).not.toMatch(/label="Client/);
  });

  it("keeps save idempotence, fallback editing and attribution explicit", () => {
    expect(editor).toContain("saveInFlight.current");
    expect(editor).toContain("Current location");
    expect(editor).toContain("Advanced coordinates");
    expect(mapPreview).toContain("Map preview unavailable");
    expect(mapPreview).toContain('attributionControl: { compact: false }');
    expect(combobox).toContain("Geoapify");
    expect(combobox).toContain("OpenStreetMap");
  });
});
