import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const deck = readFileSync(fileURLToPath(new URL("./review/ReviewDeck.tsx", import.meta.url)), "utf8");

describe("Review card overlap (Trello: web Review overlap)", () => {
  it("shows the quiet overlap line under the time, not the old overlap box", () => {
    expect(deck).toContain("<OverlapLine");
    expect(deck).not.toContain("<OverlapNotice");
    expect(deck).toMatch(/className="df-rwhen df-tnum"[\s\S]*?<\/p>\s*\) : null\}\s*\{overlap\}/);
  });
});
