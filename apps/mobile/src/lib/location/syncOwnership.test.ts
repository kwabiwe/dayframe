import { describe, expect, it, vi } from "vitest";
import {
  executeOwnedLocationRequest,
  prepareOwnedLocationBatch
} from "./syncOwnership";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("location sync ownership", () => {
  it("does not select a batch after the account already changed", async () => {
    const prepare = vi.fn(async () => ({ accountKey: "account-b" }));

    await expect(prepareOwnedLocationBatch({
      isCurrent: () => false,
      prepare
    })).resolves.toEqual({ status: "session_changed" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("discards a batch when the account changes while selection is in flight", async () => {
    let current = true;
    const selection = deferred<{ accountKey: string } | null>();
    const prepare = vi.fn(() => selection.promise);
    const result = prepareOwnedLocationBatch({
      isCurrent: () => current,
      prepare
    });

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    current = false;
    selection.resolve({ accountKey: "account-a" });

    await expect(result).resolves.toEqual({ status: "session_changed" });
  });

  it("does not dispatch after the account changes before the request", async () => {
    const request = vi.fn(async () => ({ ok: true }));

    await expect(executeOwnedLocationRequest({
      isCurrent: () => false,
      request
    })).resolves.toEqual({ status: "session_changed" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not expose a response for mutation after an account switch", async () => {
    let current = true;
    const network = deferred<{ acknowledgedEvidenceIds: string[] }>();
    const request = vi.fn(() => network.promise);
    const result = executeOwnedLocationRequest({
      isCurrent: () => current,
      request
    });

    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    current = false;
    network.resolve({ acknowledgedEvidenceIds: ["evidence-a"] });

    await expect(result).resolves.toEqual({ status: "session_changed" });
  });
});
