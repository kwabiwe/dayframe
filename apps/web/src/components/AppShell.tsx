"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  Inbox,
  MapPin,
  Search,
  Settings,
  Tags,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { placeDisplayName } from "@dayframe/shared";
import { AppShellRuntimeProvider, useAppShellRuntime } from "@/components/AppShellRuntime";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { ShellSidebarNav, ShellTabBar } from "@/components/blocks/ShellNav";
import { PersistentTimerBar } from "@/components/PersistentTimerBar";
import { SignOutControl } from "@/components/SignOutControl";
import { ShellProfileIdentity, ShellProfileInitials, initials } from "@/components/ShellProfileIdentity";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { IconButton, ModalDialog, PopoverPanel } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { timeEntryTitle } from "@/lib/display";
import { formatDuration, formatTime } from "@/lib/format";
import type { GlobalSearchResult } from "@/lib/global-search";
import { isSearchShortcut, SEARCH_SHORTCUT_LABEL } from "@/lib/keyboard-shortcuts";
import type { BootstrapData } from "@/lib/queries";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";
import {
  GO_TO_SEQUENCE_MS,
  LIBRARY_TABS,
  activeLibraryTab,
  activeShellSection,
  goToTarget,
  startsGoToSequence
} from "@/lib/shell-nav";
import {
  shiftTimelineState,
  timelineHref,
  timelineStateFromSearchParams,
  toTimelineDateKey
} from "@/lib/timeline-view";

type Overlay = "search" | "profile" | "help" | null;

const shortcuts = [
  [SEARCH_SHORTCUT_LABEL, "Open search"],
  ["?", "Keyboard shortcuts"],
  ["G then T, C, R, P, L, S", "Go to Today, Calendar, Review, Reports, Library, Settings"],
  ["Space", "Start or stop the timer"],
  ["N", "Type what you're working on"],
  ["1–6", "Start a pinned activity"],
  ["Alt+Left", "Previous day or week"],
  ["Alt+Right", "Next day or week"],
  ["Esc", "Close menus"]
];

