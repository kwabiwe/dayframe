import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import type { TodayActivity } from "@/lib/todayReviewPresentation";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ save: vi.fn(), announce: vi.fn() }));
vi.mock("react-native", () => ({ AccessibilityInfo: { announceForAccessibility: mocks.announce } }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/lib/todayReviewNavigation", () => ({ todayReviewNavigationTarget: vi.fn() }));
vi.mock("@/lib/reviewQuickConfirm", async () => ({
  ...await import("../../lib/reviewQuickConfirm"),
  saveQuickReviewConfirmation: mocks.save
}));
vi.mock("./useTodayReviewPresentation", () => ({
  useTodayReviewPresentation: () => ({
    owner: { backendId: "staging", workspaceId: "workspace", userId: "user" },
    snapshot: { response: {} }, presentation: null
  })
}));
import { QuickConfirmUnavailableError } from "@/lib/reviewQuickConfirm";
import { TodayReviewPresentationProvider, useTodayReviewPresentationContext } from "./TodayReviewPresentationContext";

let context: ReturnType<typeof useTodayReviewPresentationContext>;
function Probe() { context = useTodayReviewPresentationContext(); return null; }
beforeEach(() => vi.clearAllMocks());

it.each([true, false])("distinguishes stale proposal guidance from local persistence failure (stale=%s)", async (stale) => {
  mocks.save.mockRejectedValueOnce(stale ? new QuickConfirmUnavailableError() : new Error("disk unavailable"));
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayReviewPresentationProvider bootstrap={null} dashboardEntries={[]} manualProjectedEntries={[]} isFocused nowMs={0}><Probe /></TodayReviewPresentationProvider>);
  });
  await act(async () => {
    context!.quickConfirm({
      source: { kind: "review", reviewItemId: "review" },
      quickConfirm: { eligible: true, mutation: { action: "accept", expectedProposalHash: "a".repeat(64) } }
    } as TodayActivity);
  });
  expect(context!.messageFor("review")).toBe(stale
    ? "This Review proposal is no longer available. Refresh it before confirming."
    : "The confirmation was not saved on this iPhone. Try again.");
  expect(mocks.announce).toHaveBeenCalledWith(stale
    ? "This Review proposal is no longer available. Refresh it before confirming."
    : "The confirmation was not saved. The Review proposal is still available.");
  expect(context!.isCommitting("review")).toBe(false);
  act(() => tree.unmount());
});
