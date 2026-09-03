import { describe, expect, it, vi } from "vitest";
import {
  configureLocationTransaction,
  LOCATION_INGEST_LOCK_TIMEOUT_MS,
  LOCATION_INGEST_STATEMENT_TIMEOUT_MS
} from "./location-ingest-service";

describe("Location ingest transaction budgets", () => {
  it("bounds account-lock and statement waits below the request budget", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await configureLocationTransaction({ query } as never);

    expect(LOCATION_INGEST_LOCK_TIMEOUT_MS).toBeLessThan(LOCATION_INGEST_STATEMENT_TIMEOUT_MS);
    expect(LOCATION_INGEST_STATEMENT_TIMEOUT_MS).toBeLessThan(10_000);
    expect(query).toHaveBeenNthCalledWith(
      1,
      "select set_config('lock_timeout', $1, true)",
      ["1500ms"]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "select set_config('statement_timeout', $1, true)",
      ["8000ms"]
    );
  });
});
