import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("registers the daily jobs in the Vercel project root", () => {
  const config = JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8"));

  expect(config.crons).toEqual([
    { path: "/api/cron/location-retention", schedule: "17 3 * * *" },
    { path: "/api/cron/live-activity-retry", schedule: "47 3 * * *" }
  ]);
});
