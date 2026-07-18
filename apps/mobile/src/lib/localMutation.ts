export async function applyAfterSuccessfulMutation<Result>(
  mutation: () => Promise<Result>,
  apply: (result: Result) => void
) {
  const result = await mutation();
  apply(result);
  return result;
}
