import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { REVIEW_PERFORMANCE_PROFILES, syntheticReviewBootstrap, syntheticReviewEvidence } from "./fixtures/review-performance";

// Local bundle generator only: no database/HTTP client, env loader or app endpoint.
// Explicit synthetic identities prevent accidental use as an account-data export.
const { values } = parseArgs({ options: {
  workspace: { type: "string" }, user: { type: "string" }, profile: { type: "string" }, remove: { type: "boolean" }
} });
const prefix = "dayframe-pr186-synthetic";
const testId = /^18600000-0000-4000-8000-\d{12}$/;
assert(values.workspace && testId.test(values.workspace), "--workspace must be an explicit synthetic 18600000 test UUID.");
assert(values.user && testId.test(values.user), "--user must be an explicit synthetic 18600000 test UUID.");
assert(!process.env.DATABASE_URL && !process.env.EXPO_PUBLIC_DAYFRAME_API_BASE, "Run without database/API configuration; this generator refuses all hosted targets.");
const profile = Number(values.profile);
assert(REVIEW_PERFORMANCE_PROFILES.some(size => size === profile), "--profile must be 2, 13, 25 or 50.");
const path = join(tmpdir(), `${prefix}-${values.workspace}-${values.user}-${profile}.json`);
if (values.remove) {
  const prior = JSON.parse(readFileSync(path, "utf8"));
  assert(prior.fixturePrefix === prefix && prior.workspaceId === values.workspace && prior.userId === values.user,
    "Refusing to remove a file not owned by this fixture generator.");
  unlinkSync(path);
  console.log(`Removed owned synthetic profile ${profile}.`);
} else {
  const data = syntheticReviewBootstrap(profile);
  data.workspace.id = values.workspace;
  data.user.id = values.user;
  writeFileSync(path, JSON.stringify({ fixturePrefix: prefix, workspaceId: values.workspace, userId: values.user,
    profile, bootstrap: data, locationEvidence: syntheticReviewEvidence(data) }), { flag: "wx", mode: 0o600 });
  console.log(path);
}
