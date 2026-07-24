import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);

describe("secure session startup contract", () => {
  it("waits for active iOS app state before the initial authenticated load", () => {
    expect(dashboardSource).toContain('if (AppState.currentState === "active")');
    expect(dashboardSource).toContain('if (state !== "active") return;');
    expect(dashboardSource).toContain('if (AppState.currentState !== "active") return;');
  });
});
