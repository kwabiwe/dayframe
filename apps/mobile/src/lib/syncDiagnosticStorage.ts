import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { SQLiteStorage } from "expo-sqlite/kv-store";

// AppDelegate excludes Documents/SQLite from both computer and iCloud backups.
export const syncDiagnosticStorage = new SQLiteStorage("dayframe-sync-diagnostics.db");

export function hashSyncDiagnosticValue(value: string) {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
}
