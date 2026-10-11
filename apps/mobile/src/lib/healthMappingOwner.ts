import {
  getHealthAutoLogMappings,
  getHealthImportPreferences,
  reprocessExistingHealthReviewItems,
  setHealthAutoLogMapping
} from "./health";
import { createHealthMappingWriter } from "./healthMappingWriter";
import { mobileAccountOwnersEqual, readActiveMobileAccount, subscribeActiveMobileAccount } from "./mobileAccount";

/**
 * The app's one Apple Health mapping writer (UIA-085; see healthMappingWriter): process-wide so
 * Settings screens opened one after another share its queues, pinned to the signed-in account that
 * made each change (a token refresh keeps it; a sign-out or account switch drops it), and
 * reprocessing Health Review items once a type's writes land.
 */
export const healthMappingWriter = createHealthMappingWriter({
  readSaved: getHealthAutoLogMappings,
  write: setHealthAutoLogMapping,
  capture: readActiveMobileAccount,
  stillCurrent: async (owner) => mobileAccountOwnersEqual(await readActiveMobileAccount(), owner),
  onAccountChange: subscribeActiveMobileAccount,
  settle: async (saved) => {
    await reprocessExistingHealthReviewItems(await getHealthImportPreferences(), { force: true, mappings: saved });
  }
});
