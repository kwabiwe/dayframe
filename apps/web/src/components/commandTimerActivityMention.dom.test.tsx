// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import type { TimerDraft } from "@/lib/timer-runtime";

// The command timer's "@" Activities list (owner feedback, 12 Oct 2026): "@" + letters offers
// the activities like "#" offers tags; choosing one sets the block's activity and the "@query"
// leaves the description. Recording, it switches the running block's activity in place.

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

type Spies = ReturnType<typeof spies>;

function spies() {
  return {
    createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
    setTimerDraft: vi.fn(),
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true })
  };
}

/** The bar with a real draft, as the shell runtime keeps it. */
const ACTIVITIES = [
  { id: "focus", name: "Focus", color: "mint", isPinned: true },
  { id: "write", name: "Writing", color: "blue", isPinned: true }
];

function renderBar({ activeEntry = null, categories = ACTIVITIES, description = "" }: {
  activeEntry?: TimeEntryRow | null;
  categories?: typeof ACTIVITIES;
  description?: string;
} = {}) {
  const calls = spies();
  const data = {
    activeEntry,
    categories,
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
    tags: [{ id: "deep-work", name: "Deep work", normalizedName: "deep work", usageCount: 2 }],
    taskSuggestions: [{
      key: "write-proposal",
      description: "Write proposal",
      categoryId: "write",
      categoryName: "Writing",
      categoryColor: "blue",
      tagNames: ["Deep work"]
    }]
  } as unknown as BootstrapData;

  function Harness() {
    const [timerDraft, setDraft] = useState<TimerDraft>({
      categoryId: activeEntry?.categoryId ?? "",
      description: description || activeEntry?.description || "",
      tagNames: []
    });
    runtime = {
      clearTimerError: vi.fn(),
      closeManualEntry: vi.fn(),
      createCategory: vi.fn().mockResolvedValue({ ok: true }),
      createManualEntry: calls.createManualEntry,
      deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
      isManualEntryOpen: false,
      isTimerBusy: false,
      openManualEntry: vi.fn(),
      setTimerDraft: (next: TimerDraft | ((current: TimerDraft) => TimerDraft)) => {
        calls.setTimerDraft(next);
        setDraft(next);
      },
      shellData: data,
      startTimer: calls.startTimer,
      stopTimer: calls.stopTimer,
      timerDraft,
      timerError: null,
      updateActiveDetails: calls.updateActiveDetails,
      updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
    };
    return <PersistentTimerBar />;
  }

  render(<Harness />);
  return { calls, input: screen.getByLabelText("Description") as HTMLInputElement };
}

function running(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "running-entry",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "focus",
    categoryName: "Focus",
    categoryColor: "mint",
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Fix bug",
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    stoppedAt: null,
    updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    durationSeconds: 1_200,
    tagNames: [],
    tags: [],
    ...overrides
  };
}

function activities() {
  return screen.getByRole("listbox", { name: "Activities" });
}

function optionNames(list: HTMLElement) {
  return within(list).queryAllByRole("option").map((option) => option.textContent);
}

async function typeInto(input: HTMLInputElement, text: string) {
  const user = userEvent.setup();
  await user.click(input);
  await user.keyboard("{End}");
  await user.type(input, text, { skipClick: true });
  return user;
}

