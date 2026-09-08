import Constants from "expo-constants";
import { DAYFRAME_API_BASE } from "./config";

/** Missing build attestations remain null; a configured version is not source proof. */
export function mobileBuildDiagnostics() {
  const runtime = Constants.expoConfig?.runtimeVersion;
  return {
    nativeBuildNumber: Constants.platform?.ios?.buildNumber ?? null,
    configuredAppVersion: Constants.expoConfig?.version ?? null,
    configuredBundleIdentifier: Constants.expoConfig?.ios?.bundleIdentifier ?? null,
    apiBase: DAYFRAME_API_BASE,
    releaseChannel: process.env.EXPO_PUBLIC_DAYFRAME_RELEASE_CHANNEL ?? null,
    sourceSha: process.env.EXPO_PUBLIC_DAYFRAME_SOURCE_SHA ?? null,
    runtimeVersion: typeof runtime === "string" ? runtime : null,
    updateManifestId: Constants.manifest2?.id ?? null,
    activeJsUpdateId: null,
    updatesConfigured: Constants.expoConfig?.updates?.enabled ?? null
  };
}
