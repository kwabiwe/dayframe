/** Diagnostic identity only; never include hosts, credentials or request data. */
export function serverBuildMetadata() {
  let backendId: string | null = null;
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    if (host.endsWith(".supabase.co")) backendId = host.split(".")[0];
  } catch { /* Local environments need not use Supabase. */ }
  return {
    sourceSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    backendId,
    environment: process.env.VERCEL_ENV === "production" ? "production" :
      process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV === "staging" ? "staging" : "local",
    syncContractVersion: 1
  };
}
