import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const reviewSource = source("../../app/review.tsx");
const evidenceSource = source("../../app/review/[id].tsx");
const evidenceEditorSource = source("./location/LocationReviewCorrectionEditor.tsx");
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
    expect(evidenceSource).toContain("loadGenerationRef");
    expect(evidenceSource).toContain("generation !== loadGenerationRef.current");
  });

  it("keeps Review cards concise and expresses confidence accessibly", () => {
    expect(reviewSource).toContain("reviewConfidencePresentation(item.confidence)");
    expect(reviewSource).toContain("locationReviewReasonCopy(item");
    expect(reviewSource).toContain("Confidence: ${confidence.label}, ${confidence.score} of 5");
    expect(reviewSource).toContain("reviewOverlapRow");
    expect(reviewSource).toContain("You can still confirm");
    expect(reviewSource).not.toContain("Reports will show logged and covered time separately");
    expect(reviewSource).not.toContain("ReviewDiagnosticsPanel");
    expect(themeSource).toContain("reviewItemsSection");
    expect(themeSource).toContain("reviewConfidenceDot");
    expect(reviewSource).toContain("reviewCardAccentRail");
    expect(themeSource).toMatch(/reviewCardAccentRail:[\s\S]*top:\s*12,[\s\S]*bottom:\s*12,[\s\S]*width:\s*3/);
    expect(themeSource).not.toMatch(/reviewCard:[\s\S]{0,180}borderLeftWidth/);
  });

  it("presents Location Evidence as activity, time and map while retaining resolution actions", () => {
    expect(evidenceSource).toContain("<LocationReviewCorrectionEditor");
    expect(evidenceEditorSource).toContain("formatEvidenceTimeRange(evidence)");
    expect(evidenceEditorSource).toContain("showDetails={false}");
    expect(evidenceEditorSource).toContain('evidence.segment.kind === "commute" ? "Commute"');
    expect(evidenceEditorSource).toContain('action: "split"');
    expect(evidenceEditorSource).toContain('action: "merge"');
    expect(evidenceEditorSource).toContain('action: "record_once"');
    expect(evidenceSource).not.toContain("Time and uncertainty");
    expect(evidenceSource).not.toContain("Raw evidence is retained until");
    expect(evidenceMapSource).toContain("showDetails = true");
  });

  it("uses one Where, What and When editor without creating category or mutation owners", () => {
    expect(evidenceEditorSource).toContain('evidence.segment.kind === "stay"');
    expect(evidenceEditorSource).not.toContain("Route detected");
    expect(evidenceEditorSource).not.toContain("Start and end are shown on the map");
    expect(evidenceEditorSource).toContain("What did you do?");
    expect(evidenceEditorSource).toContain('label="When?"');
    expect(evidenceEditorSource).toContain("createNativePlaceSearchProvider");
    expect(evidenceEditorSource).toContain("buildLocationReviewResolutionAction");
    expect(evidenceEditorSource).not.toContain("FloatingDatePicker");
    expect(evidenceEditorSource).toContain('accessibilityLabel="Start time"');
    expect(evidenceEditorSource).toContain('accessibilityLabel="End time"');
    expect(evidenceEditorSource).toContain("accessibilityLabel={`Duration ${editableDuration}`}");
    expect(evidenceEditorSource).toContain("Commute automatically");
    expect(evidenceEditorSource).not.toContain("createCategory");
    expect(evidenceEditorSource).not.toContain("resolveLocationReviewItem");
    expect(evidenceSource).toContain("resolveLocationReviewItem(id, action)");
  });

  it("keeps evidence fields visible above the keyboard and uses compact category visuals", () => {
    const categoryChoiceSource = evidenceEditorSource
      .split("function CategoryChoice")[1]
      ?.split("function ActivityGlyph")[0] ?? "";
    expect(evidenceEditorSource).toContain('automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}');
    expect(evidenceEditorSource).toContain("keyboardRevealScrollOffset");
    expect(evidenceEditorSource).toContain("revealGenerationRef");
    expect(evidenceEditorSource).toContain('placeholder={evidence.segment.kind === "commute" ? "Add commute details (optional)" : "Add activity (optional)"}');
    expect(evidenceEditorSource).toContain("initialLocationReviewDescription");
    expect(evidenceEditorSource).toMatch(/touch:\s*\{\s*minHeight:\s*44/);
    expect(evidenceEditorSource).toMatch(/visual:\s*\{\s*minHeight:\s*32/);
    expect(categoryChoiceSource).not.toContain("CheckGlyph");
  });

  it("loads nearby POIs for saved and unknown stays and keeps typed search as the fallback", () => {
    expect(evidenceEditorSource).toContain("createNativeNearbyPointOfInterestProvider");
    expect(evidenceEditorSource).toContain('!isFocused || !nearbyProvider || evidence.segment.kind !== "stay" || baselinePlaceId || !centre');
    expect(evidenceEditorSource).toContain("void controller.load(centre)");
    expect(evidenceEditorSource).toContain("Nearby places");
    expect(evidenceEditorSource).toContain("Search other places");
    expect(evidenceEditorSource).toContain("searchQuery.trim().length < 2");
    expect(evidenceEditorSource).toContain("nearbyChoices.map");
    expect(evidenceEditorSource).toContain("setSelectedPoint({ latitude: place.latitude, longitude: place.longitude })");
  });

  it("defaults POI selection to one-time recording with an explicit save toggle", () => {
    expect(evidenceEditorSource).toContain("useState(false)");
    expect(evidenceEditorSource).toContain('action: "record_poi_once"');
    expect(evidenceEditorSource).toContain("Save for future visits");
    expect(evidenceEditorSource).toContain('saveForFuture ? "Save place and record" : "Use once and record"');
    expect(evidenceEditorSource).toContain("buildLocationReviewResolutionAction");
  });

  it("keeps technical map evidence out of the simplified mobile presentation", () => {
    expect(evidenceMapSource).toContain('title="Start"');
    expect(evidenceMapSource).toContain('title="End"');
    expect(evidenceMapSource).toContain("Approximate route · detailed path unavailable");
    expect(evidenceMapSource).toContain("showDetails ? evidence.map.anchors.map");
    expect(evidenceEditorSource).toContain('selectedPoint={evidence.segment.kind === "stay"');
    expect(evidenceEditorSource).not.toContain('|| "No saved place"');
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
    expect(reviewSource).toContain("historicalEntries={peerEntries}");
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
