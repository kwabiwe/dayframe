import { describe, expect, it } from "vitest";
import { createSerialMutationQueue } from "./mutationQueue";

describe("location SQLite mutation queue", () => {
  it("never overlaps concurrent mutations", async () => {
    const serialise = createSerialMutationQueue();
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await Promise.all(Array.from({ length: 30 }, (_, index) => serialise(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      completed.push(index);
      active -= 1;
    })));
    expect(maximumActive).toBe(1);
    expect(completed).toEqual(Array.from({ length: 30 }, (_, index) => index));
  });

  it("does not leave the journal locked after an interrupted mutation", async () => {
    const serialise = createSerialMutationQueue();
    await expect(serialise(async () => {
      throw new Error("interrupted transaction");
    })).rejects.toThrow("interrupted transaction");
    await expect(serialise(async () => "recovered")).resolves.toBe("recovered");
  });
});
