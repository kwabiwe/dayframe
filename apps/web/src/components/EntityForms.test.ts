import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Places entity UI copy", () => {
  it("keeps project, client and tag labels out of changed Places UI", () => {
    const entityForms = readFileSync(fileURLToPath(new URL("./EntityForms.tsx", import.meta.url)), "utf8");
    const placesPage = readFileSync(fileURLToPath(new URL("../app/places/page.tsx", import.meta.url)), "utf8");
    const source = `${entityForms}\n${placesPage}`;

    expect(source).not.toMatch(/\bProjects?\b/);
    expect(source).not.toMatch(/\bClients?\b/);
    expect(source).not.toMatch(/\bTags?\b/);
  });
});

describe("Automation rule assistant UI", () => {
  it("exposes reviewed natural-language rule saving", () => {
    const entityForms = readFileSync(fileURLToPath(new URL("./EntityForms.tsx", import.meta.url)), "utf8");

    expect(entityForms).toContain("Save reviewed rule");
    expect(entityForms).toContain("geofence_exit");
    expect(entityForms).toContain("automationRuleInputFromDraft");
    expect(entityForms).toContain("activityDescription");
  });
});
