"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Folder, Settings } from "lucide-react";
import { AppShellRuntimeProvider, useAppShellRuntime } from "@/components/AppShellRuntime";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { CommandPalette } from "@/components/blocks/CommandPalette";
import { getResolvedThemeChoice, setThemeChoice, subscribeToThemeChoice } from "@/components/ThemeSettings";
import { ShellSidebarNav, ShellTabBar } from "@/components/blocks/ShellNav";
import { PersistentTimerBar } from "@/components/PersistentTimerBar";
import { SignOutControl } from "@/components/SignOutControl";
import { ShellProfileIdentity, ShellProfileInitials, initials } from "@/components/ShellProfileIdentity";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { ModalDialog, PopoverPanel } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { beforeSessionChange } from "@/lib/session-change";
import { basePaletteCommands, type PaletteCommand } from "@/lib/command-palette";
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
  timelineStateFromSearchParams
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
    openManualEntry,
    refresh,
    startTimer,
    toggleTimer
  } = useAppShellRuntime();
  const shellIdentity = data ? { userName: data.user.name, workspaceName: data.workspace.name } : null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const goToPending = useRef(false);
  const goToTimer = useRef<number | undefined>(undefined);
  const isTimeline = pathname === "/timeline";
  const activeSection = activeShellSection(pathname);
  const libraryTab = activeLibraryTab(pathname);
  const reviewCount = data?.stats.reviewCount ?? 0;
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
  const navigatePeriod = useCallback(async (direction: "previous" | "next") => {
    if (pathname !== "/timeline") return;
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

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalDialog description="Use these shortcuts from Dayframe screens when you are not typing in a field." onClose={onClose} title="Keyboard shortcuts">
      <div className="swiss-shortcut-list">
        {shortcuts.map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}
      </div>
    </ModalDialog>
  );
}
