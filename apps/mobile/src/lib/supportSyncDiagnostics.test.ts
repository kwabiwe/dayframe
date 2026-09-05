import { expect, it } from "vitest";
import type { QueuedEvent } from "./api";
import { supportQueueDiagnostics } from "./supportSyncDiagnostics";
it("excludes coordinates, sample data, tokens, titles and raw error text from routine support output", () => {
  const queue = [
    {
      localId: "stable-id",
      source: "healthkit",
      type: "health_sleep",
      queuedAt: "queued",
      rawPayload: { latitude: 12, samples: [{ id: "private-sample" }], token: "private-token" },
      description: "private-title",
      lastError: "private-server-detail",
      occurredAt: new Date()
    }
  ] as unknown as QueuedEvent[];
  const exported = JSON.stringify(supportQueueDiagnostics(queue));
  expect(exported).toContain("stable-id");
  expect(exported).not.toMatch(/latitude|samples|private-|occurredAt/);
});
