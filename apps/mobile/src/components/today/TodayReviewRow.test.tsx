import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { TodayActivity } from "@/lib/todayReviewPresentation";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@/lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("@/lib/mobileTheme", () => ({ pressable: vi.fn() }));

import { TodayReviewRow } from "./TodayReviewRow";

const styles = {
  buttonDisabled: "disabled",
  buttonPressed: "pressed",
  todayEntryDot: "dot",
  todayEntryMeta: "meta",
  todayEntryOptionalMeta: "optional",
  todayEntryTitle: "title",
  todayReviewCheck: "check",
  todayReviewCheckText: "checkText",
  todayReviewInlineError: "error",
  todayReviewRow: "row",
  todayReviewRowHeader: "header",
  todayReviewRowMain: "main",
  todayReviewStateBadge: "badge",
  todayReviewStateBadgeAttention: "attention",
  todayReviewStateBadgeAttentionText: "attentionText",
  todayReviewStateBadgeText: "badgeText",
} as never;

const theme = { mode: "dark", textSecondary: "muted" } as never;

describe("TodayReviewRow", () => {
  it("keeps exact Open and Quick Confirm as sibling actions", () => {
    const onOpen = vi.fn();
    const onQuickConfirm = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <TodayReviewRow
          activity={activity()}
          committing={false}
          message={null}
          nowMs={Date.parse("2026-09-12T12:00:00.000Z")}
          onOpen={onOpen}
          onQuickConfirm={onQuickConfirm}
          styles={styles}
          theme={theme}
        />
      );
    });
    const actions = tree.root.findAllByType("Pressable" as never);
    expect(actions).toHaveLength(2);
    expect(actions[0].props.accessibilityLabel).toContain("Needs review");
    expect(actions[1].props.accessibilityLabel).toContain("Confirm");

    act(() => actions[1].props.onPress());
    expect(onQuickConfirm).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    act(() => actions[0].props.onPress());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("removes the check from saved and attention states rather than exposing a fake retry", () => {
    for (const state of ["accepted_locally", "needs_attention"] as const) {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TodayReviewRow
            activity={activity({ state, resolution: state === "needs_attention" ? "unknown" : "pending" })}
            committing={false}
            message={null}
            nowMs={Date.parse("2026-09-12T12:00:00.000Z")}
            onOpen={vi.fn()}
            onQuickConfirm={vi.fn()}
            styles={styles}
            theme={theme}
          />
        );
      });
      expect(tree.root.findAllByType("Pressable" as never)).toHaveLength(1);
    }
  });
});

function activity(overrides: Partial<TodayActivity> = {}): TodayActivity {
  return {
    presentationKey: "owner:review:10000000-0000-4000-8000-000000000001:2026-09-12",
    ownerKey: "owner",
    source: { kind: "review", reviewItemId: "10000000-0000-4000-8000-000000000001" },
    state: "needs_review",
    canonicalEntryIds: [],
    interval: { startMs: Date.parse("2026-09-12T09:00:00.000Z"), endMs: Date.parse("2026-09-12T09:30:00.000Z") },
    clippedInterval: { startMs: Date.parse("2026-09-12T09:00:00.000Z"), endMs: Date.parse("2026-09-12T09:30:00.000Z") },
    detectedAtMs: Date.parse("2026-09-12T09:00:00.000Z"),
    reviewSourceKind: "generic",
    title: "Synthetic walk",
    category: { id: null, name: "Health", color: "moss" },
    placeLabel: null,
    awaitingDecision: true,
    countsAsLogged: false,
    quickConfirm: {
      eligible: true,
      mutation: {
        action: "accept",
        expectedProposalHash: "a".repeat(64)
      }
    },
    resolution: "none",
    ...overrides
  };
}
