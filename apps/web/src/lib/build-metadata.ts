/** Diagnostic identity only; never include hosts, credentials or request data. */
export function serverBuildMetadata() {
  const environment = serverBuildEnvironment();
  return {
    sourceSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    backendId: backendIdentityFor(environment),
    environment,
    syncContractVersion: 1
  };
}

function serverBuildEnvironment() {
  return process.env.VERCEL_ENV === "production" ? "production" :
    process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV === "staging" ? "staging" : "local";
}

function backendIdentityFor(environment: "production" | "staging" | "local") {
  if (environment === "production") return "dayframe-production";
  if (environment === "staging") return "dayframe-staging";

  // Local/dev retains the prior project-ref diagnostic when configured. Mobile
  // still requires an explicit compatible local identity before it will read.
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}
