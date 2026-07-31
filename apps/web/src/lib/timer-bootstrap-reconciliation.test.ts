import { describe, expect, it } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { reconcileTimerBootstrap } from "./timer-bootstrap-reconciliation";

describe("timer bootstrap reconciliation", () => {
  it("rejects an older version of the same active entry", () => {
    const current = bootstrap(entry({ description: "New draft", updatedAt: "2026-07-31T10:05:00.000Z" }));
    const incoming = bootstrap(entry({ description: "Old draft", updatedAt: "2026-07-31T10:04:00.000Z" }));

    const result = reconcileTimerBootstrap(current, incoming, "hydrate");
    expect(result.activeEntry?.description).toBe("New draft");
    expect(result.entries[0]?.description).toBe("New draft");
  });

  it("accepts a newer canonical version of the same active entry", () => {
    const current = bootstrap(entry({ updatedAt: "2026-07-31T10:04:00.000Z" }));
    const incoming = bootstrap(entry({ description: "External edit", updatedAt: "2026-07-31T10:05:00.000Z" }));
    expect(reconcileTimerBootstrap(current, incoming, "canonical").activeEntry?.description)
      .toBe("External edit");
  });

  it("prevents stale hydration from reviving an entry already stopped locally", () => {
    const completed = entry({ stoppedAt: "2026-07-31T10:06:00.000Z", updatedAt: "2026-07-31T10:06:00.000Z" });
    const current = bootstrap(null, [completed]);
    const stale = bootstrap(entry({ updatedAt: "2026-07-31T10:05:00.000Z" }));
    const result = reconcileTimerBootstrap(current, stale, "hydrate");
    expect(result.activeEntry).toBeNull();
    expect(result.entries[0]?.stoppedAt).toBe(completed.stoppedAt);
  });

  it("accepts a canonical stop or active-id switch", () => {
    const current = bootstrap(entry({ id: "one" }));
    expect(reconcileTimerBootstrap(current, bootstrap(null, []), "canonical").activeEntry).toBeNull();
    expect(reconcileTimerBootstrap(current, bootstrap(entry({ id: "two" })), "canonical").activeEntry?.id)
      .toBe("two");
  });
});

function bootstrap(activeEntry: TimeEntryRow | null, entries = activeEntry ? [activeEntry] : []) {
  return {
    activeEntry,
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    workspace: { id: "workspace", name: "Dayframe" }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}) {
  return {
    id: "entry",
    description: "Draft",
    startedAt: "2026-07-31T10:00:00.000Z",
    stoppedAt: null,
    updatedAt: "2026-07-31T10:04:00.000Z",
    durationSeconds: 240,
    categoryId: null,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
