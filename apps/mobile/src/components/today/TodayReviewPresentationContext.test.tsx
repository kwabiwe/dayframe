import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ presentation: null as unknown }));
vi.mock("./useTodayReviewPresentation", () => ({
  useTodayReviewPresentation: () => ({
    owner: { backendId: "staging", workspaceId: "workspace", userId: "user" },
    snapshot: { response: {} },
    presentation: mocks.presentation
  })
}));
import { TodayReviewPresentationProvider, useTodayReviewPresentationContext } from "./TodayReviewPresentationContext";

let context: ReturnType<typeof useTodayReviewPresentationContext>;
function Probe() { context = useTodayReviewPresentationContext(); return null; }
beforeEach(() => { mocks.presentation = null; });

it.each([
  [null, false],
  [{ coverage: "unavailable" }, false],
  [{ coverage: "cached" }, true],
  [{ coverage: "complete" }, true],
])("offers the presentation to the nudge only when it is usable (%j)", (presentation, available) => {
  mocks.presentation = presentation;
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayReviewPresentationProvider bootstrap={null} dashboardEntries={[]} manualProjectedEntries={[]} isFocused nowMs={0}><Probe /></TodayReviewPresentationProvider>);
  });
  expect(context!.isSummaryAvailable).toBe(available);
  expect(context!.presentation).toBe(presentation);
  expect(Object.keys(context!)).not.toContain("quickConfirm");
  act(() => tree.unmount());
});
