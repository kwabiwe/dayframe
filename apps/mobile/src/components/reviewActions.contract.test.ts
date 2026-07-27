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
});
