import { describe, expect, it } from "vitest";
import { placeDisplayNameSql, placeRoleLabelSql } from "./place-display";

describe("place display SQL", () => {
  it("labels role places and falls back to the saved name", () => {
    expect(placeRoleLabelSql("p")).toBe("(case p.role when 'home' then 'Home' when 'work' then 'Work' end)");
    expect(placeDisplayNameSql("pl")).toBe("coalesce((case pl.role when 'home' then 'Home' when 'work' then 'Work' end), pl.name)");
  });

  it("rejects anything but a plain table alias", () => {
    expect(() => placeDisplayNameSql("pl; drop table places")).toThrow();
    expect(() => placeRoleLabelSql("P")).toThrow();
  });
});
