const DEFAULT_LOCAL_API_BASE = "http://localhost:3000";

export type ApiBaseOptions = {
  allowLocal?: boolean;
};

export function normalizeApiBase(value: string | undefined | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export function assertUsableApiBase(value: string, options: ApiBaseOptions = {}) {
  const normalized = normalizeApiBase(value);
  if (!normalized) throw new Error("Set EXPO_PUBLIC_DAYFRAME_API_BASE before starting Dayframe mobile.");

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("EXPO_PUBLIC_DAYFRAME_API_BASE must be a valid URL.");
  }

  const isLocal = isLocalHost(parsed.hostname);
  if (options.allowLocal) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("EXPO_PUBLIC_DAYFRAME_API_BASE must use http or https.");
    }
    return normalized;
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Hosted Dayframe mobile builds must use an https API URL.");
  }
  if (isLocal) {
    throw new Error("Hosted Dayframe mobile builds cannot use localhost or LAN API URLs.");
  }

  return normalized;
}

export function resolveApiBase(
  value = process.env.EXPO_PUBLIC_DAYFRAME_API_BASE,
  options: ApiBaseOptions = {}
) {
  const allowLocal = options.allowLocal ?? process.env.NODE_ENV !== "production";
  return assertUsableApiBase(value ?? (allowLocal ? DEFAULT_LOCAL_API_BASE : ""), { allowLocal });
}

export const DAYFRAME_API_BASE = resolveApiBase();

function isLocalHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return true;
  if (normalized.startsWith("192.168.")) return true;
  if (normalized.startsWith("10.")) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
}