describe("@ opens the Activities list", () => {
  it("opens on @, filters as you type and names the list for assistive technology", async () => {
    const { input } = renderBar();
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();

    await typeInto(input, "Plan @");
    expect(optionNames(activities())).toEqual(["Focus", "Writing"]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(activities().id);
    // The description's Suggestions step aside while the Activities list is open.
    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();

    await userEvent.type(input, "wr", { skipClick: true });
    expect(optionNames(activities())).toEqual(["Writing"]);

    await userEvent.type(input, "zz", { skipClick: true });
    expect(optionNames(activities())).toEqual([]);
    expect(activities().textContent).toContain("No activity called “wrzz”");
  });

  it("walks the list with ↑/↓ through aria-activedescendant, focus staying in the field", async () => {
    const { input } = renderBar();
    const user = await typeInto(input, "@");
    const [focus, writing] = within(activities()).getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(focus.id);
    expect(focus.getAttribute("aria-selected")).toBe("true");
    expect(focus.className).toContain("is-highlighted");

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(writing.id);
    expect(writing.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(focus.id);
    await user.keyboard("{ArrowUp}");
    expect(input.getAttribute("aria-activedescendant")).toBe(writing.id);
    expect(document.activeElement).toBe(input);
  });

  it("Tab picks the highlighted activity without starting, and the @query leaves the text", async () => {
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan launch @wri");
    await user.keyboard("{Tab}");

    expect(input.value).toBe("Plan launch");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    expect(calls.startTimer).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("a click or tap picks an activity without starting", async () => {
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan @");
    await user.click(within(activities()).getByRole("option", { name: "Writing" }));

    expect(input.value).toBe("Plan");
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("Escape cancels only that @…: the token leaves, the rest of the text and the activity stay", async () => {
    const { input } = renderBar();
    const user = await typeInto(input, "Plan @wri");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.value).toBe("Plan");
    expect(screen.getByRole("button", { name: "Activity: No activity" })).not.toBeNull();
  });

  it("puts the exact name first, as the parser does, even after a longer pinned name", async () => {
    const { calls, input } = renderBar({
      categories: [
        { id: "focused", name: "Focused work", color: "violet", isPinned: true },
        { id: "focus", name: "Focus", color: "mint", isPinned: true }
      ]
    });
    const user = await typeInto(input, "@focus");
    expect(optionNames(activities())).toEqual(["Focus", "Focused work"]);
    await user.keyboard("{Enter}");
    expect(calls.startTimer).toHaveBeenCalledWith({ categoryId: "focus", description: "", tagNames: [] });
  });

  it("does not start pinned quick starts while typing digits or with the list open", async () => {
    const { calls, input } = renderBar();
    await typeInto(input, "@1");
    await userEvent.type(input, "{Backspace}", { skipClick: true });
    await userEvent.keyboard("2");
    expect(calls.startTimer).not.toHaveBeenCalled();
  });
});

describe("@activity + Enter", () => {
  it("idle: Enter on the list starts the block with that activity, as @activity + Enter always has", async () => {
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan launch @wri");
    await user.keyboard("{Enter}");

    expect(calls.startTimer).toHaveBeenCalledTimes(1);
    expect(calls.startTimer).toHaveBeenCalledWith({ categoryId: "write", description: "Plan launch", tagNames: [] });
    expect(calls.createManualEntry).not.toHaveBeenCalled();
  });

  it("idle: the activity picked from the list wins over an earlier @activity", async () => {
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan @foc @wri");
    await user.keyboard("{Enter}");
    expect(calls.startTimer).toHaveBeenCalledWith({ categoryId: "write", description: "Plan", tagNames: [] });
  });

  it("idle: the picked activity wins and a trailing duration is still parsed", async () => {
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan @foc 45m @wri");
    await act(async () => { await user.keyboard("{Enter}"); });
    expect(calls.createManualEntry).toHaveBeenCalledTimes(1);
    const entry = calls.createManualEntry.mock.calls[0][0];
    expect(entry).toMatchObject({ categoryId: "write", description: "Plan" });
    expect(Date.parse(entry.stoppedAt) - Date.parse(entry.startedAt)).toBe(45 * 60 * 1000);
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("idle: a trailing duration still logs a finished block ending now", async () => {
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan @foc 45m");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await act(async () => { await user.keyboard("{Enter}"); });

    expect(calls.createManualEntry).toHaveBeenCalledTimes(1);
    const entry = calls.createManualEntry.mock.calls[0][0];
    expect(entry).toMatchObject({ categoryId: "focus", description: "Plan" });
    expect(Date.parse(entry.stoppedAt) - Date.parse(entry.startedAt)).toBe(45 * 60 * 1000);
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("recording: Enter switches the running block's activity in place, without stopping it", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    const user = await typeInto(input, " @wri");
    await user.keyboard("{Enter}");

    expect(input.value).toBe("Fix bug");
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    // The activity block's own path: one debounced update of the running block.
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith({
      categoryId: "write",
      description: "Fix bug",
      tagNames: []
    }), { timeout: 2_000 });
    expectRunningBlockKept(calls);
  });

  it("recording: a typed @activity + Enter with the list closed still switches", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    const user = await typeInto(input, " @writing");
    // The caret leaves the word, so the list closes with the text kept.
    await user.keyboard("{Home}");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await user.keyboard("{Enter}");

    expect(input.value).toBe("Fix bug");
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith({
      categoryId: "write",
      description: "Fix bug",
      tagNames: []
    }), { timeout: 2_000 });
    expectRunningBlockKept(calls);
  });

  it("recording: choosing from the list switches too", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    const user = await typeInto(input, " @");
    await user.click(within(activities()).getByRole("option", { name: "Writing" }));
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "write", description: "Fix bug" })
    ), { timeout: 2_000 });
    expectRunningBlockKept(calls);
  });
});

