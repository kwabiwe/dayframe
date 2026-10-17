import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", () => ({ Share: { share: vi.fn() } }));
const probe = vi.hoisted(() => ({ runningMapKitChecks: vi.fn(), startMapKitChecks: vi.fn() }));
vi.mock("./mapKitProbe", () => probe);

const { useMapKitChecks } = await import("./useMapKitChecks");

describe("Check Apple Maps nearby data, between render and effect (Codex r2 on #489)", () => {
  it("frees the row when the run its first render saw has finished by the time its effect runs", () => {
    // The first render sees a run; by the mount effect it has finished and cleared itself.
    probe.runningMapKitChecks
      .mockReturnValueOnce({ id: 1, result: new Promise(() => undefined) })
      .mockReturnValue(null);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useMapKitChecks({ share: async () => undefined }).checking);
      return null;
    }
    let tree: ReactTestRenderer | undefined;
    act(() => { tree = create(<Probe />); });
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
    expect(probe.startMapKitChecks).not.toHaveBeenCalled();
    act(() => tree!.unmount());
  });
});
