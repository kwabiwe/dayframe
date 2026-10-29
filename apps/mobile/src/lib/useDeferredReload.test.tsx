import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useDeferredReload } from "./useDeferredReload";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

function mount(ready: boolean) {
  const reload = vi.fn();
  const result: { request: () => void } = { request: () => undefined };
  function Harness({ ready: now }: { ready: boolean }) {
    result.request = useDeferredReload(now, reload);
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness ready={ready} />); });
  return { reload, request: () => act(() => result.request()), setReady: (next: boolean) => act(() => tree.update(<Harness ready={next} />)) };
}

describe("useDeferredReload (Codex r3 on #615)", () => {
  it("reloads when back in front after a request made while away", () => {
    const { reload, request, setReady } = mount(false);
    request();
    expect(reload).not.toHaveBeenCalled();
    setReady(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads on a request that settles after the return to the front (the other order)", () => {
    const { reload, request, setReady } = mount(false);
    setReady(true);
    expect(reload).not.toHaveBeenCalled();
    request();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads once per request, not again on later returns", () => {
    const { reload, request, setReady } = mount(true);
    request();
    setReady(false);
    setReady(true);
    expect(reload).toHaveBeenCalledOnce();
    request();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
