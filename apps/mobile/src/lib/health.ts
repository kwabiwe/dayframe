export type HealthImportStatus = {
  provider: "healthkit" | "health_connect";
  status: "stubbed";
  notes: string;
};

export function getHealthImportStubs(): HealthImportStatus[] {
  return [
    {
      provider: "healthkit",
      status: "stubbed",
      notes: "iOS HealthKit sleep and workout import will create activity_events before time_entries."
    },
    {
      provider: "health_connect",
      status: "stubbed",
      notes: "Android Health Connect import follows the same event-first pipeline."
    }
  ];
}