const isStaging = process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV === "staging";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/signup") return <>{children}</>;

  return (
    <AppShellRuntimeProvider>
      <AppShellContent>{children}</AppShellContent>
    </AppShellRuntimeProvider>
  );
}

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data,
    loadDate,
    refresh,
    selectedDate,
    startTimer,
    toggleTimer
  } = useAppShellRuntime();
  const shellIdentity = data ? { userName: data.user.name, workspaceName: data.workspace.name } : null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const goToPending = useRef(false);
  const goToTimer = useRef<number | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [remoteSearch, setRemoteSearch] = useState<{ query: string; results: GlobalSearchResult[] }>({
    query: "",
    results: []
  });
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const isTimeline = pathname === "/timeline";
  const activeSection = activeShellSection(pathname);
  const libraryTab = activeLibraryTab(pathname);
  const reviewCount = data?.stats.reviewCount ?? 0;
  const showDateNavigation = pathname === "/" || pathname === "/timeline";
  const showShellDateContext = pathname === "/";
  const timelineState = useMemo(
    () => timelineStateFromSearchParams(searchParams),
    [searchParams]
  );
  const searchResults = useMemo(
    () => query.trim().length >= 2
      ? remoteSearch.query === query.trim()
        ? remoteSearch.results.map(globalSearchResult)
        : []
      : buildSearchResults(data, ""),
    [data, query, remoteSearch]
  );

  useEffect(() => {
    const searchTerm = query.trim();
    if (overlay !== "search" || searchTerm.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchStatus("loading");
      try {
        const response = await clientFetch(`/api/search?q=${encodeURIComponent(searchTerm)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Search failed: ${response.status}`);
        const payload = (await response.json()) as { results: GlobalSearchResult[] };
        setRemoteSearch({ query: searchTerm, results: payload.results });
        setSearchStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setRemoteSearch({ query: searchTerm, results: [] });
        setSearchStatus("error");
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [overlay, query]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function applyTheme() {
      const storedTheme = window.localStorage.getItem("dayframe.theme");
      if (storedTheme === "light" || storedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", storedTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    }
    applyTheme();
    window.addEventListener("storage", applyTheme);
    window.addEventListener("dayframe-theme-change", applyTheme);
    media.addEventListener("change", applyTheme);
    return () => {
      window.removeEventListener("storage", applyTheme);
      window.removeEventListener("dayframe-theme-change", applyTheme);
      media.removeEventListener("change", applyTheme);
    };
  }, []);

  const navigateDate = useCallback((date: string) => {
    if (!showDateNavigation) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", date);
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams, showDateNavigation]);

  const previousDate = addDaysKey(selectedDate, -1);
  const nextDate = addDaysKey(selectedDate, 1);
  const persistentTimer = <PersistentTimerBar workspaceMode={isTimeline} />;
  const navigatePeriod = useCallback(async (direction: "previous" | "next") => {
    if (pathname === "/timeline") {
      const nextState = shiftTimelineState(timelineState, direction);
      const originSearch = searchParams.toString();
      const outcome = await loadDate(nextState.date);
      if (outcome.ok && window.location.search.slice(1) === originSearch) {
        window.history.pushState(
          null,
          "",
          timelineHref(searchParams.toString(), nextState)
        );
      }
      return;
    }
    navigateDate(direction === "previous" ? previousDate : nextDate);
  }, [loadDate, navigateDate, nextDate, pathname, previousDate, searchParams, timelineState]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverlay(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (isSearchShortcut(event)) {
        event.preventDefault();
        setOverlay("search");
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setOverlay("help");
        return;
      }
      const goTo = goToPending.current ? goToTarget(event) : null;
      goToPending.current = false;
      if (goTo || startsGoToSequence(event)) {
        // Never leave a page while a dialog, popover or inline editor owns the keyboard.
        if (event.defaultPrevented || hasOpenDialog()) return;
        event.preventDefault();
        if (goTo) {
          if (pathname !== goTo) router.push(goTo);
          return;
        }
        goToPending.current = true;
        window.clearTimeout(goToTimer.current);
        goToTimer.current = window.setTimeout(() => { goToPending.current = false; }, GO_TO_SEQUENCE_MS);
        return;
      }
      const bare = !event.altKey && !event.ctrlKey && !event.metaKey;
      if (bare && event.code === "Space") {
        // Space on a focused control presses it; elsewhere it starts or stops the timer.
        if (!event.shiftKey && isPressableTarget(event.target)) return;
        if (event.defaultPrevented || hasOpenDialog()) return;
        event.preventDefault();
        // Holding the key must not start, stop and start again.
        if (event.repeat) return;
        const starting = !data?.activeEntry;
        void toggleTimer();
        if (starting) focusCommandInput();
        return;
      }
      if (bare && !event.shiftKey && event.key.toLowerCase() === "n") {
        if (event.defaultPrevented || hasOpenDialog()) return;
        event.preventDefault();
        focusCommandInput();
        return;
      }
      if (showDateNavigation && event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        void navigatePeriod("previous");
        return;
      }
      if (showDateNavigation && event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        void navigatePeriod("next");
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      window.clearTimeout(goToTimer.current);
      goToPending.current = false;
    };
  }, [data?.activeEntry, navigatePeriod, pathname, router, showDateNavigation, toggleTimer]);

  return (
    <div className={`swiss-app-shell${isTimeline ? " is-timeline" : ""}`}>
      <aside className="df-side">
        <Link href="/" className="df-brand" aria-label="Dayframe Today">
          <DayframeBrand decorative size="md" />
          {isStaging ? <span className="dayframe-environment-badge">Staging</span> : null}
        </Link>
        <ShellSidebarNav activeId={activeSection?.id ?? null} reviewCount={reviewCount} />
        <div className="df-side-foot">
          <div className="df-side-row">
            <ThemeToggleButton />
            <button type="button" className="df-side-search" onClick={() => setOverlay("search")}>
              <DayframeIcon glyph="search" size={17} />
              <span>Search</span>
              <kbd>{SEARCH_SHORTCUT_LABEL}</kbd>
            </button>
          </div>
          <button type="button" className="df-side-shortcuts" onClick={() => setOverlay("help")}>
            <span>Keyboard shortcuts</span>
            <kbd>?</kbd>
          </button>
          <button
            type="button"
            className="df-profile"
            aria-label="Profile, workspace and settings"
            onClick={() => setOverlay("profile")}
          >
            <ShellProfileInitials identity={shellIdentity} />
            <ShellProfileIdentity identity={shellIdentity} />
          </button>
        </div>
      </aside>

      <header className="df-mtop">
        <Link href="/" className="df-brand" aria-label="Dayframe Today">
          <DayframeBrand decorative size="sm" />
          {isStaging ? <span className="dayframe-environment-badge">Staging</span> : null}
        </Link>
        <div className="df-mtop-actions">
          <button type="button" className="df-mtop-button" aria-label="Search" onClick={() => setOverlay("search")}>
            <DayframeIcon glyph="search" size={20} />
          </button>
          <button type="button" className="df-mtop-avatar" aria-label="Profile, workspace and settings" onClick={() => setOverlay("profile")}>
            <ShellProfileInitials identity={shellIdentity} />
          </button>
        </div>
      </header>

      <div className={`swiss-main-frame${isTimeline ? " is-timeline" : ""}`}>
        {isTimeline ? (
          <section className="swiss-timeline-surface" aria-label="Timeline workspace">
            <div className="swiss-persistent-timer-shell">
              {persistentTimer}
            </div>
            <main className="swiss-timeline-main">{children}</main>
          </section>
        ) : (
          <>
            <div className="swiss-persistent-timer-shell">
              {persistentTimer}
              {showShellDateContext ? (
                <DateContextRow
                  selectedDate={selectedDate}
                  onPrevious={() => navigateDate(previousDate)}
                  onNext={() => navigateDate(nextDate)}
                  onSelect={navigateDate}
                />
              ) : null}
            </div>
            <main>
              {libraryTab ? <LibraryTabs activeHref={libraryTab.href} /> : null}
              {children}
            </main>
          </>
        )}
      </div>

      <ShellTabBar activeId={activeSection?.id ?? null} reviewCount={reviewCount} />

      {overlay === "profile" && data ? (
        <ProfileWorkspacePopover
          data={data}
          onClose={() => setOverlay(null)}
          onUpdated={async (close = false) => {
            if (close) setOverlay(null);
            await refresh({ force: true });
            router.refresh();
          }}
        />
      ) : null}
      {overlay === "search" ? (
        <SearchPalette
          query={query}
          setQuery={setQuery}
          results={searchResults}
          status={query.trim().length >= 2 && remoteSearch.query !== query.trim()
            ? "loading"
            : searchStatus}
          onStartAgain={async (result) => {
            const outcome = await startTimer(result.startAgain);
            if (outcome.ok) setOverlay(null);
            return outcome;
          }}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay === "help" ? <HelpDialog onClose={() => setOverlay(null)} /> : null}
    </div>
  );
}

/** Activities, Tags and Places stay separate pages, reached as the three Library tabs. */
function focusCommandInput() {
  window.requestAnimationFrame(() => document.getElementById("persistent-timer-description")?.focus());
}

function isPressableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("button, a[href], summary, [role='button'], [role='option'], [role='menuitem'], [role='tab'], [role='switch'], [role='checkbox']"));
}

function LibraryTabs({ activeHref }: { activeHref: string }) {
  return (
    <nav className="df-library-tabs" aria-label="Library">
      {LIBRARY_TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={tab.href === activeHref ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function DateContextRow({
  onNext,
  onPrevious,
  onSelect,
  selectedDate
}: {
  onNext: () => void;
  onPrevious: () => void;
  onSelect: (date: string) => void;
  selectedDate: string;
}) {
  const today = dateKey(new Date());
  return (
    <div className="swiss-date-context-row" aria-label="Date navigation">
      <IconButton label="Previous day" onClick={onPrevious}><ChevronLeft size={19} /></IconButton>
      <DatePickerPopover
        label={formatLongDate(selectedDate)}
        onChange={onSelect}
        today={today}
        value={selectedDate}
      />
      <IconButton label="Next day" onClick={onNext}><ChevronRight size={19} /></IconButton>
    </div>
  );
}

function ProfileWorkspacePopover({
  data,
  onClose,
  onUpdated
}: {
  data: BootstrapData;
  onClose: () => void;
  onUpdated: (close?: boolean) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function switchWorkspace(workspaceId: string) {
    if (workspaceId === data.workspace.id) return;
    await run(async () => {
      const response = await clientFetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId })
      });
      if (!response.ok) throw new Error("Unable to switch workspace. Try again.");
      await onUpdated(true);
    });
  }

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update your account.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <PopoverPanel title="Profile & workspace" onClose={onClose} align="bottom-left" busy={isBusy}>
      <div className="swiss-profile-summary">
        <span>{initials(data.user.name)}</span>
        <div><strong>{data.user.name}</strong><small>{data.user.email}</small></div>
      </div>

      <section className="swiss-profile-section" aria-labelledby="workspace-switcher-heading">
        <h3 id="workspace-switcher-heading">Workspaces</h3>
        <div className="swiss-menu-list">
          {data.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              disabled={isBusy}
              className={workspace.id === data.workspace.id ? "is-selected" : ""}
              onClick={() => void switchWorkspace(workspace.id)}
            >
              <Folder size={18} />
              <span>{workspace.name}</span>
              {workspace.id === data.workspace.id ? <CheckCircle2 size={16} /> : null}
            </button>
          ))}
        </div>
        {error ? <p className="swiss-inline-error" role="alert">{error}</p> : null}
      </section>

      <div className="swiss-profile-links">
        <Link href="/settings#account" className="swiss-menu-action" onClick={onClose}><Settings size={17} />Settings</Link>
        <SignOutControl className="swiss-menu-action" showIcon />
      </div>
    </PopoverPanel>
  );
}

