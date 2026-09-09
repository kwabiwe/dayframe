import {
  ReportSummarySchema,
  type ReportSummary,
  type ReportSummaryRequest,
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import type { MobileAccountOwner } from "./mobileAccount";
import {
  readOwnedAuthenticatedSessionSnapshot,
  isAuthenticatedSessionSnapshotCurrent,
} from "./secure-session";
import {
  mobileJsonRequest,
  StaleMobileSessionResponseError,
} from "./mobile-network";

export async function fetchReportSummary(
  input: ReportSummaryRequest,
  owner: MobileAccountOwner,
  signal: AbortSignal,
): Promise<ReportSummary> {
  const read = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (read.status !== "authenticated")
    throw new StaleMobileSessionResponseError();
  const { body } = await mobileJsonRequest(
    `${DAYFRAME_API_BASE}/api/reports/summary`,
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${read.snapshot.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
    {
      timeoutMilliseconds: 15_000,
      isCurrent: () => isAuthenticatedSessionSnapshotCurrent(read.snapshot),
      validate: (value, response) => {
        if (!response.ok) throw new Error("Unable to load report range");
        const summary = ReportSummarySchema.parse(value);
        if (
          summary.range.start !== input.start ||
          summary.range.end !== input.end ||
          summary.buckets.length !== input.buckets.length ||
          summary.buckets.some((b, i) => b.key !== input.buckets[i].key)
        )
          throw new Error("Unexpected report range");
        return summary;
      },
      timeoutMessage: "Connect to load this report range",
    },
  );
  return body;
}

/** One mounted account owner, eight exact ranges, no durable storage. */
export class ReportRangeCache {
  private values = new Map<string, ReportSummary>();
  get(key: string) {
    return this.values.get(key);
  }
  put(key: string, value: ReportSummary) {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > 8)
      this.values.delete(this.values.keys().next().value!);
  }
  clear() {
    this.values.clear();
  }
}
