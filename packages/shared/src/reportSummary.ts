import { z } from "zod";

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const bucket = z
  .object({ key: z.string().min(1).max(80), start: instant, end: instant })
  .strict();

// 366 local calendar days may span one additional hour across a clock rollback.
export const REPORT_MAX_RANGE_MS = (366 * 24 + 1) * 3_600_000;
export const ReportSummaryRequestSchema = z
  .object({
    start: instant,
    end: instant,
    buckets: z.array(bucket).min(1).max(366),
  })
  .strict()
  .superRefine((value, context) => {
    const start = Date.parse(value.start);
    const end = Date.parse(value.end);
    let cursor = start;
    const keys = new Set<string>();
    const invalid =
      end <= start ||
      end - start > REPORT_MAX_RANGE_MS ||
      value.buckets.some((item) => {
        const left = Date.parse(item.start);
        const right = Date.parse(item.end);
        const bad =
          left !== cursor || right <= left || right > end || keys.has(item.key);
        cursor = right;
        keys.add(item.key);
        return bad;
      }) ||
      cursor !== end;
    if (invalid)
      context.addIssue({
        code: "custom",
        message:
          "Provide a bounded range partitioned by unique ordered contiguous buckets.",
      });
  });

const seconds = z.number().finite().nonnegative();
const allocation = z.object({ key: z.string(), seconds });
export const ReportSummarySchema = z.object({
  capturedNow: instant,
  range: z.object({ start: instant, end: instant }),
  totalSeconds: seconds,
  categories: z.array(
    z.object({
      key: z.string(),
      categoryId: z.string().nullable(),
      name: z.string(),
      color: z.string().nullable(),
      seconds,
    }),
  ),
  buckets: z.array(
    z.object({ key: z.string(), seconds, byCategory: z.array(allocation) }),
  ),
  // Only the current timer's bounded contribution, never historical entry payloads.
  active: z
    .object({
      id: z.string(),
      categoryId: z.string().nullable(),
      startedAt: instant,
      buckets: z.array(z.object({ key: z.string(), seconds })),
    })
    .nullable(),
});
export type ReportSummaryRequest = z.infer<typeof ReportSummaryRequestSchema>;
export type ReportSummary = z.infer<typeof ReportSummarySchema>;