function SearchPalette({
  query,
  setQuery,
  results,
  status,
  onStartAgain,
  onClose
}: {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  status: "idle" | "loading" | "ready" | "error";
  onStartAgain: (result: SearchResult & { startAgain: NonNullable<SearchResult["startAgain"]> }) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <ModalDialog ariaLabel="Search Dayframe" onClose={onClose} showClose={false}>
      <div className="swiss-search-input">
        <Search size={21} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activities, entries, places, review items" />
        <kbd>Esc</kbd>
        <IconButton label="Close search" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="swiss-search-results">
        {results.map((result) => {
          const Icon = result.icon;
          return (
            <div className="swiss-search-result" key={result.id}>
              <Link href={result.href} onClick={onClose}>
                <Icon size={19} />
                <span><strong>{result.label}</strong><small>{result.detail}</small></span>
                <em>{result.group}</em>
              </Link>
              {result.startAgain ? (
                <button
                  className="swiss-search-start-again"
                  type="button"
                  onClick={() => void onStartAgain({ ...result, startAgain: result.startAgain! })}
                >
                  Start Again
                </button>
              ) : null}
            </div>
          );
        })}
        {status === "loading" ? <p role="status">Searching all history…</p> : null}
        {status === "error" ? <p role="alert">Search is unavailable. Try again.</p> : null}
        {status !== "loading" && status !== "error" && results.length === 0
          ? <p>No matching results.</p>
          : null}
      </div>
    </ModalDialog>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalDialog description="Use these shortcuts from Dayframe screens when you are not typing in a field." onClose={onClose} title="Keyboard shortcuts">
      <div className="swiss-shortcut-list">
        {shortcuts.map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}
      </div>
    </ModalDialog>
  );
}

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  group: string;
  href: string;
  icon: LucideIcon;
  startAgain?: {
    categoryId?: string;
    placeId?: string;
    description?: string;
    tagNames?: string[];
  };
};

