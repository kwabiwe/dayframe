import { afterEach, describe, expect, it } from "vitest";
import { serverBuildMetadata } from "./build-metadata";

const environmentKeys = [
  "VERCEL_ENV",
  "NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV",
  "NEXT_PUBLIC_SUPABASE_URL"
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;

afterEach(() => {
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

describe("server build metadata", () => {
  it("uses the mobile staging identity instead of the staging Supabase project ref", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV = "staging";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project-ref.supabase.co";

    expect(serverBuildMetadata()).toMatchObject({
      environment: "staging",
      backendId: "dayframe-staging"
    });
  });

  it("uses the mobile production identity regardless of a stale staging flag", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV = "staging";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production-project-ref.supabase.co";

    expect(serverBuildMetadata()).toMatchObject({
      environment: "production",
      backendId: "dayframe-production"
    });
  });

  it("retains the configured project-ref diagnostic for local development", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://local-project-ref.supabase.co";

    expect(serverBuildMetadata()).toMatchObject({
      environment: "local",
      backendId: "local-project-ref"
    });
  });
});
