import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefusedTimerStart } from "./api";
import type { RefusedTimerStartRollback } from "./useRefusedTimerStartRollback";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const listeners = vi.hoisted(() => new Set<(start: RefusedTimerStart) => void>());
vi.mock("./api", () => ({
  subscribeRefusedTimerStarts: (listener: (start: RefusedTimerStart) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
}));

const { useRefusedTimerStartRollback } = await import("./useRefusedTimerStartRollback");

const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
const refusal = (localId = "optimistic-a"): RefusedTimerStart => ({ localId, message: "late", owner: OWNER });

function Harness({ rollback }: { rollback: RefusedTimerStartRollback }) {
  useRefusedTimerStartRollback(rollback);
  return null;
}

function rollbackFixture(overrides: Partial<ReturnType<RefusedTimerStartRollback["describe"]>> = {}) {
  return {
    describe: vi.fn((start: RefusedTimerStart) => ({
      localId: start.localId,
      ownerMatches: true,
      shown: true,
      deletionPending: false,
      calendarEditorEntryId: null,
      ...overrides
    })),
    dismissCalendarEditor: vi.fn(),
    reject: vi.fn(),
    refresh: vi.fn()
  };
}

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  listeners.clear();
});

const emit = (start: RefusedTimerStart) => act(() => {
  for (const listener of [...listeners]) listener(start);
});

// Codex r3 on #532: the wiring is exercised, not matched in the Dashboard's source.
describe("useRefusedTimerStartRollback", () => {
  it("subscribes once while mounted and rolls a refused block back, alerting and refreshing", () => {
    const rollback = rollbackFixture();
    act(() => { tree = create(<Harness rollback={rollback} />); });
    act(() => tree!.update(<Harness rollback={rollback} />));
    expect(listeners.size).toBe(1);

    emit(refusal());
    expect(rollback.reject).toHaveBeenCalledOnce();
    const [localId, error, alert] = rollback.reject.mock.calls[0];
    expect(localId).toBe("optimistic-a");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("late");
    expect(alert).toBe(true);
    expect(rollback.refresh).toHaveBeenCalledOnce();
    expect(rollback.dismissCalendarEditor).not.toHaveBeenCalled();

    act(() => tree!.unmount());
    tree = undefined;
    expect(listeners.size).toBe(0);
  });

  it("cleans up a block nobody could see without the alert, and ignores another account's refusal", () => {
    const hidden = rollbackFixture({ shown: false });
    act(() => { tree = create(<Harness rollback={hidden} />); });
    emit(refusal());
    expect(hidden.reject).toHaveBeenCalledWith("optimistic-a", expect.any(Error), false);
    expect(hidden.refresh).toHaveBeenCalledOnce();

    const otherAccount = rollbackFixture({ ownerMatches: false });
    act(() => tree!.update(<Harness rollback={otherAccount} />));
    emit(refusal());
    expect(otherAccount.reject).not.toHaveBeenCalled();
    expect(otherAccount.refresh).not.toHaveBeenCalled();
  });

  it("closes a Calendar editor open on the refused block before rolling it back", () => {
    const rollback = rollbackFixture({ shown: false, calendarEditorEntryId: "optimistic-a" });
    const order: string[] = [];
    rollback.dismissCalendarEditor.mockImplementation(() => { order.push("dismiss"); });
    rollback.reject.mockImplementation(() => { order.push("reject"); });
    act(() => { tree = create(<Harness rollback={rollback} />); });
    emit(refusal());
    expect(order).toEqual(["dismiss", "reject"]);
    // The editor was on screen, so the person is told.
    expect(rollback.reject).toHaveBeenCalledWith("optimistic-a", expect.any(Error), true);
  });

  it("always calls the latest callbacks, without re-subscribing", () => {
    const first = rollbackFixture();
    const second = rollbackFixture();
    act(() => { tree = create(<Harness rollback={first} />); });
    const [subscribed] = [...listeners];
    act(() => tree!.update(<Harness rollback={second} />));
    expect([...listeners]).toEqual([subscribed]);
    emit(refusal());
    expect(first.reject).not.toHaveBeenCalled();
    expect(second.reject).toHaveBeenCalledOnce();
  });
});
