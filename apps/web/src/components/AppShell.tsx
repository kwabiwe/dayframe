"use client";

import { isSignedOutPath } from "@/lib/signed-out-paths";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { AppShellRuntimeProvider, useAppShellRuntime } from "@/components/AppShellRuntime";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { ErrorBanner } from "@/components/blocks/ErrorBanner";
import { TooltipHost } from "@/components/blocks/TooltipHost";
import { CommandPalette } from "@/components/blocks/CommandPalette";
import { getResolvedThemeChoice, setThemeChoice, subscribeToThemeChoice } from "@/components/ThemeSettings";
import { ShellSidebarNav, ShellTabBar } from "@/components/blocks/ShellNav";
import { PersistentTimerBar } from "@/components/PersistentTimerBar";
import { SignOutControl } from "@/components/SignOutControl";
import { ShellProfileIdentity, ShellProfileInitials, initials } from "@/components/ShellProfileIdentity";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { useLocalDayStartMs } from "@/components/useCalendarClock";
import { askingChecks, clashBlocksFrom, oldestCheckHref } from "@/lib/calendar-checks";
import { CheckDecisionsProvider, useEndedBlocks, useProjectedReviewItems } from "@/components/location/ListChecks";
import { useClashesBeyondCap } from "@/components/location/useClashesBeyondCap";
import { withClashItems } from "@/lib/clash-presentation";
import { useBandScrolled } from "@/components/useBandScrolled";
import { ModalDialog, PopoverPanel } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { beforeSessionChange } from "@/lib/session-change";
import { basePaletteCommands, type PaletteCommand } from "@/lib/command-palette";
import { isSearchShortcut, SEARCH_SHORTCUT_LABEL } from "@/lib/keyboard-shortcuts";
import type { BootstrapData, CategoryRow, ReviewItemRow } from "@/lib/queries";
import { hasOpenDialog, isTypingTarget } from "@/lib/keyboard-ownership";
import { markReportsZoneSyncRefresh, reportsRouteHref } from "@/lib/reports-zone-sync";
import { syncViewerTimeZoneCookie } from "@/lib/viewer-time-zone";
import {
  GO_TO_SEQUENCE_MS,
  activeShellSection,
  OPEN_SHORTCUTS_EVENT,
  goToTarget,
  startsGoToSequence
} from "@/lib/shell-nav";
import {
  shiftTimelineState,
  timelineHref,
  timelineStateFromSearchParams
} from "@/lib/timeline-view";

type Overlay = "search" | "profile" | "help" | null;

const shortcuts = [
  [SEARCH_SHORTCUT_LABEL, "Open search"],
  ["?", "Keyboard shortcuts"],
  ["G then T, C, P, L, S", "Go to Today, Calendar, Reports, Library, Settings"],
  ["Space", "Start or stop recording"],
  ["N", "Type what you're working on"],
  ["1–6", "Start a pinned activity"],
  ["Alt+Left", "Previous day or week"],
  ["Alt+Right", "Next day or week"],
  ["Esc", "Close menus"]
];

const isStaging = process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV === "staging";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isSignedOutPath(pathname)) return <>{children}</>;

  return (
    <AppShellRuntimeProvider>
      <CheckDecisionsHost>
        <AppShellContent>{children}</AppShellContent>
      </CheckDecisionsHost>
    </AppShellRuntimeProvider>
  );
}

const NO_REVIEW_ITEMS: readonly ReviewItemRow[] = [];
const NO_CATEGORIES: readonly CategoryRow[] = [];

/**
 * The "?" decisions' one owner (Codex r4 on #609), per workspace/user lifetime: Calendar › List answers through it,
 * and the sidebar badge and Today's chip count from it, so an answer held, saving or saved shows the same everywhere,
 * and survives leaving the List. Another workspace or person starts it afresh.
 */
function CheckDecisionsHost({ children }: { children: ReactNode }) {
  const { canonicalShellData, data, refresh, shellData } = useAppShellRuntime();
  const owner = data ? `${data.workspace.id}:${data.user.id}` : "";
  const refreshShell = useCallback(async () => { await refresh(); }, [refresh]);
  // The blocks the shell has (the running one last, so it wins): a "block ran into your trip" stops asking once its
  // block no longer runs into the trip (location v4 design §7).
  // As the server last sent them (not the End it projection), so a projection is confirmed against canonical data.
  const canonical = canonicalShellData ?? shellData ?? data;
  const blocks = useMemo(() => canonical ? clashBlocksFrom([...canonical.historyEntries ?? [], ...canonical.weekEntries ?? [],
    ...canonical.dayEntries ?? [], ...canonical.entries ?? [], ...(canonical.activeEntry ? [canonical.activeEntry] : [])],
  canonical.categories) : undefined, [canonical]);
  // Clashes past the bootstrap's 100 items (web parity with #622): read only when the bootstrap reached its cap, on its
  // refreshes, and merged in once each; every one still counts only while its block is loaded here.
  // From the stable canonical shell data, which keeps its owner while the Calendar loads another date (Codex r1 on #623).
  const todayStartMs = useLocalDayStartMs();
  const canonicalOwner = canonical ? `${canonical.workspace.id}:${canonical.user.id}` : "";
  const canonicalItems = canonical?.reviewItems ?? NO_REVIEW_ITEMS;
  const beyondCap = useClashesBeyondCap({ bootstrapItems: canonicalItems, dataVersion: canonical, owner: canonicalOwner, todayStartMs });
  const bootstrapItems = data?.reviewItems ?? NO_REVIEW_ITEMS;
  const reviewItems = useMemo(() => data ? withClashItems(bootstrapItems, beyondCap) : NO_REVIEW_ITEMS, [beyondCap, bootstrapItems, data]);
  return (
    <CheckDecisionsProvider blocks={blocks} categories={data?.categories ?? NO_CATEGORIES} owner={owner} refresh={refreshShell}
      reviewItems={reviewItems}>
      <EndedBlocksToTimer />
      {children}
    </CheckDecisionsProvider>
  );
}

