// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentActivitySuggestion, RecentActivitySuggestionCandidate } from "@dayframe/shared";
import type { BootstrapData } from "@/lib/queries";

let runtime: Record<string, unknown>;

vi.mock("@/components/AppShellRuntime", () => ({
  useAppShellRuntime: () => runtime
}));

const { PersistentTimerBar } = await import("./PersistentTimerBar");

// The owner's 13 Oct shape: the contextual top 6 are frequent work; "App testing" is not among them.
const CONTEXTUAL = ["BAU", "Vibe coding", "PCI DSS audit", "Standup", "Email triage", "Code review"]
  .map((description, index) => suggestion(description, { score: 90 - index, useCount: 168 - index * 20 }));
const CANDIDATES: RecentActivitySuggestionCandidate[] = [
  { ...suggestion("App testing", { categoryId: "dayframe", categoryName: "Dayframe", score: 30, useCount: 8 }), learningTier: 1 },
  ...CONTEXTUAL.map((item) => ({ ...item, learningTier: 1 as const })),
  { ...suggestion("Mapping review", { score: 20, useCount: 4 }), learningTier: 1 }
];

describe("PersistentTimerBar typed suggestion search", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() {
        this.open = true;
      }
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value() {
        this.open = false;
      }
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("finds App testing in the command timer when it is outside the contextual top 6", async () => {
    const setTimerDraft = vi.fn();
    runtime = runtimeFixture({ description: "app testing", setTimerDraft });
    render(<PersistentTimerBar />);

    fireEvent.focus(screen.getByLabelText("Description"));
    const list = await screen.findByRole("listbox", { name: "Suggestions" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("App testing");

    await userEvent.click(options[0]!);
    expect(setTimerDraft).toHaveBeenCalledWith({
      categoryId: "dayframe",
      description: "App testing",
      tagNames: []
    });
  });

  it("ranks typed Add time matches from the whole pool, capped at 5", async () => {
    runtime = runtimeFixture({ isManualEntryOpen: true });
    render(<PersistentTimerBar />);

    // Add time is the shared New block editor (WUI-025); the timer bar keeps its own Description.
    const description = within(await screen.findByRole("dialog", { name: "New block" })).getByLabelText("Description") as HTMLInputElement;
    await userEvent.click(description);
    await userEvent.type(description, "  APP");
    const list = await screen.findByRole("listbox", { name: "Suggestions" });
    // Prefix "App testing" before the word-internal "Mapping review".
    expect(within(list).getAllByRole("option").map((option) => option.textContent))
      .toEqual([expect.stringContaining("App testing"), expect.stringContaining("Mapping review")]);

    await userEvent.clear(description);
    await userEvent.type(description, "e");
    expect(within(await screen.findByRole("listbox", { name: "Suggestions" })).getAllByRole("option")).toHaveLength(5);
  });

  it("keeps the empty-query list as the unchanged contextual top 5", async () => {
    runtime = runtimeFixture({ description: "" });
    render(<PersistentTimerBar />);

    fireEvent.focus(screen.getByLabelText("Description"));
    const list = await screen.findByRole("listbox", { name: "Suggestions" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(
      CONTEXTUAL.slice(0, 5).map((item) => expect.stringContaining(item.description))
    );
    expect(list.textContent).not.toContain("App testing");
  });

  it("falls back to searching the contextual list for a bootstrap cached before the pool existed", async () => {
    runtime = runtimeFixture({ description: "  vibe ", candidates: null });
    render(<PersistentTimerBar />);

    fireEvent.focus(screen.getByLabelText("Description"));
    const list = await screen.findByRole("listbox", { name: "Suggestions" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent))
      .toEqual([expect.stringContaining("Vibe coding")]);
  });
});

function suggestion(description: string, overrides: Partial<RecentActivitySuggestion> = {}): RecentActivitySuggestion {
  return {
    key: `work:${description.toLowerCase()}`,
    categoryId: "work",
    categoryName: "Work",
    categoryColor: "blue",
    description,
    lastSeenAt: "2026-10-09T16:00:00.000Z",
    score: 10,
    section: "often_used",
    useCount: 3,
    totalSeconds: 10_800,
    tagNames: [],
    ...overrides
  };
}

function runtimeFixture(overrides: {
  candidates?: RecentActivitySuggestionCandidate[] | null;
  description?: string;
  isManualEntryOpen?: boolean;
  setTimerDraft?: ReturnType<typeof vi.fn>;
} = {}) {
  const data = {
    activeEntry: null,
    categories: [
      { id: "work", name: "Work", color: "blue", isPinned: false },
      { id: "dayframe", name: "Dayframe", color: "coral", isPinned: false }
    ],
    categoryUsage: [],
    dateRange: { selectedDate: "2026-10-12" },
    entries: [],
    tags: [],
    taskSuggestions: CONTEXTUAL,
    ...(overrides.candidates === null ? {} : { taskSuggestionCandidates: overrides.candidates ?? CANDIDATES })
  } as unknown as BootstrapData;
  return {
    clearTimerError: vi.fn(),
    closeManualEntry: vi.fn(),
    createCategory: vi.fn().mockResolvedValue({ ok: true }),
    createManualEntry: vi.fn().mockResolvedValue({ ok: true }),
    deleteActiveTimer: vi.fn().mockResolvedValue({ ok: true }),
    isManualEntryOpen: overrides.isManualEntryOpen ?? false,
    isTimerBusy: false,
    openManualEntry: vi.fn(),
    setTimerDraft: overrides.setTimerDraft ?? vi.fn(),
    shellData: data,
    startTimer: vi.fn().mockResolvedValue({ ok: true }),
    stopTimer: vi.fn().mockResolvedValue({ ok: true }),
    timerDraft: { categoryId: "", description: overrides.description ?? "", tagNames: [] },
    timerError: null,
    updateActiveDetails: vi.fn().mockResolvedValue({ ok: true }),
    updateActiveStartTime: vi.fn().mockResolvedValue({ ok: true })
  };
}
