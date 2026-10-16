// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockFormatProvider, ClockFormatSettings, setClockFormatPreference, useClockFormat } from "./ClockFormat";
import { formatTime } from "@/lib/format";
import {
  CLOCK_FORMAT_STORAGE_KEY,
  clockFormatCookie,
  clockFormatFromCookieHeader,
  readClockFormatPreference
} from "@/lib/clock-format";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evening = new Date(2026, 9, 16, 21, 30).toISOString();

function Clock() {
  return <time>{formatTime(evening, useClockFormat())}</time>;
}

function page(serverFormat: "12h" | "24h" | null) {
  return (
    <ClockFormatProvider serverFormat={serverFormat}>
      <Clock />
      <ClockFormatSettings />
    </ClockFormatProvider>
  );
}

async function hydrate(serverFormat: "12h" | "24h" | null) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(page(serverFormat));
  document.body.append(container);
  const errors: unknown[] = [];
  await act(async () => {
    hydrateRoot(container, page(serverFormat), { onRecoverableError: (error) => errors.push(error) });
  });
  return { container, errors };
}

function clearCookie() {
  document.cookie = "dayframe_clock=; Path=/; Max-Age=0";
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.localStorage.clear();
  clearCookie();
});

describe("12/24-hour setting on web (16 Oct 2026)", () => {
  it("draws the server's format first, then this browser's choice without a hydration mismatch", async () => {
    window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, "12h");
    expect(renderToString(page("24h"))).toContain("21:30");
    const { container, errors } = await hydrate("24h");
    expect(errors).toEqual([]);
    expect(container.querySelector("time")?.textContent).toBe("9:30 PM");
    // Mirrored for the next server render.
    expect(clockFormatFromCookieHeader(document.cookie)).toBe("12h");
  });

  it("follows the system by default and switches every time at once", async () => {
    window.localStorage.removeItem(CLOCK_FORMAT_STORAGE_KEY);
    const { container } = await hydrate(null);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".ui-segmented-control button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["System", "12-hour", "24-hour"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");

    await act(async () => buttons[1].click());
    expect(window.localStorage.getItem(CLOCK_FORMAT_STORAGE_KEY)).toBe("12h");
    expect(container.querySelector("time")?.textContent).toBe("9:30 PM");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");

    await act(async () => buttons[2].click());
    expect(container.querySelector("time")?.textContent).toBe("21:30");
    expect(clockFormatFromCookieHeader(document.cookie)).toBe("24h");

    await act(async () => setClockFormatPreference("system"));
    expect(window.localStorage.getItem(CLOCK_FORMAT_STORAGE_KEY)).toBeNull();
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("follows a change made in another tab", async () => {
    window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, "24h");
    const { container } = await hydrate("24h");
    await act(async () => {
      window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, "12h");
      window.dispatchEvent(new StorageEvent("storage", { key: CLOCK_FORMAT_STORAGE_KEY }));
    });
    expect(container.querySelector("time")?.textContent).toBe("9:30 PM");
  });

  it("keeps a choice for this page when the browser refuses storage (Codex r1 on #446)", async () => {
    window.localStorage.removeItem(CLOCK_FORMAT_STORAGE_KEY);
    const { container } = await hydrate("24h");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".ui-segmented-control button")];
    await act(async () => buttons[1].click());
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("time")?.textContent).toBe("9:30 PM");
    await act(async () => buttons[2].click());
    expect(container.querySelector("time")?.textContent).toBe("21:30");
    vi.restoreAllMocks();
    await act(async () => setClockFormatPreference("system"));
  });

  it("reads only known choices and cookie values", () => {
    expect(readClockFormatPreference({ getItem: () => "12h" })).toBe("12h");
    expect(readClockFormatPreference({ getItem: () => "12" })).toBe("system");
    expect(readClockFormatPreference({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
    expect(readClockFormatPreference(null)).toBe("system");
    expect(clockFormatFromCookieHeader("a=1; dayframe_clock=12h")).toBe("12h");
    expect(clockFormatFromCookieHeader("dayframe_clock=13h")).toBeNull();
    expect(clockFormatCookie("24h", true)).toBe("dayframe_clock=24h; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });
});