/** Hands the "?" owner's End it projections to the timer's owner, so the bar, Today and Calendar show them (design §7). */
function EndedBlocksToTimer() {
  const { setProjectedEnds } = useAppShellRuntime();
  const ended = useEndedBlocks();
  useEffect(() => {
    setProjectedEnds?.(ended);
  }, [ended, setProjectedEnds]);
  useEffect(() => () => setProjectedEnds?.(new Map()), [setProjectedEnds]);
  return null;
}

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data,
    loadDate,
    openManualEntry,
    refresh,
    startTimer,
    toggleTimer
  } = useAppShellRuntime();
  const shellIdentity = data ? { userName: data.user.name, workspaceName: data.workspace.name } : null;
  // The account button's name starts with what it shows: the name and the workspace (WUI-044).
  const profileLabel = shellIdentity
    ? `${shellIdentity.userName}, ${shellIdentity.workspaceName}: profile and settings`
    : "Profile and settings";
  const [overlay, setOverlay] = useState<Overlay>(null);
  const goToPending = useRef(false);
  const goToTimer = useRef<number | undefined>(undefined);
  const isTimeline = pathname === "/timeline";
  const activeSection = activeShellSection(pathname);
  // Things to check today and the 7 days before (location v4 step 14); older servers send none.
  // Things to check (owner, 28 Oct 2026): the "?" that still ask — today and the 6 days before — in the viewer's own
  // days; the badge opens the oldest. Before hydration (no local day yet) the server's count stands in.
  const todayStartMs = useLocalDayStartMs();
  // As the List shows them, from the one decisions owner: held, saving and saved answers away, revived ones back.
  const projectedItems = useProjectedReviewItems(data?.reviewItems ?? NO_REVIEW_ITEMS);
  const asking = useMemo(() => todayStartMs !== null && data ? askingChecks(projectedItems, todayStartMs) : null,
    [data, projectedItems, todayStartMs]);
  const checkCount = asking ? asking.length : data?.stats.checkCount ?? 0;
  const calendarHref = asking?.length ? oldestCheckHref(asking) : undefined;
  const resolvedTheme = useSyncExternalStore(subscribeToThemeChoice, getResolvedThemeChoice, () => "light" as const);
  const paletteCommands = useMemo(
    () => basePaletteCommands({ activities: data?.categories ?? [], theme: resolvedTheme }),
    [data?.categories, resolvedTheme]
  );
  const runPaletteCommand = useCallback((command: PaletteCommand) => {
    setOverlay(command.action.kind === "shortcuts" ? "help" : null);
    switch (command.action.kind) {
      case "start":
        void startTimer(command.action.draft);
        return;
      case "navigate":
        router.push(command.action.href);
        return;
      case "add-block":
        openManualEntry();
        return;
      case "toggle-theme":
        setThemeChoice(resolvedTheme === "dark" ? "light" : "dark");
        return;
      case "shortcuts":
        return;
    }
  }, [openManualEntry, resolvedTheme, router, startTimer]);
  const showDateNavigation = pathname === "/timeline";
  const timelineState = useMemo(
    () => timelineStateFromSearchParams(searchParams),
    [searchParams]
  );


  // The browser's time zone, for the days the server works out (Reports). A Reports page drawn
  // before the cookie existed, or for another zone, redraws once with the viewer's days, at rest
  // (no landing on reconciliation).
  useEffect(() => {
    if (!syncViewerTimeZoneCookie(document, window.location.protocol === "https:")) return;
    // Elsewhere the shell's data was drawn for the old zone (or none): fetch it again with the
    // cookie, so its day and week ranges are the viewer's (#484).
    if (!window.location.pathname.startsWith("/reports")) {
      void refresh();
      return;
    }
    // Marked with the route the refresh will render, in the router's terms (the panel compares
    // `usePathname()`/`useSearchParams()`, never the address bar).
    markReportsZoneSyncRefresh(reportsRouteHref(window.location.pathname, window.location.search));
    router.refresh();
  }, [refresh, router]);

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

  const persistentTimer = <PersistentTimerBar workspaceMode={isTimeline} />;
  // The timer band draws its hairline only once page content has scrolled under it (C1), on every
  // page: Calendar's band is the same opaque canvas and its grid scrolls inside its own panel.
  const timerBandRef = useRef<HTMLDivElement | null>(null);
  const pageMainRef = useRef<HTMLElement | null>(null);
  const contentUnderBand = useBandScrolled(timerBandRef, pageMainRef, pathname);
  const navigatePeriod = useCallback(async (direction: "previous" | "next") => {
    // In Calendar › List the period doesn't apply (continuous days), as its greyed controls say.
    if (pathname !== "/timeline" || timelineState.view === "list") return;
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
  }, [loadDate, pathname, searchParams, timelineState]);

  useEffect(() => {
    const openShortcuts = () => setOverlay("help");
    window.addEventListener(OPEN_SHORTCUTS_EVENT, openShortcuts);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, openShortcuts);
  }, []);

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
        <ShellSidebarNav activeId={activeSection?.id ?? null} calendarHref={calendarHref} checkCount={checkCount} />
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
            aria-label={profileLabel}
            data-profile-trigger="" onClick={() => setOverlay("profile")}
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
          <button type="button" className="df-mtop-avatar" aria-label={profileLabel} data-profile-trigger="" onClick={() => setOverlay("profile")}>
            <ShellProfileInitials identity={shellIdentity} />
          </button>
        </div>
      </header>

      <div className={`swiss-main-frame${isTimeline ? " is-timeline" : ""}`}>
        {isTimeline ? (
          <section className="swiss-timeline-surface" aria-label="Calendar">
            <div
              className="swiss-persistent-timer-shell"
              data-scrolled={contentUnderBand ? "true" : undefined}
              ref={timerBandRef}
            >
              {persistentTimer}
            </div>
            {/* The Calendar grid scrolls inside this panel, which never moves under the band, so
                its own scrolling never shows the hairline. */}
            <main className="swiss-timeline-main" ref={pageMainRef}>{children}</main>
          </section>
        ) : (
          <>
            <div
              className="swiss-persistent-timer-shell"
              data-scrolled={contentUnderBand ? "true" : undefined}
              ref={timerBandRef}
            >
              {persistentTimer}
            </div>
            <main ref={pageMainRef}>
              {children}
            </main>
          </>
        )}
      </div>

      <ShellTabBar activeId={activeSection?.id ?? null} calendarHref={calendarHref} checkCount={checkCount} />

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
      <TooltipHost />
      {overlay === "search" && data ? (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setOverlay(null)}
          onRun={runPaletteCommand}
          onStartTyped={(description) => {
            setOverlay(null);
            void startTimer({ categoryId: "", description, tagNames: [] });
          }}
        />
      ) : null}
      {overlay === "help" ? <HelpDialog onClose={() => setOverlay(null)} /> : null}
    </div>
  );
}

