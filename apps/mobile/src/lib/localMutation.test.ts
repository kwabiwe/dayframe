import { describe, expect, it, vi } from "vitest";
import { applyAfterSuccessfulMutation } from "./localMutation";

describe("successful local mutation ordering", () => {
  it("applies local list state only after the mutation succeeds", async () => {
    const order: string[] = [];

    await applyAfterSuccessfulMutation(
      async () => {
        order.push("request");
        return "resolved-id";
      },
      (result) => order.push(`apply:${result}`)
    );

    expect(order).toEqual(["request", "apply:resolved-id"]);
  });

  it("preserves local list state when the mutation fails", async () => {
    const apply = vi.fn();

    await expect(applyAfterSuccessfulMutation(
      async () => {
        throw new Error("offline");
      },
      apply
    )).rejects.toThrow("offline");
    expect(apply).not.toHaveBeenCalled();
  });
});
