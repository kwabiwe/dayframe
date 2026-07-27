export async function applyAfterSuccessfulMutation<Result>(
  mutation: () => Promise<Result>,
  apply: (result: Result) => void
) {
  const result = await mutation();
  apply(result);
  return result;
}

export async function applyOptimisticMutation<Snapshot, Result>(
  apply: () => Snapshot,
  mutation: () => Promise<Result>,
  rollback: (snapshot: Snapshot) => void
) {
  const snapshot = apply();
  try {
    return await mutation();
  } catch (error) {
    rollback(snapshot);
    throw error;
  }
}
