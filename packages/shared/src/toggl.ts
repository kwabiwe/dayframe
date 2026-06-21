import { z } from "zod";

export const TogglClientSchema = z.object({
  id: z.number(),
  wid: z.number().optional(),
  name: z.string()
});

export const TogglProjectSchema = z.object({
  id: z.number(),
  wid: z.number().optional(),
  cid: z.number().optional().nullable(),
  name: z.string(),
  color: z.string().optional().nullable(),
  billable: z.boolean().optional()
});

export const TogglTagSchema = z.object({
  id: z.number(),
  wid: z.number().optional(),
  name: z.string()
});

export const TogglTimeEntrySchema = z.object({
  id: z.number(),
  workspace_id: z.number().optional(),
  project_id: z.number().optional().nullable(),
  description: z.string().optional().nullable(),
  start: z.coerce.date(),
  stop: z.coerce.date().optional().nullable(),
  duration: z.number(),
  tags: z.array(z.string()).optional(),
  tag_ids: z.array(z.number()).optional(),
  billable: z.boolean().optional()
});

export type TogglClient = z.infer<typeof TogglClientSchema>;
export type TogglProject = z.infer<typeof TogglProjectSchema>;
export type TogglTag = z.infer<typeof TogglTagSchema>;
export type TogglTimeEntry = z.infer<typeof TogglTimeEntrySchema>;

export function togglExternalId(value: number | string) {
  return String(value);
}

export function mapTogglTimeEntry(entry: TogglTimeEntry) {
  const stoppedAt =
    entry.stop ?? (entry.duration > 0 ? new Date(entry.start.getTime() + entry.duration * 1000) : null);

  return {
    externalId: togglExternalId(entry.id),
    projectExternalId:
      typeof entry.project_id === "number" ? togglExternalId(entry.project_id) : null,
    description: entry.description?.trim() || null,
    startedAt: entry.start.toISOString(),
    stoppedAt: stoppedAt?.toISOString() ?? null,
    durationSeconds: entry.duration > 0 ? entry.duration : null,
    tags: entry.tags ?? [],
    tagExternalIds: entry.tag_ids?.map(togglExternalId) ?? [],
    billable: Boolean(entry.billable),
    rawPayload: entry
  };
}
