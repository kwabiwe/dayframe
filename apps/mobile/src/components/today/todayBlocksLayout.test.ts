import { describe, expect, it } from "vitest";
import { TODAY_CARD, compactDuration, spokenDuration, todayCardActionCentres } from "./todayBlocksLayout";

describe("Today Blocks card layout", () => {
  it.each([375, 402, 440])("keeps Play and Stop, and both Add past time buttons, on one track at %ipx", (width) => {
    const idle = todayCardActionCentres(width);
    const running = todayCardActionCentres(width);
    expect(running).toEqual(idle);
    expect(idle.primary.x).toBe(width - TODAY_CARD.padding - TODAY_CARD.primaryActionSize / 2);
    expect(idle.primary.y).toBe(idle.secondary.y);
    expect(idle.primary.x - idle.secondary.x).toBe(
      TODAY_CARD.primaryActionSize / 2 + TODAY_CARD.actionGap + TODAY_CARD.secondaryActionSize / 2
    );
  });

  it("keeps the actions on the bottom inset when larger text grows the card", () => {
    const grown = todayCardActionCentres(402, 260);
    expect(grown.primary.y + TODAY_CARD.primaryActionSize / 2).toBe(260 - TODAY_CARD.padding);
    expect(TODAY_CARD.secondaryActionSize).toBeGreaterThanOrEqual(44);
  });

  it("speaks durations naturally and shows compact week totals", () => {
    expect(spokenDuration(42)).toBe("less than a minute");
    expect(spokenDuration(3723)).toBe("1 hour 2 minutes");
    expect(spokenDuration(7200)).toBe("2 hours");
    expect(compactDuration(0)).toBe("0m");
    expect(compactDuration(35 * 60)).toBe("35m");
    expect(compactDuration(4 * 3600 + 12 * 60)).toBe("4h 12m");
    expect(compactDuration(3 * 3600)).toBe("3h");
  });
});
