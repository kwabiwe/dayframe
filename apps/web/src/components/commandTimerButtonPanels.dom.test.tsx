// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapData, CategoryRow, TimeEntryRow } from "@/lib/queries";
import { timerDraftEditedFields, timerDraftForEntry, type TimerDraft } from "@/lib/timer-runtime";

// Owner, 14 Oct 2026 (Trello "Suggestions, tags, and activities floating panels"): the command
// timer's Activity block and Tags button open the same Activities and Tags lists as typing `@` and
// `#` (#391's FloatingList), with a search field at the top, instead of the old "Activity for this
// block" chip grid and tag picker dialog.

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

const ACTIVITIES: CategoryRow[] = [
  { id: "focus", name: "Focus", color: "mint", isPinned: true },
  { id: "write", name: "Writing", color: "blue", isPinned: false }
];

const TAGS = [
  { id: "admin", name: "Admin", normalizedName: "admin", usageCount: 5 },
  { id: "deep-work", name: "Deep work", normalizedName: "deep-work", usageCount: 2 }
];

function renderBar({
  activeEntry = null,
  categories = ACTIVITIES,
  categoryId = "",
  createCategory,
  tagNames = [],
  tags = TAGS
}: {
  activeEntry?: TimeEntryRow | null;
  categories?: CategoryRow[];
  categoryId?: string;
  createCategory?: ReturnType<typeof vi.fn>;
  tagNames?: string[];
  tags?: typeof TAGS;
} = {}) {
  const calls = {
    createCategory: createCategory ?? vi.fn().mockResolvedValue({
      ok: true,
      category: { id: "reading", name: "Reading", color: "teal", isPinned: false }
    }),
    setTimerDraft: vi.fn(),
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true })
  };
  const data = {
    activeEntry,
    categories,
    categoryUsage: [],
    dateRange: { selectedDate: "2026-08-14" },
    entries: activeEntry ? [activeEntry] : [],
    tags,
    taskSuggestions: []
  } as unknown as BootstrapData;

  // `switchTo` replaces the running block (another device, a quick start): a new block scope.
  let switchTo: (entry: TimeEntryRow) => void = () => undefined;
  function Harness() {
    const [entry, setEntry] = useState(activeEntry);
    const [timerDraft, setDraft] = useState<TimerDraft>({
      categoryId: activeEntry?.categoryId ?? categoryId,
      description: activeEntry?.description ?? "",
      tagNames: activeEntry?.tagNames ?? tagNames
    });
    switchTo = (next) => {
      setEntry(next);
      setDraft({ categoryId: next.categoryId ?? "", description: next.description ?? "", tagNames: next.tagNames });
    };
    const shellData = entry === activeEntry ? data : ({ ...data, activeEntry: entry, entries: entry ? [entry] : [] } as BootstrapData);
    runtime = {
      clearTimerError: vi.fn(),
      closeManualEntry: vi.fn(),
      createCategory: calls.createCategory,
      createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
      deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
      isManualEntryOpen: false,
      isTimerBusy: false,
      openManualEntry: vi.fn(),
      setTimerDraft: (next: TimerDraft | ((current: TimerDraft) => TimerDraft)) => {
        calls.setTimerDraft(next);
        setDraft(next);
      },
      shellData,
      startTimer: calls.startTimer,
      stopTimer: calls.stopTimer,
      timerDraft,
      timerDraftEdited: entry ? timerDraftEditedFields(timerDraft, timerDraftForEntry(entry)).length > 0 : false,
      timerError: null,
      updateActiveDetails: calls.updateActiveDetails,
      updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
    };
    return <PersistentTimerBar />;
  }

  render(<Harness />);
  return { calls, switchTo: (entry: TimeEntryRow) => act(() => switchTo(entry)) };
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

function phone() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 560px)",
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }));
}

const activityButton = () => screen.getByRole("button", { name: /^Activity: / });
const tagsButton = () => screen.getByRole("button", { name: "Add or filter tags" });
const listbox = (name: "Activities" | "Tags") => screen.getByRole("listbox", { name });
const surfaceOf = (list: HTMLElement) => list.closest<HTMLElement>(".df-flist")!;
// The visible label of each row (the muted metadata beside it, a count or "Pinned", is not part of it).
const labels = (list: HTMLElement) => within(list).queryAllByRole("option").map((option) => option.querySelector(".df-flist-label")?.textContent);
const footer = (list: HTMLElement) => [...surfaceOf(list).querySelectorAll(".df-flist-foot kbd")].map((kbd) => kbd.textContent);

