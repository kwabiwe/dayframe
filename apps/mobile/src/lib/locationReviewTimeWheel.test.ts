import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatLocationReviewDateInput,
  formatLocationReviewTimeInput,
  locationReviewEndpointMs,
  parseLocationReviewWindow
} from "./locationReviewDraft";
import { timeWheelAccessibilityStep } from "./timeWheel";

// A11b, date pickers PR 5 (Codex r1 on #432): the Location evidence editor keeps the instant the
// time wheel or VoiceOver chose while its text still shows it.
const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Europe/London";
});

afterAll(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function windowDraft(startedAt: string, stoppedAt: string, start: { text: string; draftMs?: number | null }, stop: { text: string; draftMs?: number | null }) {
  return {
    baselineStartedAt: startedAt,
    baselineStoppedAt: stoppedAt,
    startDateText: formatLocationReviewDateInput(new Date(startedAt)),
    startDraftMs: start.draftMs ?? null,
    startTimeText: start.text,
    stopDateText: formatLocationReviewDateInput(new Date(stoppedAt)),
    stopDraftMs: stop.draftMs ?? null,
    stopTimeText: stop.text
  };
}

describe.sequential("Location evidence time wheel instants", () => {
  it("submits the second 01:30 the wheel chose when the clocks go back", () => {
    const startedAt = "2026-10-25T00:10:00.000Z"; // 01:10 BST
    const stoppedAt = "2026-10-25T02:00:00.000Z"; // 02:00 GMT
    const secondHalfPast = Date.parse("2026-10-25T01:30:00.000Z"); // 01:30 GMT
    expect(formatLocationReviewTimeInput(new Date(secondHalfPast))).toBe("01:30");
    const chosen = parseLocationReviewWindow(windowDraft(startedAt, stoppedAt, { text: "01:30", draftMs: secondHalfPast }, { text: "02:00" }));
    expect(chosen.value?.startedAt).toBe("2026-10-25T01:30:00.000Z");
    expect(locationReviewEndpointMs({ baselineMs: Date.parse(startedAt), draftMs: secondHalfPast, timeText: "01:30" })).toBe(secondHalfPast);
    // Typed over, the chosen instant no longer applies: the text is merged as typing is.
    const typed = parseLocationReviewWindow(windowDraft(startedAt, stoppedAt, { text: "01:45", draftMs: secondHalfPast }, { text: "02:00" }));
    expect(typed.value?.startedAt).not.toBe("2026-10-25T01:30:00.000Z");
  });

  it("keeps a step's cleared seconds, so consecutive VoiceOver steps keep moving", () => {
    const startedAt = "2026-10-14T08:32:23.126Z"; // 09:32:23 BST
    const stoppedAt = "2026-10-14T10:00:00.000Z";
    const baselineMs = Date.parse(startedAt);
    let draftMs: number | null = null;
    let text = formatLocationReviewTimeInput(new Date(baselineMs));
    const seen: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      const current: number = locationReviewEndpointMs({ baselineMs, draftMs, timeText: text })!;
      const next: number = timeWheelAccessibilityStep(current, -1)!;
      draftMs = next;
      text = formatLocationReviewTimeInput(new Date(next));
      seen.push(text);
    }
    // One minute per step (owner, 16 Oct 2026): the first drops the seconds.
    expect(seen).toEqual(["09:32", "09:31", "09:30"]);
    expect(parseLocationReviewWindow(windowDraft(startedAt, stoppedAt, { text, draftMs }, { text: "11:00" })).value?.startedAt)
      .toBe("2026-10-14T08:30:00.000Z");
  });
});
