import { describe, expect, it } from "vitest";
import { groupOutings, outingKeyOf, outingRoleOf, outingTravelWords } from "./outingCards";

const card = (id: string, start: string, payload: Record<string, unknown> | null) => ({
  id, suggestedStartedAt: start, rawPayload: payload
});
const stay = (id: string, key: string, start = "2026-10-17T10:15:00.000Z") => card(id, start, { outingKey: key, outingRole: "stay" });
const move = (id: string, key: string, role: "in" | "out", start: string, travelMode = "automotive") =>
  card(id, start, { outingKey: key, outingRole: role, travelMode });

describe("groupOutings (PRD D19)", () => {
  it("puts an unknown Stay's card first with its Moves in time order, whatever order the cards came in", () => {
    const outings = groupOutings([
      move("c", "outing:a", "out", "2026-10-17T10:30:00.000Z"),
      stay("s", "outing:a"),
      move("b", "outing:a", "in", "2026-10-17T10:05:00.000Z")
    ]);
    expect([...outings.keys()]).toEqual(["s"]);
    expect(outings.get("s")!.members.map((member) => member.id)).toEqual(["b", "c"]);
  });

  it("is no outing without its Stay card, or without a Move", () => {
    expect(groupOutings([move("b", "outing:a", "in", "2026-10-17T10:05:00.000Z")]).size).toBe(0);
    expect(groupOutings([stay("s", "outing:a")]).size).toBe(0);
    expect(groupOutings([card("x", "2026-10-17T10:05:00.000Z", null)]).size).toBe(0);
  });

  it("keeps two outings apart by key", () => {
    const outings = groupOutings([
      stay("s1", "outing:a"), move("m1", "outing:a", "in", "2026-10-17T10:05:00.000Z"),
      stay("s2", "outing:b", "2026-10-17T12:00:00.000Z"), move("m2", "outing:b", "out", "2026-10-17T12:30:00.000Z")
    ]);
    expect(outings.get("s1")!.members.map((member) => member.id)).toEqual(["m1"]);
    expect(outings.get("s2")!.members.map((member) => member.id)).toEqual(["m2"]);
  });

  it("leaves an ineligible card out: an ineligible Move shows on its own, an ineligible Stay has no outing", () => {
    const cards = [stay("s", "outing:a"), move("b", "outing:a", "in", "2026-10-17T10:05:00.000Z"),
      move("c", "outing:a", "out", "2026-10-17T10:30:00.000Z")];
    expect(groupOutings(cards, (item) => item.id !== "c").get("s")!.members.map((member) => member.id)).toEqual(["b"]);
    expect(groupOutings(cards, (item) => item.id !== "s").size).toBe(0);
  });

  it("reads only the roles it knows", () => {
    expect(outingRoleOf({ rawPayload: { outingRole: "elsewhere" } })).toBeNull();
    expect(outingKeyOf({ rawPayload: { outingKey: "" } })).toBeNull();
    const outings = groupOutings([stay("s", "outing:a"), card("odd", "2026-10-17T10:05:00.000Z", { outingKey: "outing:a", outingRole: "elsewhere" })]);
    expect(outings.size).toBe(0);
  });
});

describe("outingTravelWords", () => {
  it("names the way of travelling only when every Move agrees", () => {
    expect(outingTravelWords([move("b", "k", "in", "x"), move("c", "k", "out", "y")])).toBe("Drives there and back");
    expect(outingTravelWords([move("b", "k", "in", "x", "walking")])).toBe("Walks there");
    expect(outingTravelWords([move("b", "k", "in", "x", "walking"), move("c", "k", "out", "y")])).toBe("Travel there and back");
    expect(outingTravelWords([move("c", "k", "out", "y", "unknown")])).toBe("Travel on");
  });
});
