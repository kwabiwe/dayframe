import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

const account = vi.hoisted(() => ({ epoch: 0 }));
vi.mock("../lib/mobileAccount", () => ({ currentMobileAccountEpoch: () => account.epoch }));

const { requestShortcutStop, resetShortcutStopRequestsForTests } = await import("../lib/shortcutStopRequests");
const { useShortcutStopHandoff } = await import("./useShortcutStopHandoff");

function Probe({ ready, stop }: { ready: boolean; stop: () => Promise<boolean> }) {
  useShortcutStopHandoff(ready, stop);
  return null;
}

describe("useShortcutStopHandoff", () => {
  beforeEach(() => {
    resetShortcutStopRequestsForTests();
    account.epoch = 0;
  });

  it("waits for timer state after sign-in, then stops once", () => {
    const stop = vi.fn(async () => true);
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe ready={false} stop={stop} />);
    });
    act(() => void requestShortcutStop());
    expect(stop).not.toHaveBeenCalled();
    act(() => tree.update(<Probe ready stop={stop} />));
    expect(stop).toHaveBeenCalledOnce();
    act(() => tree.update(<Probe ready stop={stop} />));
    expect(stop).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("stops at once when a link arrives while ready", () => {
    const stop = vi.fn(async () => true);
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe ready stop={stop} />);
    });
    act(() => void requestShortcutStop());
    expect(stop).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("drops a request from before a sign-out when the next account becomes ready", () => {
    const stop = vi.fn(async () => true);
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe ready={false} stop={stop} />);
    });
    act(() => void requestShortcutStop());
    account.epoch += 1;
    act(() => tree.update(<Probe ready stop={stop} />));
    expect(stop).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
