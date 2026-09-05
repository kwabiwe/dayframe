import { DAYFRAME_API_BASE } from "./config";

/** Stable across deployments of one backend; never use a build number or PR URL. */
export function resolveBackendIdentity(apiBase: string, explicit?: string | null) {
  if (explicit?.trim()) {
    const identity = explicit.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/.test(identity))
      throw new Error("Invalid Dayframe backend identity.");
    return identity;
  }
  const origin = new URL(apiBase).origin;
  if (origin === "https://dayframe-staging.vercel.app") return "dayframe-staging";
  if (origin === "https://dayframe-web.vercel.app") return "dayframe-production";
  return null;
}

export const DAYFRAME_BACKEND_ID = resolveBackendIdentity(
  DAYFRAME_API_BASE,
  process.env.EXPO_PUBLIC_DAYFRAME_BACKEND_ID
);

export function requireBackendIdentity() {
  if (!DAYFRAME_BACKEND_ID)
    throw new Error(
      "Set EXPO_PUBLIC_DAYFRAME_BACKEND_ID for this backend before capturing Health data."
    );
  return DAYFRAME_BACKEND_ID;
}
