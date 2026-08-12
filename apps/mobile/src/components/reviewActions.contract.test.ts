import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const reviewSource = source("../../app/review.tsx");
const evidenceSource = source("../../app/review/[id].tsx");
const evidenceMapSource = source("./location/LocationEvidenceMap.tsx");
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

  it("keeps Review cards concise and expresses confidence accessibly", () => {
    expect(reviewSource).toContain("reviewConfidencePresentation(item.confidence)");
    expect(reviewSource).toContain("Confidence: ${confidence.label}, ${confidence.score} of 5");
    expect(reviewSource).toContain("reviewOverlapRow");
    expect(reviewSource).toContain("You can still confirm");
    expect(reviewSource).not.toContain("Reports will show logged and covered time separately");
    expect(reviewSource).not.toContain("ReviewDiagnosticsPanel");
    expect(themeSource).toContain("reviewItemsSection");
    expect(themeSource).toContain("reviewConfidenceDot");
  });

  it("presents Location Evidence as activity, time and map while retaining resolution actions", () => {
    expect(evidenceSource).toContain("formatEvidenceTimeRange(evidence)");
    expect(evidenceSource).toContain("showDetails={false}");
    expect(evidenceSource).toContain('evidence.segment.kind === "commute" ? "Commute"');
    expect(evidenceSource).toContain('action: "split"');
    expect(evidenceSource).toContain('action: "merge"');
    expect(evidenceSource).toContain('action: "record_once"');
    expect(evidenceSource).not.toContain("Time and uncertainty");
    expect(evidenceSource).not.toContain("Raw evidence is retained until");
    expect(evidenceMapSource).toContain("showDetails = true");
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
    expect(editSheetSource).toContain("descriptionInputRef.current?.focus()");
    expect(reviewSource).toContain("onPresented={finishEditHandover}");
    expect(reviewSource).toContain('reason: "review_edit"');
    expect(reviewSource).toContain("historicalEntries={reviewPeerEntries(data)}");
    expect(editSheetSource).not.toContain("focusDescriptionOnShow");
  });

  it("keeps Review cards pending until server acknowledgement and reconciles stale bootstrap data", () => {
    expect(reviewSource).toContain("enqueueReviewMutation");
    expect(reviewSource).toContain("getReviewItemSyncStates");
    expect(reviewSource).toContain("Waiting to sync");
    expect(reviewSource).not.toContain("removeReviewItemOptimistically");
    expect(reviewSource).toContain("synchroniseReviewMutations");
    expect(reviewSource).toContain("loadCachedReviewBootstrap");
    expect(reviewSource).toContain("new Map<string, number>()");
    expect(reviewSource).toContain('AppState.addEventListener("change"');
    expect(reviewSource).not.toContain("applyAfterSuccessfulMutation");
    expect(reviewSource).not.toContain("applyOptimisticMutation");
    expect(reviewSource).not.toContain("resolvingId");
  });
});
