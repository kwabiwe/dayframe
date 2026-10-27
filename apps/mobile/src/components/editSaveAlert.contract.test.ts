import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * "Change not saved" belongs to the edit that was just made. The outbox's needsAttentionCount counts
 * every sync issue on the account, so an old Needs-attention item raised the alert for edits that
 * saved (TF133 staging, 27 Oct). The edit asks about its own command instead.
 */
describe("time-entry edit save alert", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
    "utf8"
  );
  const start = source.indexOf("async function saveTimeEntryOptimistically(");
  const end = source.indexOf("async function deleteCalendarEntry(", start);
  const body = source.slice(start, end);

  it("alerts only for this edit's own rejected command", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain("({ clientCommandId } = await enqueueTimeEntryUpdate({");
    expect(body).toContain("await isTimeEntryCommandRejected(owner, clientCommandId)");
    const alert = body.slice(
      body.indexOf("if (rejected && ownerCurrent()) {"),
      body.indexOf('"Change not saved"')
    );
    expect(alert).toMatch(/^if \(rejected && ownerCurrent\(\)\) \{\s*Alert\.alert\(\s*$/);
    // The account-wide count may still reload the Dashboard, never raise this alert; this edit's
    // own rejection always reloads (a command refused at enqueue may join a zero-count pass).
    expect(body).not.toMatch(/needsAttentionCount > 0\) \{\s*Alert\.alert/);
    expect(body).toContain(
      "if (result.deliveredCount > 0 || result.needsAttentionCount > 0 || rejected) {"
    );
    // Feedback belongs to the account that made the edit, rechecked after each wait.
    expect(body.match(/if \(!ownerCurrent\(\)\) return;/g)).toHaveLength(2);
  });
});
