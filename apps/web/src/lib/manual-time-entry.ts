export class ManualTimeEntryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualTimeEntryValidationError";
  }
}

export function validateManualTimeEntryWindow({
  now,
  startedAt,
  stoppedAt
}: {
  now: Date;
  startedAt: string;
  stoppedAt: string;
}) {
  // Retain `now` in the public validator contract for callers that share the
  // timer-validation payload. Manual entries may intentionally be future-dated.
  void now;
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) {
    throw new ManualTimeEntryValidationError("startedAt must be a valid date.");
  }

  const finish = new Date(stoppedAt);
  if (Number.isNaN(finish.getTime())) {
    throw new ManualTimeEntryValidationError("stoppedAt must be a valid date.");
  }

  if (finish.getTime() <= start.getTime()) {
    throw new ManualTimeEntryValidationError("Finish time must be after the start time.");
  }
  if (finish.getTime() - start.getTime() > 24 * 60 * 60 * 1_000) {
    throw new ManualTimeEntryValidationError("Entries can be no longer than 24 hours.");
  }

  return {
    startedAt: start.toISOString(),
    stoppedAt: finish.toISOString()
  };
}
