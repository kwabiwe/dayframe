import { describe, expect, it } from "vitest";
import { energySummaryLine, supportEnergyDiagnostics, type NativeEnergySummary } from "./energyMetrics";

const summary: NativeEnergySummary = {
  days: 7,
  bestAccuracySecondsPerDay: 12 * 60 + 30,
  backgroundLocationSecondsPerDay: 65 * 60,
  backgroundSecondsPerDay: 3 * 3600,
  cpuSecondsPerDay: 42,
  daysOverBudget: 0,
  bestAccuracyBudgetSeconds: 1200
};

describe("location energy (location v4 step 3)", () => {
  it("waits for iOS's first daily report", () => {
    expect(energySummaryLine(null)).toBe("Not reported yet: iOS sends these about once a day");
    expect(energySummaryLine({ ...summary, days: 0 })).toBe("Not reported yet: iOS sends these about once a day");
  });

  it("averages best-accuracy time against the 20-minute budget, with background location and CPU", () => {
    expect(energySummaryLine(summary)).toBe(
      "Best accuracy 12m a day (budget 20m) · background location 1h 5m · CPU 42s · average of 7 days"
    );
  });

  it("says how many days went over the budget", () => {
    expect(energySummaryLine({ ...summary, days: 1, daysOverBudget: 1, bestAccuracySecondsPerDay: 1500 }))
      .toBe("Best accuracy 25m a day (budget 20m) · over 20m on 1 day · background location 1h 5m · CPU 42s · average of 1 day");
  });

  it("puts counts only in the support details", () => {
    expect(supportEnergyDiagnostics(null, [])).toBeNull();
    const details = supportEnergyDiagnostics(summary, []);
    expect(details).toEqual({ summary, days: [] });
    expect(JSON.stringify(details)).not.toMatch(/latitude|longitude/);
  });
});
