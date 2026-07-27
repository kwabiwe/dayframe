import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const reviewSource = source("../../app/review.tsx");
const evidenceSource = source("../../app/review/[id].tsx");
const themeSource = source("../lib/mobileTheme.ts");
const helperSource = source("../lib/review.ts");
const menuSource = source("./OverflowMenu.tsx");
const editSheetSource = source("./ActiveTimerEditSheet.tsx");

describe("mobile Review action contracts", () => {
  it("uses a vertical evidence, semantic confirm, and overflow hierarchy", () => {
    expect(reviewSource).toContain("reviewConfirmLabel(item)");
    expect(helperSource).toContain("Confirm commute");
    expect(helperSource).toContain("Confirm visit");
    expect(helperSource).toContain("Confirm activity");
    expect(reviewSource).toContain("<OverflowMenu");
    expect(menuSource).toMatch(/Edit details[\s\S]*Dismiss suggestion/);
    expect(reviewSource).not.toMatch(/onEdit=\{[\s\S]*onDismiss=\{/);
    expect(themeSource).toContain("reviewActionStack");
    expect(themeSource).toMatch(/reviewActions:\s*\{\s*gap:\s*8\s*\}/);
  });

  it("uses the shared mobile back affordance on Location Evidence", () => {
    expect(evidenceSource).toContain("<MobileBackButton");
    expect(evidenceSource).not.toContain(">‹</Text>");
  });

  it("hands Edit to the sheet only after the overflow modal has unmounted", () => {
    expect(reviewSource).toContain("onClosed={handleOverflowClosed}");
    expect(reviewSource).toContain("pendingAction");
    expect(reviewSource).not.toContain("requestAnimationFrame");
    expect(menuSource).toContain("onShow={handleModalShow}");
    expect(menuSource).toContain("onDismiss={handleModalDismiss}");
    expect(menuSource).toContain("useLayoutEffect");
    expect(menuSource).toContain("onClosed(completed.id)");
    expect(menuSource).not.toContain("setTimeout");
    expect(editSheetSource).toContain("onShow={handleModalShow}");
    expect(editSheetSource).toContain("AccessibilityInfo.setAccessibilityFocus");
  });

  it("removes Review cards only after durable enqueue and reconciles stale bootstrap data", () => {
    expect(reviewSource).toContain("enqueueReviewMutation");
    expect(reviewSource).toContain("removeReviewItemOptimistically");
    expect(reviewSource).toContain("synchroniseReviewMutations");
    expect(reviewSource).toContain("loadCachedReviewBootstrap");
    expect(reviewSource).toContain("new Map<string, number>()");
    expect(reviewSource).toContain('AppState.addEventListener("change"');
    expect(reviewSource).not.toContain("applyAfterSuccessfulMutation");
    expect(reviewSource).not.toContain("applyOptimisticMutation");
    expect(reviewSource).not.toContain("resolvingId");
  });
});
