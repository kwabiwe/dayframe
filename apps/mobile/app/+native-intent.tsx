import { reviewLinkRedirect } from "../src/lib/reviewLinks";

/**
 * Links iOS opens the app with (location v4 step 15): the Review screen is gone, so an old `dayframe://review…`
 * link opens the Calendar tab with its check request, and Calendar › List opens that "?" (or today's first). Every
 * other link is left as it came.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return reviewLinkRedirect(path) ?? path;
  } catch {
    return path;
  }
}
