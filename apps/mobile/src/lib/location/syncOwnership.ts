export type OwnedLocationPreparation<Batch> =
  | { status: "ready"; batch: Batch }
  | { status: "empty" }
  | { status: "session_changed" };

export async function prepareOwnedLocationBatch<Batch>(input: {
  isCurrent: () => boolean | Promise<boolean>;
  prepare: () => Promise<Batch | null>;
}): Promise<OwnedLocationPreparation<Batch>> {
  if (!await input.isCurrent()) return { status: "session_changed" };
  const batch = await input.prepare();
  if (!await input.isCurrent()) return { status: "session_changed" };
  return batch ? { status: "ready", batch } : { status: "empty" };
}

export async function executeOwnedLocationRequest<Response>(input: {
  isCurrent: () => boolean | Promise<boolean>;
  request: () => Promise<Response>;
}): Promise<
  | { status: "completed"; response: Response }
  | { status: "session_changed" }
> {
  if (!await input.isCurrent()) return { status: "session_changed" };
  const response = await input.request();
  if (!await input.isCurrent()) return { status: "session_changed" };
  return { status: "completed", response };
}
