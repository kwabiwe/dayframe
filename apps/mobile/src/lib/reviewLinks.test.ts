import { describe, expect, it } from "vitest";
import { reviewLinkCheck, reviewLinkRedirect } from "./reviewLinks";

const ID = "30000000-0000-4000-8000-000000000001";

describe("old Review links open Calendar › List (step 15)", () => {
  it("reads the \"?\" a link names, by path or by any of its old parameters", () => {
    expect(reviewLinkCheck(`dayframe://review/${ID}`)).toBe(ID);
    expect(reviewLinkCheck(`dayframe://review?focusReviewId=${ID}`)).toBe(ID);
    expect(reviewLinkCheck(`dayframe://review?check=${ID}`)).toBe(ID);
    expect(reviewLinkCheck(`dayframe://review?item=${ID}`)).toBe(ID);
    expect(reviewLinkCheck(`dayframe://review?id=${ID}`)).toBe(ID);
    expect(reviewLinkCheck(`/review/${ID}`)).toBe(ID);
    expect(reviewLinkCheck(`exp+dayframe://192.168.1.2:8081/--/review/${ID}`)).toBe(ID);
    expect(reviewLinkCheck("dayframe://review?check=first")).toBe("first");
  });

  it("opens today's first \"?\" for a Review link that names none, or names one it can't read", () => {
    expect(reviewLinkCheck("dayframe://review")).toBe("first");
    expect(reviewLinkCheck("/review")).toBe("first");
    expect(reviewLinkCheck(`dayframe://review?focusEntryId=${ID}`)).toBe("first");
    expect(reviewLinkCheck("dayframe://review/<script>")).toBe("first");
    expect(reviewLinkCheck("dayframe://review/%E0%A4%A")).toBe("first");
  });

  it("leaves every other link alone", () => {
    expect(reviewLinkCheck("dayframe://action/stop")).toBeNull();
    expect(reviewLinkCheck("dayframe://settings?section=sync")).toBeNull();
    expect(reviewLinkCheck("dayframe://reviews")).toBeNull();
    expect(reviewLinkCheck("/")).toBeNull();
    expect(reviewLinkRedirect("dayframe://action/start?category=Focus")).toBeNull();
  });

  it("redirects to the Calendar tab with the check request", () => {
    expect(reviewLinkRedirect(`dayframe://review/${ID}`)).toBe(`/calendar?check=${ID}`);
    expect(reviewLinkRedirect("dayframe://review")).toBe("/calendar?check=first");
  });
});
