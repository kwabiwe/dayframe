import {
  getHealthAutoLogMappings,
  getHealthImportPreferences,
  reprocessExistingHealthReviewItems,
  setHealthAutoLogMapping
} from "./health";
import { captureConfirmAuthority, confirmAuthorityStillCurrent } from "./confirmAuthority";
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
  settle: async (saved, isCurrent, origin) => {
    // Reprocessing talks to the server, so it is pinned to the signed-in session itself, not only
    // the active-account record (which can lag a sign-out): the session is captured now, must
    // belong to the account that made the change, and is checked again before every request.
    const session = await captureConfirmAuthority();
    if (!session || !mobileAccountOwnersEqual(session.owner, origin) || !(await isCurrent())) return;
    const sessionCurrent = async () => (await isCurrent()) && (await confirmAuthorityStillCurrent(session));
    const controller = new AbortController();
    const stop = subscribeActiveMobileAccount(() => controller.abort());
    try {
      const preferences = await getHealthImportPreferences();
      if (controller.signal.aborted || !(await sessionCurrent())) return;
      await reprocessExistingHealthReviewItems(preferences, {
        force: true,
        mappings: saved,
        signal: controller.signal,
        beforeRequest: sessionCurrent,
      });
    } finally {
      stop();
    }
  }
});