function focusCommandInput() {
  window.requestAnimationFrame(() => document.getElementById("persistent-timer-description")?.focus());
}

function isPressableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("button, a[href], summary, [role='button'], [role='option'], [role='menuitem'], [role='tab'], [role='switch'], [role='checkbox']"));
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
      // Held Review decisions are saved under the workspace they were made in.
      await beforeSessionChange();
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
    <PopoverPanel title="Profile & workspace" onClose={onClose} align="bottom-left" busy={isBusy} outsidePressIgnore="[data-profile-trigger]">
      <div className="df-profile-pop">
        <div className="df-profile-pop-card">
          <span aria-hidden="true">{initials(data.user.name)}</span>
          <div><strong>{data.user.name}</strong><small>{data.user.email}</small></div>
        </div>

        <section aria-labelledby="workspace-switcher-heading">
          <h3 id="workspace-switcher-heading">Workspaces</h3>
          <div className="df-profile-pop-rows">
            {data.workspaces.map((workspace) => {
              const current = workspace.id === data.workspace.id;
              return (
                <button
                  aria-current={current || undefined}
                  disabled={isBusy}
                  key={workspace.id}
                  onClick={() => void switchWorkspace(workspace.id)}
                  type="button"
                >
                  <DayframeIcon glyph="folder" size={18} />
                  <span>{workspace.name}</span>
                  {current ? <Check aria-label="Current workspace" size={16} /> : null}
                </button>
              );
            })}
          </div>
          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        </section>

        <div className="df-profile-pop-rows">
          <Link href="/settings#account" onClick={onClose}><DayframeIcon glyph="settings" size={17}/>Settings</Link>
          <SignOutControl className="" showIcon />
        </div>
      </div>
    </PopoverPanel>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalDialog size="compact" description="Use these shortcuts from Dayframe screens when you are not typing in a field." onClose={onClose} title="Keyboard shortcuts">
      <div className="df-shortcuts">
        {shortcuts.map(([keys, action]) => <div key={keys}><span>{action}</span><kbd>{keys}</kbd></div>)}
      </div>
    </ModalDialog>
  );
}