function expectRunningBlockKept(calls: Spies) {
  expect(calls.startTimer).not.toHaveBeenCalled();
  expect(calls.stopTimer).not.toHaveBeenCalled();
  expect(calls.createManualEntry).not.toHaveBeenCalled();
  // A half-typed "@wri" is never saved to the running block.
  for (const [draft] of calls.updateActiveDetails.mock.calls) expect((draft as TimerDraft).description).not.toContain("@");
}

describe("an unfinished @ is never saved to the running block", () => {
  const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  it("Escape removes the @… and nothing is saved", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    const user = await typeInto(input, " @wri");
    await user.keyboard("{Escape}");
    expect(input.value).toBe("Fix bug");
    await wait(900);
    expect(calls.updateActiveDetails).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull();
  });

  it("a trailing space closes the list, but autosave leaves the @… out", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    await typeInto(input, " more @wri ");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalled(), { timeout: 2_000 });
    expect(calls.updateActiveDetails).toHaveBeenLastCalledWith({ categoryId: "focus", description: "Fix bug more", tagNames: [] });
    expectRunningBlockKept(calls);
  });

  it("leaving the field drops the @… from the text without changing the activity", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    const user = await typeInto(input, " @wri");
    await user.click(document.body);
    expect(input.value).toBe("Fix bug");
    await wait(900);
    expect(calls.updateActiveDetails).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull();
  });

  it("Stop saves the details without the @…", async () => {
    const { calls, input } = renderBar({ activeEntry: running() });
    const user = await typeInto(input, " @wri");
    await user.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(calls.stopTimer).toHaveBeenCalledTimes(1);
    expect(calls.stopTimer).toHaveBeenCalledWith({ description: "Fix bug" });
  });

  it("keeps an @word the running block already had", async () => {
    const { calls, input } = renderBar({ activeEntry: running({ description: "Call @mum" }) });
    await typeInto(input, " today");
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Call @mum today" })
    ), { timeout: 2_000 });
  });
});

