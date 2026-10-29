import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { searchResultCommand } from "@/lib/command-palette";
import { CALENDAR_LIST_HREF, reviewHashItemId, reviewLinkItemId, reviewRedirectHref } from "@/lib/review-redirect";

// Location v4 step 15: the web Review page is gone; old /review links land on Calendar › List. Synthetic ids only.
const ID = "00000000-0000-4000-8000-0000000000a1";

describe("old /review links (location v4 step 15)", () => {
  it("reads the item an old link names, in the query or an older palette's hash", () => {
    expect(reviewLinkItemId({})).toBeNull();
    expect(reviewLinkItemId({ check: ID })).toBe(ID);
    expect(reviewLinkItemId({ item: ID })).toBe(ID);
    expect(reviewLinkItemId({ id: [ID, "other"] })).toBe(ID);
    expect(reviewLinkItemId({ check: "first" })).toBe("first");
    // Anything else is no item: never read from the database.
    expect(reviewLinkItemId({ check: "'; drop table review_items" })).toBeNull();
    expect(reviewHashItemId(`#review-${ID}`)).toBe(ID);
    expect(reviewHashItemId("#review-%E0%A4%A")).toBeNull();
    expect(reviewHashItemId("")).toBeNull();
  });

  it("goes to the List, at the named \"?\" on its own day when known", () => {
    expect(reviewRedirectHref(null)).toBe(CALENDAR_LIST_HREF);
    expect(reviewRedirectHref("first")).toBe("/timeline?view=list&scope=day&check=first");
    expect(reviewRedirectHref(ID, "2026-10-24")).toBe(`/timeline?view=list&scope=day&date=2026-10-24&check=${ID}`);
    expect(reviewRedirectHref(ID, null)).toBe(`/timeline?view=list&scope=day&check=${ID}`);
  });

  it("keeps /review a redirect only, scoped to the signed-in workspace and user, and the deck gone", () => {
    const page = readFileSync(`${process.cwd()}/src/app/review/page.tsx`, "utf8");
    expect(page).not.toContain("ReviewDeck");
    expect(page).toContain("resolvePageSession()");
    expect(page).toMatch(/where id = \$1 and workspace_id = \$2 and user_id = \$3/);
    expect(page).toContain("redirect(reviewRedirectHref(itemId, dateKey))");
  });

  it("links a found \"?\" from the palette to the List, never to /review", () => {
    const command = searchResultCommand({ kind: "review", id: `review:${ID}`, label: "Visited a place", detail: "",
      occurredAt: new Date(2026, 9, 24, 9).toISOString() } as Parameters<typeof searchResultCommand>[0]);
    expect(command.action).toEqual({ kind: "navigate", href: `/timeline?view=list&scope=day&date=2026-10-24&check=${ID}` });
  });
});
