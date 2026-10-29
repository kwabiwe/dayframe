// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ReviewRedirect } = await import("./ReviewRedirect");

// Codex r1 on #613: an old /review link's day comes from the browser's own zone, whatever the zone cookie says.
// Los Angeles: an item starting 26 Oct 00:30 UTC is on the 25th there. Synthetic ids only.
const ID = "00000000-0000-4000-8000-0000000000a1";
const STARTED = "2026-10-26T00:30:00.000Z";
const LA = "America/Los_Angeles";
const realDateTimeFormat = Intl.DateTimeFormat;

function browserZone(zone: string) {
  // A constructible stand-in: the browser's default zone is `zone`; an explicit zone still wins.
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new realDateTimeFormat(locales, { timeZone: zone, ...options });
  } as unknown as typeof Intl.DateTimeFormat);
}

function clearCookie() {
  document.cookie = "dayframe_tz=; Path=/; Max-Age=0";
}

beforeEach(() => {
  router.replace.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
  browserZone(LA);
  clearCookie();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearCookie();
});

describe("old /review links open the List on the browser's day (Codex r1 on #613)", () => {
  it("uses the browser's zone when the zone cookie is missing, and writes the cookie", () => {
    render(<ReviewRedirect itemId={ID} startedAt={STARTED} />);
    expect(router.replace).toHaveBeenCalledWith(`/timeline?view=list&scope=day&date=2026-10-25&check=${ID}`);
    expect(document.cookie).toContain(`dayframe_tz=${LA}`);
  });

  it("uses the browser's zone over a stale cookie, and updates the cookie", () => {
    document.cookie = "dayframe_tz=UTC; Path=/";
    render(<ReviewRedirect itemId={ID} startedAt={STARTED} />);
    expect(router.replace).toHaveBeenCalledWith(`/timeline?view=list&scope=day&date=2026-10-25&check=${ID}`);
    expect(document.cookie).toContain(`dayframe_tz=${LA}`);
  });

  it("opens today's first \"?\" on the browser's today", () => {
    document.cookie = "dayframe_tz=UTC; Path=/";
    render(<ReviewRedirect itemId="first" />);
    expect(router.replace).toHaveBeenCalledWith("/timeline?view=list&scope=day&date=2026-10-25&check=first");
  });

  it("sends an older palette's #review-<id> through the server to find its item", () => {
    window.location.hash = `#review-${ID}`;
    render(<ReviewRedirect itemId={null} />);
    expect(router.replace).toHaveBeenCalledWith(`/review?check=${ID}`);
  });
});
