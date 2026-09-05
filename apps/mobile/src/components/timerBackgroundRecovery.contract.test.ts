import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("finite timer background recovery ownership", () => {
  it("aborts leases before logout awaits account and session cleanup", () => {
    const api = source("../lib/api.ts");
    const logoutStart = api.indexOf("export async function logout()");
    const cancel = api.indexOf('void endAllTimerBackgroundExecution("logout")', logoutStart);
    const firstAwait = api.indexOf("await readActiveMobileAccount()", logoutStart);

    expect(cancel).toBeGreaterThan(logoutStart);
    expect(cancel).toBeLessThan(firstAwait);
  });

  it("ends account, connectivity, and component teardown leases", () => {
    const owner = source("./ConnectivityRecoveryOwner.tsx");

    expect(owner).toContain('endAllTimerBackgroundExecution("account_changed")');
    expect(owner).toContain('endAllTimerBackgroundExecution("cancelled")');
    expect(owner).toContain('endAllTimerBackgroundExecution("teardown")');
  });

  it("keeps only timer mutations inside the background-capable phase", () => {
    const owner = source("./ConnectivityRecoveryOwner.tsx");
    const timerPhase = owner.indexOf('name: "timer_activity_queue"');
    const timerScope = owner.indexOf('eventScope: "timer_mutations"', timerPhase);
    const phaseEnd = owner.indexOf("await endTimerPhase(", timerScope);
    const foregroundActivity = owner.indexOf('name: "activity_queue"', phaseEnd);
    const foregroundScope = owner.indexOf('eventScope: "non_timer"', foregroundActivity);
    const review = owner.indexOf('name: "review_outbox"', foregroundScope);
    const location = owner.indexOf('name: "location_intelligence"', review);
    const bootstrap = owner.indexOf('name: "bootstrap"', location);

    expect(timerScope).toBeGreaterThan(timerPhase);
    expect(phaseEnd).toBeGreaterThan(timerScope);
    expect(foregroundScope).toBeGreaterThan(phaseEnd);
    expect(review).toBeGreaterThan(foregroundScope);
    expect(location).toBeGreaterThan(review);
    expect(bootstrap).toBeGreaterThan(location);
    expect(owner).toContain('AppState.currentState === "active" || timerCanContinue');
  });

  it("lets the Review outbox honour its durable backoff during recovery retries", () => {
    const owner = source("./ConnectivityRecoveryOwner.tsx");
    const reviewStart = owner.indexOf('name: "review_outbox"');
    const locationStart = owner.indexOf('name: "location_intelligence"', reviewStart);
    const reviewStep = owner.slice(reviewStart, locationStart);

    expect(reviewStep).toContain("await synchroniseReviewMutations()");
    expect(reviewStep).not.toContain("force: true");
  });

  it("coalesces the screen reconnect and root recovery paths in the shared outbox owner", () => {
    const owner = source("./ConnectivityRecoveryOwner.tsx");
    const reviewScreen = source("../../app/review.tsx");
    const store = source("../lib/reviewSyncStore.ts");

    expect(reviewScreen).toContain("synchroniseReviewMutations({ force: true })");
    expect(owner).toContain("await synchroniseReviewMutations()");
    expect(store).toContain("reviewCoalescer.run(account.account_key");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
