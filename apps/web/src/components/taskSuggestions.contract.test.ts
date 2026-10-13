import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timerSource = readFileSync(
  fileURLToPath(new URL("./PersistentTimerBar.tsx", import.meta.url)),
  "utf8"
);
const runtimeSource = readFileSync(
  fileURLToPath(new URL("./AppShellRuntime.tsx", import.meta.url)),
  "utf8"
);

describe("web task suggestion interaction", () => {
  it("opens compact suggestions from the task field, not the Play submission", () => {
    const descriptionInput = timerSource.slice(
      timerSource.indexOf("<InlineTagInput"),
      timerSource.indexOf("{suggestionsOpen && !hashtagSuggestionsOpen")
    );
    const submitHandler = timerSource.slice(
      timerSource.indexOf("async function submitTimer("),
      timerSource.indexOf("function startFromEnter(")
    );

    expect(descriptionInput).toContain("onFocus");
    expect(descriptionInput).toContain("onClick");
    expect(descriptionInput).toContain("setSuggestionsOpen(true)");
    expect(submitHandler).not.toContain("setSuggestionsOpen(true)");
    expect(timerSource).toContain("const TASK_SUGGESTION_LIMIT = 5");
    expect(timerSource).toContain("taskSuggestions.slice(0, TASK_SUGGESTION_LIMIT)");
    expect(descriptionInput).toContain("onInputKeyDown");
    expect(descriptionInput).toContain('event.key === "ArrowDown"');
    expect(descriptionInput).toContain('event.key === "Escape"');
  });

  it("syncs tag-only changes and restores clean description plus persisted tag state after failure", () => {
    // Tags count as edited by normalized name (timerDetailEquivalent), and only an edit autosaves.
    expect(timerSource).toContain("if (!active || !timerDraftEdited) return undefined;");
    expect(runtimeSource).toContain(
      "setTimerDraft(timerDraftForEntry(snapshot.activeEntry))"
    );
    expect(timerSource).toContain("onSelectedTagNamesChange");
    expect(timerSource).not.toContain("descriptionWithTagTokens");
  });

  it("starts Quick Actions from a clean category-only draft", () => {
    expect(timerSource).toContain("const draft = quickActionTimerDraft(action.categoryId)");
    expect(timerSource).toContain("setTimerDraft(draft)");
    // The Start is asked for before the bar shows its draft, so the runtime keeps the outgoing
    // block's edits (Codex r10 on #361).
    expect(timerSource).toContain("const started = startTimer(draft, { dedupeRunning: true });\n    setTimerDraft(draft);");
  });
});
