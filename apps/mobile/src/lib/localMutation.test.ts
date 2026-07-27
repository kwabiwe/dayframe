import { describe, expect, it, vi } from "vitest";
import {
  applyAfterSuccessfulMutation,
  applyOptimisticMutation
} from "./localMutation";

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

  it("applies optimistic state before the request settles", async () => {
    const order: string[] = [];

    await applyOptimisticMutation(
      () => {
        order.push("apply");
        return "snapshot";
      },
      async () => {
        order.push("request");
        return "resolved";
      },
      (snapshot) => order.push(`rollback:${snapshot}`)
    );

    expect(order).toEqual(["apply", "request"]);
  });

  it("rolls back the exact optimistic snapshot once when the request fails", async () => {
    const rollback = vi.fn();

    await expect(applyOptimisticMutation(
      () => ({ itemId: "review-1", index: 2 }),
      async () => {
        throw new Error("network failed");
      },
      rollback
    )).rejects.toThrow("network failed");

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith({ itemId: "review-1", index: 2 });
  });
});
