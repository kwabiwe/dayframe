/**
 * Old Review links on the iPhone (location v4 step 15, list-first): the Review screen and its deck are gone, so a
 * `dayframe://review…` link (an older shortcut, a saved link, a notification from an older build) opens Calendar ›
 * List at the "?" it names, as the web's `/review` redirect does since #613. The link is read here; the Dashboard
 * opens the "?" through the same check request the badge, the chips and the reminder use (#610).
 */

/** What an old Review link asks for: one "?" by its id, or today's first ("first") when it names none. */
export type ReviewLinkCheck = string;

const ID_PARAMS = ["check", "item", "id", "reviewItemId", "focusReviewId", "review"] as const;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The "?" an old Review link names, `"first"` for a Review link that names none, or null for any other link.
 * Takes what iOS hands the app: `dayframe://review/<id>`, `dayframe://review?focusReviewId=<id>`, `/review/<id>`,
 * an Expo development link (`exp+dayframe://…/--/review…`) and so on.
 */
export function reviewLinkCheck(url: string): ReviewLinkCheck | null {
  let rest = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);
  const [pathPart, query = ""] = rest.split("#")[0].split("?");
  // The Expo development prefix (`host:port/--/review`) and the custom scheme's host (`review/<id>`).
  const segments = pathPart.split("/").filter(Boolean);
  const dev = segments.indexOf("--");
  const route = dev >= 0 ? segments.slice(dev + 1) : segments;
  if (route[0]?.toLowerCase() !== "review") return null;
  const params = new URLSearchParams(query);
  const named = [route[1] ? safeDecode(route[1]) : null, ...ID_PARAMS.map((key) => params.get(key))]
    .find((value): value is string => Boolean(value && (value === "first" || SAFE_ID.test(value))));
  return named ?? "first";
}

/** The Calendar tab's own link for an old Review link, or null when the link is not one. */
export function reviewLinkRedirect(url: string) {
  const check = reviewLinkCheck(url);
  return check ? `/calendar?check=${encodeURIComponent(check)}` : null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