function globalSearchResult(result: GlobalSearchResult): SearchResult {
  const occurredAt = result.occurredAt ? new Date(result.occurredAt) : null;
  const date = occurredAt && !Number.isNaN(occurredAt.getTime())
    ? toTimelineDateKey(occurredAt)
    : null;
  const href = result.kind === "entry" && result.entryId && date
    ? `/timeline?date=${date}&scope=day&view=list&entry=${result.entryId}`
    : result.kind === "review"
      ? `/review#review-${result.id.slice("review:".length)}`
      : result.kind === "place"
        ? `/places#place-${result.placeId}`
        : result.kind === "tag"
          ? `/tags#tag-${result.id.slice("tag:".length)}`
          : result.kind === "category"
            ? `/categories#category-${result.categoryId}`
            : date && result.entryId
              ? `/timeline?date=${date}&scope=day&view=list&entry=${result.entryId}`
              : "/timeline?view=list";
  const iconByKind: Record<GlobalSearchResult["kind"], LucideIcon> = {
    activity: Clock3,
    entry: Clock3,
    place: MapPin,
    category: FileText,
    tag: Tags,
    review: Inbox
  };
  const groupByKind: Record<GlobalSearchResult["kind"], string> = {
    activity: "Recent",
    entry: "Entry",
    place: "Place",
    category: "Activities",
    tag: "Tag",
    review: "Review"
  };
  return {
    id: result.id,
    label: result.label,
    detail: result.detail || (occurredAt ? occurredAt.toLocaleDateString() : groupByKind[result.kind]),
    group: groupByKind[result.kind],
    href,
    icon: iconByKind[result.kind],
    ...(result.kind === "activity"
      ? {
          startAgain: {
            ...(result.categoryId ? { categoryId: result.categoryId } : {}),
            ...(result.placeId ? { placeId: result.placeId } : {}),
            ...(result.description ? { description: result.description } : {}),
            ...(result.tagNames.length ? { tagNames: result.tagNames } : {})
          }
        }
      : {})
  };
}

