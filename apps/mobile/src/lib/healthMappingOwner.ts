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
  settle: async (saved, isCurrent) => {
    const preferences = await getHealthImportPreferences();
    // Checked again after every wait, and an account change aborts the requests still running,
    // so one account's mappings are never reprocessed with another account's session.
    const controller = new AbortController();
    const stop = subscribeActiveMobileAccount(() => controller.abort());
    try {
      if (!(await isCurrent()) || controller.signal.aborted) return;
      await reprocessExistingHealthReviewItems(preferences, { force: true, mappings: saved, signal: controller.signal });
    } finally {
      stop();
    }
  }
});
