export type TimerEntryDraft = {
  categoryId: string;
  description: string;
};

export function emptyTimerEntryDraft(): TimerEntryDraft {
  return {
    categoryId: "",
    description: ""
  };
}

export function shouldStartTimerFromEntrySubmit({
  hasActiveTimer,
  isBusy
}: {
  hasActiveTimer: boolean;
  isBusy: boolean;
}) {
  return !hasActiveTimer && !isBusy;
}
