import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

export function canonicalHealthJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalHealthJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalHealthJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function healthFingerprint(value: unknown) {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, canonicalHealthJson(value));
}