describe("# Tags stay as they were", () => {
  it("opens the Tags list on #, and Enter adds the tag and removes the #query", async () => {
    const { input } = renderBar();
    const user = await typeInto(input, "Plan #dee");
    const tags = screen.getByRole("listbox", { name: "Tags" });
    const option = within(tags).getByRole("option", { name: "Existing tag, Deep work" });
    expect(input.getAttribute("aria-controls")).toBe(tags.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    await user.keyboard("{Enter}");
    expect(input.value).toBe("Plan");
    expect(screen.getByRole("button", { name: "Remove tag Deep work" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
  });
});

describe("one floating list style", () => {
  it("draws Suggestions, Tags and Activities as the same surface, heading and rows", async () => {
    const { input } = renderBar();
    const user = userEvent.setup();
    const expectOneStyle = (listbox: HTMLElement, heading: string) => {
      const surface = listbox.closest<HTMLElement>(".df-flist")!;
      expect(surface.className).toContain("ui-floating-surface df-flist");
      const head = surface.querySelector(".df-flist-head > span");
      expect(head?.textContent).toBe(heading);
      expect(head?.getAttribute("aria-hidden")).toBe("true");
      // The Close control is the phone sheet's; on wider screens it is not shown.
      expect((surface.querySelector(".df-flist-close") as HTMLButtonElement).hidden).toBe(true);
      const rows = surface.querySelectorAll('[role="option"]');
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.className).toContain("df-flist-row");
    };

    await user.click(input);
    const suggestions = screen.getByRole("listbox", { name: "Suggestions" });
    expectOneStyle(suggestions, "Suggestions");
    // Rows keep their own content: the suggestion's play arrow, the activity's block and icon.
    expect(suggestions.querySelector('svg[data-glyph="play"]')).not.toBeNull();

    await user.type(input, "#", { skipClick: true });
    expectOneStyle(screen.getByRole("listbox", { name: "Tags" }), "Tags");

    await user.keyboard("{Backspace}@");
    expectOneStyle(activities(), "Activities");
    expect(activities().querySelector(".df-flist-block.df-block svg")).not.toBeNull();
  });
});

describe("the activity block's empty state", () => {
  it("shows the neutral activity glyph for No activity, never the tag glyph, and the activity's icon once chosen", async () => {
    const { input } = renderBar();
    const empty = screen.getByRole("button", { name: "Activity: No activity" });
    expect(empty.querySelector("svg")?.getAttribute("data-glyph")).toBe("circle-dot");
    expect(empty.querySelector('svg[data-glyph="tag"]')).toBeNull();
    // The only tag glyph in the bar is the description's own tag control.
    expect(screen.getByRole("button", { name: "Add or filter tags" })).not.toBeNull();

    const user = await typeInto(input, "@wri");
    await user.keyboard("{Tab}");
    const chosen = screen.getByRole("button", { name: "Activity: Writing" });
    expect(chosen.querySelector("svg")?.getAttribute("data-glyph")).toBe("pen-line");
  });
});

describe("on phones the lists are sheets", () => {
  function phone() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 560px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
  }

  it("draws the Activities list as a full-width sheet bounded by the visual viewport, with a 44 px Close", async () => {
    phone();
    const { calls, input } = renderBar();
    const user = await typeInto(input, "Plan @wri");
    const surface = activities().closest<HTMLElement>(".df-flist")!;
    expect(surface.className).toContain("is-sheet");
    expect(surface.style.left).toBe("12px");
    expect(surface.style.right).toBe("12px");
    expect(surface.style.width).toBe("auto");
    expect(surface.style.maxHeight).toMatch(/px$/);
    const close = within(surface).getByRole("button", { name: "Close activities" });
    expect((close as HTMLButtonElement).hidden).toBe(false);

    // Close cancels only this @…, like Escape, and the field keeps focus.
    await user.click(close);
    expect(input.value).toBe("Plan");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("gives Suggestions and Tags the same sheet and Close", async () => {
    phone();
    const { input } = renderBar();
    const user = userEvent.setup();
    await user.click(input);
    const suggestions = screen.getByRole("listbox", { name: "Suggestions" }).closest<HTMLElement>(".df-flist")!;
    expect(suggestions.className).toContain("is-sheet");
    await user.click(within(suggestions).getByRole("button", { name: "Close suggestions" }));
    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();

    await user.type(input, "#", { skipClick: true });
    const tags = screen.getByRole("listbox", { name: "Tags" }).closest<HTMLElement>(".df-flist")!;
    expect(tags.className).toContain("is-sheet");
    await user.click(within(tags).getByRole("button", { name: "Close tags" }));
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
  });
});