function buildSearchResults(data: BootstrapData | null, query: string): SearchResult[] {
  if (!data) return [];
  const needle = query.trim().toLowerCase();
  const results: SearchResult[] = [
    ...data.categories.map((category) => ({
      id: `category:${category.id}`,
      label: category.name,
      detail: category.isPinned ? "Pinned activity" : "Activity",
      group: "Activities",
      href: "/categories",
      icon: FileText
    })),
    ...data.places.map((place) => ({
      id: `place:${place.id}`,
      label: placeDisplayName(place),
      detail: place.defaultCategoryName ?? "Place",
      group: "Place",
      href: "/places",
      icon: MapPin
    })),
    ...data.entries.slice(0, 40).map((entry) => ({
      id: `entry:${entry.id}`,
      label: timeEntryTitle(entry),
      detail: `${formatTime(entry.startedAt)} · ${formatDuration(entry.durationSeconds)}`,
      group: "Entry",
      href: "/timeline?view=list",
      icon: Clock3
    })),
    ...data.reviewItems.map((item) => ({
      id: `review:${item.id}`,
      label: item.title,
      detail: item.status,
      group: "Review",
      href: "/review",
      icon: Inbox
    }))
  ];
  if (!needle) return results.slice(0, 8);
  return results.filter((result) => `${result.label} ${result.detail} ${result.group}`.toLowerCase().includes(needle)).slice(0, 12);
}


function formatLongDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function addDaysKey(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}
