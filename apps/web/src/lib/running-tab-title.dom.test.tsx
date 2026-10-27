// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { runningTabTitle, useRunningTabTitle } from "./running-tab-title";

afterEach(cleanup);

describe("the running time in the tab title (#261)", () => {
  it("is the running time only, then the page's own title once the timer stops", () => {
    document.title = "Dayframe";
    const { rerender, unmount } = renderHook(({ title }: { title: string | null }) => useRunningTabTitle(title), {
      initialProps: { title: runningTabTitle(23 * 60 + 15) as string | null }
    });
    expect(document.title).toBe("0:23:15 · Dayframe");
    rerender({ title: runningTabTitle(23 * 60 + 16) });
    expect(document.title).toBe("0:23:16 · Dayframe");
    rerender({ title: null });
    expect(document.title).toBe("Dayframe");
    rerender({ title: runningTabTitle(3600) });
    expect(document.title).toBe("1:00:00 · Dayframe");
    unmount();
    expect(document.title).toBe("Dayframe");
  });

  it("keeps a title the page set while recording, and leaves a newer title alone on stop and unmount (Codex r1 on #587)", () => {
    document.title = "Dayframe";
    const { rerender, unmount } = renderHook(({ title }: { title: string | null }) => useRunningTabTitle(title), {
      initialProps: { title: runningTabTitle(5) as string | null }
    });
    // A client navigation sets the page's title between two ticks: the next tick takes the tab back,
    // and stopping restores the newer page title.
    document.title = "Reports · Dayframe";
    rerender({ title: runningTabTitle(6) });
    expect(document.title).toBe("0:00:06 · Dayframe");
    rerender({ title: null });
    expect(document.title).toBe("Reports · Dayframe");
    // Recording again, then the page changes the title and the bar unmounts before the next tick.
    rerender({ title: runningTabTitle(7) });
    document.title = "Library · Dayframe";
    unmount();
    expect(document.title).toBe("Library · Dayframe");
  });
});