async function openActivities(user = userEvent.setup()) {
  await user.click(activityButton());
  const search = screen.getByRole("combobox", { name: "Search activities" }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(search));
  return { search, user };
}

async function openTags(user = userEvent.setup()) {
  await user.click(tagsButton());
  const search = screen.getByRole("combobox", { name: "Search tags" }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(search));
  return { search, user };
}

describe("the Activity block opens the shared Activities list", () => {
  it("is the #391 FloatingList with a search field, the same rows and hints, named by visible text", async () => {
    renderBar();
    const { search } = await openActivities();
    const list = listbox("Activities");
    const surface = surfaceOf(list);
    expect(surface.className).toContain("df-flist");
    expect(surface.className).toContain("df-cmd-activity-panel");
    expect(surface.querySelector(".df-flist-head")?.textContent).toBe("Activities");
    expect(labels(list)).toEqual(["No activity", "Focus", "Writing", "Create new activity"]);
    for (const option of within(list).getAllByRole("option").slice(0, 3)) {
      expect(option.className).toContain("df-flist-row df-flist-row--activity");
    }
    // Names are the visible label; "Pinned" is the pinned activity's description, not its name.
    const focus = within(list).getByRole("option", { name: "Focus" });
    expect(focus.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(focus.getAttribute("aria-describedby")!)?.textContent).toBe("Pinned");
    expect(within(list).getByRole("option", { name: "Writing" }).getAttribute("aria-describedby")).toBeNull();
    expect(footer(list)).toEqual(["↑↓", "↵"]);
    // The search field is the combobox for the rows; the button names what it opens.
    expect(search.getAttribute("aria-controls")).toBe(list.id);
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-controls")).toBe(list.id);
    // The old chip grid is gone.
    expect(screen.queryByText("Activity for this block")).toBeNull();
  });

  it("↑/↓ move the highlight from the current activity, Enter picks it and focus returns to the block", async () => {
    const { calls } = renderBar();
    const { search, user } = await openActivities();
    const options = within(listbox("Activities")).getAllByRole("option");
    // Opens on the current choice ("No activity"), which is the selected option.
    expect(search.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(options[2].id);
    expect(options[2].className).toContain("is-highlighted");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(options[0].id);
    await user.keyboard("{ArrowUp}");
    expect(search.getAttribute("aria-activedescendant")).toBe(options[3].id);
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");

    expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    // Enter in the search never submits the bar (no Start).
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("Escape closes the list, changes nothing and returns focus to the block", async () => {
    const { calls } = renderBar();
    const { user } = await openActivities();
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    expect(screen.getByRole("button", { name: "Activity: No activity" })).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    expect(calls.setTimerDraft).not.toHaveBeenCalled();
  });

  it("filters with the @ list's resolver, offers Create for a new name, and picks No activity", async () => {
    renderBar();
    const { search, user } = await openActivities();
    await user.type(search, "wr");
    expect(labels(listbox("Activities"))).toEqual(["Writing", "Create “wr”"]);
    await user.clear(search);
    await user.type(search, "focus");
    // The exact name exists: no Create row.
    expect(labels(listbox("Activities"))).toEqual(["Focus"]);
    await user.clear(search);
    await user.type(search, "zz");
    expect(listbox("Activities").textContent).toContain("No activity called “zz”");
    expect(labels(listbox("Activities"))).toEqual(["Create “zz”"]);

    await user.clear(search);
    await user.click(within(listbox("Activities")).getByRole("option", { name: "Writing" }));
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    await openActivities(user);
    const options = within(listbox("Activities")).getAllByRole("option");
    expect(within(listbox("Activities")).getByRole("option", { name: "Writing" }).getAttribute("aria-selected")).toBe("true");
    await user.click(options[0]);
    expect(screen.getByRole("button", { name: "Activity: No activity" })).not.toBeNull();
  });

  it("creates an activity from the button: Create “name” opens the name and colour form inside the list", async () => {
    const { calls } = renderBar();
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(
      within(listbox("Activities")).getByRole("option", { name: "Create “Reading”" }).id
    );
    await user.keyboard("{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    expect(surfaceOf(form).className).toContain("df-cmd-activity-panel");
    const name = within(form).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("Reading");
    expect(within(form).getByRole("button", { name: /Choose activity colour/ })).not.toBeNull();
    await user.click(within(form).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(calls.createCategory).toHaveBeenCalledWith("Reading", undefined, "learning"));
    await waitFor(() => expect(calls.setTimerDraft).toHaveBeenCalled());
    const update = calls.setTimerDraft.mock.calls.at(-1)![0] as (current: TimerDraft) => TimerDraft;
    expect(update({ categoryId: "", description: "", tagNames: [] }).categoryId).toBe("reading");
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
  });

  it("Create new activity with nothing searched, and Escape in the form goes back to the list", async () => {
    renderBar();
    const { user } = await openActivities();
    await user.click(within(listbox("Activities")).getByRole("option", { name: "Create new activity" }));
    expect(screen.getByRole("dialog", { name: "Create new activity" })).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create new activity" })).toBeNull();
    expect(listbox("Activities")).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search activities" })));
  });

  it("while recording, a pick switches the running block's activity in place through autosave", async () => {
    const { calls } = renderBar({ activeEntry: running() });
    const { user } = await openActivities();
    await user.click(within(listbox("Activities")).getByRole("option", { name: "Writing" }));
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith({
      categoryId: "write",
      description: "Fix bug",
      tagNames: []
    }));
    expect(calls.startTimer).not.toHaveBeenCalled();
    expect(calls.stopTimer).not.toHaveBeenCalled();
  });
});

describe("the Tags button opens the shared Tags list", () => {
  it("is the #391 FloatingList, multi-select, with a search field and the Tags hints", async () => {
    renderBar({ tagNames: ["Deep work"] });
    const { search } = await openTags();
    const list = listbox("Tags");
    const surface = surfaceOf(list);
    expect(surface.className).toContain("df-flist");
    expect(surface.className).toContain("inline-tag-picker");
    expect(surface.querySelector(".df-flist-head")?.textContent).toBe("Tags");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    // Names are the visible "#name"; the count and the check are hidden from them.
    expect(within(list).getAllByRole("option").map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(within(list).getByRole("option", { name: "#Admin" }).className).toContain("df-flist-row df-flist-row--tag");
    const chosen = within(list).getByRole("option", { name: "#Deep work" });
    expect(chosen.className).toContain("is-checked");
    expect(chosen.querySelector(".df-flist-remove")).not.toBeNull();
    expect(footer(list)).toEqual(["↵", "⌫"]);
    expect(search.getAttribute("aria-controls")).toBe(list.id);
    expect(tagsButton().getAttribute("aria-haspopup")).toBe("listbox");
    expect(tagsButton().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog", { name: "Add or filter tags" })).toBeNull();
  });

  it("adds and removes several tags with ↑/↓ and Enter; Backspace in an empty search removes the last", async () => {
    const { calls } = renderBar();
    const { search, user } = await openTags();
    const draftTags = () => (calls.setTimerDraft.mock.calls.at(-1)![0] as (current: TimerDraft) => TimerDraft)({
      categoryId: "",
      description: "",
      tagNames: []
    }).tagNames;
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "#Admin, remove tag" })).not.toBeNull();
    expect(within(listbox("Tags")).getByRole("option", { name: "#Admin" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(within(listbox("Tags")).getByRole("option", { name: "#Deep work" }).id);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "#Deep work, remove tag" })).not.toBeNull();
    expect(draftTags()).toEqual(["Admin", "Deep work"]);
    // Enter on a chosen tag removes it.
    await user.keyboard("{ArrowUp}{Enter}");
    expect(screen.queryByRole("button", { name: "#Admin, remove tag" })).toBeNull();
    // Backspace in the empty search removes the last tag on the block.
    await user.keyboard("{Backspace}");
    expect(screen.queryByRole("button", { name: "#Deep work, remove tag" })).toBeNull();
    expect(within(listbox("Tags")).getAllByRole("option").map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "false"]);
    expect(document.activeElement).toBe(search);
    expect(calls.startTimer).not.toHaveBeenCalled();
  });

  it("filters, creates a tag with Create “#name”, and keeps the search focused", async () => {
    renderBar();
    const { search, user } = await openTags();
    await user.type(search, "dee");
    expect(labels(listbox("Tags"))).toEqual(["#Deep work", "Create “#dee”"]);
    await user.clear(search);
    await user.type(search, "launch");
    expect(listbox("Tags").textContent).not.toContain("No matching tags");
    const create = within(listbox("Tags")).getByRole("option", { name: "Create “#launch”" });
    expect(create.className).toContain("is-create");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "#launch, remove tag" })).not.toBeNull();
    expect(search.value).toBe("");
    // The new tag is listed, checked.
    expect(within(listbox("Tags")).getByRole("option", { name: "#launch" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(search);
  });

  it("Escape and Tab close the list and return focus to the Tags button", async () => {
    renderBar();
    const { user } = await openTags();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
    await openTags(user);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });

  it("returns focus to the description when a narrow bar hides the Tags button (Codex r2 on #629)", async () => {
    renderBar({ activeEntry: running() });
    const { user } = await openTags();
    // The phone row hides the button with CSS; jsdom has no checkVisibility, so this also covers the fallback.
    tagsButton().style.display = "none";
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector("#persistent-timer-description")));
  });

  it("handles Escape in its search, so a surrounding dialog (Add time) never takes it and closes", async () => {
    renderBar();
    const { search } = await openTags();
    // fireEvent returns false when the event's default was prevented (what ModalDialog checks).
    expect(fireEvent.keyDown(search, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });

  it("keeps the tag limit: unchosen tags are unavailable and Create is not offered", async () => {
    const full = Array.from({ length: 24 }, (_, index) => `t${index}`);
    renderBar({ tagNames: full });
    const { search, user } = await openTags();
    const admin = within(listbox("Tags")).getByRole("option", { name: "#Admin" });
    expect(admin.getAttribute("aria-disabled")).toBe("true");
    await user.click(admin);
    expect(admin.getAttribute("aria-selected")).toBe("false");
    await user.type(search, "brand new");
    expect(within(listbox("Tags")).queryByRole("option", { name: /Create/ })).toBeNull();
  });

  it("while recording, tag edits save through the same per-field autosave", async () => {
    const { calls } = renderBar({ activeEntry: running() });
    const { user } = await openTags();
    await user.click(within(listbox("Tags")).getByRole("option", { name: "#Deep work" }));
    await waitFor(() => expect(calls.updateActiveDetails).toHaveBeenCalledWith({
      categoryId: "focus",
      description: "Fix bug",
      tagNames: ["Deep work"]
    }));
    expect(calls.startTimer).not.toHaveBeenCalled();
    expect(calls.stopTimer).not.toHaveBeenCalled();
  });
});

describe("on phones the buttons' lists are sheets", () => {
  it("the Activities list is a full-width sheet with a 44 px Close that returns focus to the block", async () => {
    phone();
    renderBar();
    const { user } = await openActivities();
    const surface = surfaceOf(listbox("Activities"));
    expect(surface.className).toContain("is-sheet");
    expect(surface.style.left).toBe("12px");
    expect(surface.style.right).toBe("12px");
    expect(surface.style.maxHeight).toMatch(/px$/);
    const close = within(surface).getByRole("button", { name: "Close activities" });
    expect((close as HTMLButtonElement).hidden).toBe(false);
    await user.click(close);
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
  });

  it("keeps the sheet on screen when the page scrolls its field away (the phone Calendar scrolls; Codex r1 on #488)", async () => {
    phone();
    renderBar();
    await openTags();
    const surface = surfaceOf(listbox("Tags"));
    // The field has scrolled 300 px above the top of the screen.
    const rect = { top: -300, bottom: -256, left: 12, right: 378, width: 366, height: 44, x: 12, y: -300, toJSON: () => ({}) } as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    try {
      act(() => {
        window.dispatchEvent(new Event("scroll"));
      });
      expect(surface.style.top).toBe("12px");
      expect(surface.style.maxHeight).toBe(`${window.innerHeight - 24}px`);
      expect(within(surface).getByRole("button", { name: "Close tags" })).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("the Tags list is a full-width sheet with a 44 px Close that returns focus to the Tags button", async () => {
    phone();
    renderBar();
    const { user } = await openTags();
    const surface = surfaceOf(listbox("Tags"));
    expect(surface.className).toContain("is-sheet");
    expect(surface.style.left).toBe("12px");
    expect(surface.style.right).toBe("12px");
    await user.click(within(surface).getByRole("button", { name: "Close tags" }));
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(tagsButton());
  });
});

describe("Codex r1 on #402", () => {
  // jsdom has no layout: record which element each scrollIntoView call was made on.
  function recordScrolls() {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    return scrolled;
  }
  const original = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  const MANY_ACTIVITIES: CategoryRow[] = Array.from({ length: 32 }, (_, index) => ({
    id: `a${index}`,
    name: `Activity ${String(index).padStart(2, "0")}`,
    color: "blue",
    isPinned: false
  }));
  const MANY_TAGS = Array.from({ length: 32 }, (_, index) => ({
    id: `t${index}`,
    name: `Tag ${String(index).padStart(2, "0")}`,
    normalizedName: `tag-${String(index).padStart(2, "0")}`,
    usageCount: 1
  }));

  it("keeps the highlighted activity in view: the current one on open, then as ↑/↓ move", async () => {
    const scrolled = recordScrolls();
    renderBar({ categories: MANY_ACTIVITIES, categoryId: "a25" });
    const { search, user } = await openActivities();
    const current = within(listbox("Activities")).getByRole("option", { name: "Activity 25" });
    expect(search.getAttribute("aria-activedescendant")).toBe(current.id);
    await waitFor(() => expect(scrolled.at(-1)).toBe(current));
    await user.keyboard("{ArrowDown}");
    const next = within(listbox("Activities")).getByRole("option", { name: "Activity 26" });
    await waitFor(() => expect(scrolled.at(-1)).toBe(next));
    // Wrapping to the top brings "No activity" back into view.
    await user.keyboard("{ArrowDown}".repeat(7));
    await waitFor(() => expect(scrolled.at(-1)).toBe(within(listbox("Activities")).getByRole("option", { name: "No activity" })));
  });

  it("keeps the highlighted tag in view in the Tags button's list and the typed # list", async () => {
    const scrolled = recordScrolls();
    renderBar({ tags: MANY_TAGS });
    const { search, user } = await openTags();
    await user.keyboard("{ArrowUp}");
    const last = within(listbox("Tags")).getByRole("option", { name: "#Tag 31" });
    expect(search.getAttribute("aria-activedescendant")).toBe(last.id);
    await waitFor(() => expect(scrolled.at(-1)).toBe(last));
    await user.keyboard("{Escape}");

    const input = screen.getByLabelText("Description") as HTMLInputElement;
    await user.click(input);
    await user.type(input, "#tag", { skipClick: true });
    await user.keyboard("{ArrowUp}");
    const typedLast = within(listbox("Tags")).getAllByRole("option").at(-1)!;
    expect(input.getAttribute("aria-activedescendant")).toBe(typedLast.id);
    await waitFor(() => expect(scrolled.at(-1)).toBe(typedLast));
  });

  it("holds the list open while a Create is saving: the phone Close is unavailable and a late failure shows with the name kept", async () => {
    phone();
    let settle: (outcome: unknown) => void = () => undefined;
    const createCategory = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
    renderBar({ createCategory });
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    await user.click(within(form).getByRole("button", { name: "Create" }));
    expect(createCategory).toHaveBeenCalledWith("Reading", undefined, "learning");

    const surface = form.closest<HTMLElement>(".df-flist")!;
    const close = within(surface).getByRole("button", { name: "Close activities" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(surface.className).toContain("is-open");
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");

    await act(async () => settle({ ok: false, error: "An activity named “Reading” already exists." }));
    expect(within(form).getByRole("alert").textContent).toBe("An activity named “Reading” already exists.");
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Reading");
    expect(surface.className).toContain("is-open");
    expect(close.disabled).toBe(false);
  });

  it("fades out where it stood: the Activities list keeps its measured position and width through dismissal", async () => {
    renderBar();
    const { user } = await openActivities();
    const surface = surfaceOf(listbox("Activities"));
    const open = { left: surface.style.left, top: surface.style.top, width: surface.style.width, maxHeight: surface.style.maxHeight };
    expect(open.left).toMatch(/px$/);
    expect(open.top).toMatch(/px$/);
    expect(open.width).toMatch(/px$/);
    expect(surface.style.visibility).toBe("");

    await user.keyboard("{Escape}");
    expect(surface.className).not.toContain("is-open");
    // Same geometry, and no inline visibility cutting the 120 ms fade short.
    expect({ left: surface.style.left, top: surface.style.top, width: surface.style.width, maxHeight: surface.style.maxHeight }).toEqual(open);
    expect(surface.style.visibility).toBe("");
  });
});

describe("Codex r2 on #402: a saving Create keeps its form whatever the Activity button does", () => {
  async function pendingCreate() {
    let settle: (outcome: unknown) => void = () => undefined;
    const createCategory = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
    renderBar({ createCategory });
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    await user.click(within(form).getByRole("button", { name: "Create" }));
    expect(createCategory).toHaveBeenCalledWith("Reading", undefined, "learning");
    return { form, settle: (outcome: unknown) => settle(outcome), user };
  }

  async function failsVisibly(form: HTMLElement, settle: (outcome: unknown) => void) {
    expect(screen.getByRole("dialog", { name: "Create new activity" })).toBe(form);
    expect(surfaceOf(form).className).toContain("is-open");
    await act(async () => settle({ ok: false, error: "Unable to create this activity." }));
    expect(within(form).getByRole("alert").textContent).toBe("Unable to create this activity.");
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Reading");
    expect(surfaceOf(form).className).toContain("is-open");
  }

  for (const key of ["ArrowDown", "ArrowUp"]) {
    it(`a click on Activity, then ${key === "ArrowDown" ? "↓" : "↑"} on it, keeps the form; a late failure shows with the name`, async () => {
      const { form, settle, user } = await pendingCreate();
      await user.click(activityButton());
      fireEvent.keyDown(activityButton(), { key });
      await failsVisibly(form, settle);
    });
  }

  it("↓ and ↑ on the focused button, a second click and Tab never reset it either", async () => {
    const { form, settle, user } = await pendingCreate();
    activityButton().focus();
    fireEvent.keyDown(activityButton(), { key: "ArrowDown" });
    fireEvent.keyDown(activityButton(), { key: "ArrowUp" });
    await user.click(activityButton());
    await user.click(activityButton());
    fireEvent.keyDown(activityButton(), { key: "Tab" });
    await failsVisibly(form, settle);
  });

  it("before saving, ↓ on the button returns to the form and keeps the typed name", async () => {
    renderBar();
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    fireEvent.keyDown(activityButton(), { key: "ArrowDown" });
    expect(screen.getByRole("dialog", { name: "Create new activity" })).toBe(form);
    const name = within(form).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("Reading");
    expect(document.activeElement).toBe(name);
  });
});

describe("Codex r3 on #402: the buttons' lists belong to the block they were opened for", () => {
  const blockB = () => running({ id: "block-b", categoryId: "write", categoryName: "Writing", description: "Call", tagNames: ["Admin"] });
  const removeTag = (name: string) => screen.queryByRole("button", { name: `#${name}, remove tag` });

  it("a new block closes the Tags list; a stale Enter adds nothing to it and focus returns to the button", async () => {
    const { switchTo } = renderBar({ activeEntry: running() });
    const { search, user } = await openTags();
    await user.type(search, "launch");
    expect(within(listbox("Tags")).getByRole("option", { name: "Create “#launch”" })).not.toBeNull();
    await switchTo(blockB());
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    expect(search.value).toBe("");
    expect(tagsButton().getAttribute("aria-expanded")).toBe("false");
    // A keystroke still reaching the old search changes nothing on block B and never submits.
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(removeTag("launch")).toBeNull();
    expect(removeTag("Admin")).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });

  it("a stale Backspace in the empty search never removes the new block's last tag", async () => {
    const { switchTo } = renderBar({ activeEntry: running({ tagNames: ["Deep work"] }) });
    const { search } = await openTags();
    await switchTo(blockB());
    expect(fireEvent.keyDown(search, { key: "Backspace" })).toBe(false);
    expect(removeTag("Admin")).not.toBeNull();
  });

  it("a stale click on a tag row changes nothing on the new block", async () => {
    const { switchTo } = renderBar({ activeEntry: running() });
    await openTags();
    const deepWork = within(listbox("Tags")).getByRole("option", { name: "#Deep work" });
    await switchTo(blockB());
    fireEvent.click(deepWork);
    expect(removeTag("Deep work")).toBeNull();
    expect(removeTag("Admin")).not.toBeNull();
  });

  it("a new block closes the Activities list; a stale pick never changes the new block", async () => {
    const { calls, switchTo } = renderBar({ activeEntry: running() });
    const { search } = await openActivities();
    const focus = within(listbox("Activities")).getByRole("option", { name: "Focus" });
    await switchTo(blockB());
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull());
    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    calls.setTimerDraft.mockClear();
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    fireEvent.click(focus);
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    expect(calls.setTimerDraft).not.toHaveBeenCalled();
  });

  it("a Create saving across a block change keeps its list open but never applies the new activity to the new block", async () => {
    let settle: (outcome: unknown) => void = () => undefined;
    const createCategory = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
    const { calls, switchTo } = renderBar({ activeEntry: running(), createCategory });
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    await user.click(within(form).getByRole("button", { name: "Create" }));
    await switchTo(blockB());
    expect(surfaceOf(form).className).toContain("is-open");
    calls.setTimerDraft.mockClear();
    await act(async () => settle({ ok: true, category: { id: "reading", name: "Reading", color: "teal", isPinned: false } }));
    expect(calls.setTimerDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Activity: Writing" })).not.toBeNull();
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
  });
});

describe("Codex r3 on #402: the Create form's colour palette sits above the phone sheet", () => {
  // vitest runs from apps/web.
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const declaration = (selector: string, property: string) => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    return new RegExp(`${property}: ([^;]+);`).exec(block)?.[1];
  };

  it("layers the palette (a separate body portal) above the sheet through one token pair", () => {
    expect(css).toMatch(/:root \{\s*--df-layer-sheet: 130;\s*--df-layer-sheet-popover: calc\(var\(--df-layer-sheet\) \+ 1\);/);
    expect(declaration(".df-flist.ui-floating-surface.is-sheet", "z-index")).toBe("var(--df-layer-sheet)");
    expect(declaration(".category-picker-color-menu", "z-index")).toBe("var(--df-layer-sheet-popover)");
  });

  it("opens the palette from the phone sheet's Create form as a body portal over it", async () => {
    phone();
    renderBar();
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    expect(surfaceOf(form).className).toContain("is-sheet");
    await user.click(within(form).getByRole("button", { name: /Choose activity colour/ }));
    const palette = await screen.findByRole("listbox", { name: "Activity colour" });
    expect(palette.className).toContain("category-picker-color-menu");
    expect(palette.parentElement).toBe(document.body);
    expect(surfaceOf(form).contains(palette)).toBe(false);
  });
});

describe("Codex r4 on #402: a saving Create and focus survive quick starts and block changes", () => {
  const blockB = () => running({ id: "block-b", categoryId: "focus", categoryName: "Focus", description: "", tagNames: [] });

  async function pendingCreate(options: Parameters<typeof renderBar>[0] = {}) {
    let settle: (outcome: unknown) => void = () => undefined;
    const createCategory = vi.fn(() => new Promise((resolve) => { settle = resolve; }));
    const rendered = renderBar({ ...options, createCategory });
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    await user.click(within(form).getByRole("button", { name: "Create" }));
    return { ...rendered, form, settle: (outcome: unknown) => settle(outcome), user };
  }

  it("a quick start pressed while a Create is saving keeps the form; a late failure shows with the name", async () => {
    const { calls, form, settle, switchTo, user } = await pendingCreate();
    await user.click(screen.getByRole("button", { name: "Start Focus (1)" }));
    expect(calls.startTimer).toHaveBeenCalled();
    // The started block arrives: a new scope, while the Create is still saving.
    await switchTo(blockB());
    expect(screen.getByRole("dialog", { name: "Create new activity" })).toBe(form);
    expect(surfaceOf(form).className).toContain("is-open");
    await act(async () => settle({ ok: false, error: "Unable to create this activity." }));
    expect(within(form).getByRole("alert").textContent).toBe("Unable to create this activity.");
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Reading");
    expect(surfaceOf(form).className).toContain("is-open");
  });

  it("a quick start pressed while a Create is saving never gives the new block the new activity", async () => {
    const { calls, settle, switchTo, user } = await pendingCreate();
    await user.click(screen.getByRole("button", { name: "Start Focus (1)" }));
    await switchTo(blockB());
    calls.setTimerDraft.mockClear();
    await act(async () => settle({ ok: true, category: { id: "reading", name: "Reading", color: "teal", isPinned: false } }));
    expect(calls.setTimerDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Activity: Focus" })).not.toBeNull();
  });

  it("a new block with a colour swatch focused hands focus back to the activity block, not the page", async () => {
    const { switchTo } = renderBar({ activeEntry: running() });
    const { search, user } = await openActivities();
    await user.type(search, "Reading");
    await user.keyboard("{ArrowDown}{Enter}");
    const form = screen.getByRole("dialog", { name: "Create new activity" });
    await user.click(within(form).getByRole("button", { name: /Choose activity colour/ }));
    const palette = await screen.findByRole("listbox", { name: "Activity colour" });
    await waitFor(() => expect(palette.contains(document.activeElement)).toBe(true));
    await switchTo(blockB());
    expect(screen.queryByRole("listbox", { name: "Activity colour" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
  });

  it("a new block hands focus to the Tags button even when the closing list had already dropped it", async () => {
    const { switchTo } = renderBar({ activeEntry: running() });
    const { search } = await openTags();
    // A browser blurs a focused field when its list turns inert; focus is then on the page.
    act(() => search.blur());
    expect(document.activeElement).toBe(document.body);
    await switchTo(blockB());
    expect(document.activeElement).toBe(tagsButton());
  });

  it("a second press on either button closes its list with focus on that button", async () => {
    renderBar();
    const { user } = await openActivities();
    await user.click(activityButton());
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    await openTags(user);
    await user.click(tagsButton());
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });
});

describe("Codex r5 on #402: WebKit's button press and presses outside keep focus off the page", () => {
  // WebKit does not focus a pressed button: the field blurs to no element (relatedTarget null),
  // then the click arrives. jsdom focuses clicked buttons, so the sequence is written out.
  async function webkitPress(button: HTMLElement, focused: HTMLElement) {
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    act(() => focused.blur());
    expect(document.activeElement).toBe(document.body);
    fireEvent.pointerUp(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);
  }

  it("a second press on the activity block in WebKit closes the list and keeps it closed", async () => {
    renderBar();
    const { search } = await openActivities();
    await webkitPress(activityButton(), search);
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
    // Still closed a moment later (it never reopened).
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
  });

  it("a second press on the tag button in WebKit closes the list and keeps it closed", async () => {
    renderBar();
    const { search } = await openTags();
    await webkitPress(tagsButton(), search);
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
  });

  it("a press on non-focusable content closes either list and puts focus on its button", async () => {
    renderBar();
    const band = screen.getByTestId("persistent-timer");
    const { user } = await openActivities();
    await user.click(band);
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));

    await openTags(user);
    await user.click(band);
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(tagsButton()));
  });

  it("a press on a focusable control outside closes either list and leaves focus on that control", async () => {
    renderBar();
    const add = screen.getByRole("button", { name: "Add time manually" });
    const { user } = await openActivities();
    await user.click(add);
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.activeElement).toBe(add);

    await openTags(user);
    await user.click(add);
    expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.activeElement).toBe(add);
  });

  it("a WebKit-style press on an outside button (left unfocused) still lands focus on the list's button", async () => {
    renderBar();
    const add = screen.getByRole("button", { name: "Add time manually" });
    const { search } = await openActivities();
    await webkitPress(add, search);
    expect(screen.queryByRole("listbox", { name: "Activities" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activityButton()));
  });
});
