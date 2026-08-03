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
  if (start.getTime() > now.getTime()) {
    throw new ManualTimeEntryValidationError("Start time cannot be in the future.");
  }
  if (finish.getTime() > now.getTime()) {
    throw new ManualTimeEntryValidationError("Finish time cannot be in the future.");
  }

  return {
    startedAt: start.toISOString(),
    stoppedAt: finish.toISOString()
  };
}
