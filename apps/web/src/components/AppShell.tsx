"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  MapPin,
  Search,
  Settings,
  Tags,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShellRuntimeProvider, useAppShellRuntime } from "@/components/AppShellRuntime";
import { DayframeBrand } from "@/components/brand/DayframeBrand";
import { PersistentTimerBar } from "@/components/PersistentTimerBar";
import { SignOutControl } from "@/components/SignOutControl";
import { Button, IconButton, ModalDialog, PopoverPanel } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { timeEntryTitle } from "@/lib/display";
import { formatDuration, formatTime } from "@/lib/format";
import type { BootstrapData } from "@/lib/queries";

type Overlay = "search" | "profile" | "help" | null;

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/timeline", label: "Timeline", icon: CalendarRange },
  { href: "/categories", label: "Categories", icon: FileText },
  { href: "/tags", label: "Tags", icon: Tags },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/review", label: "Review", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings }
];

const shortcuts = [
  ["Cmd/Ctrl+K", "Open search"],
  ["?", "Open Help & Shortcuts"],
  ["Shift+Space", "Start or stop timer"],
  ["N", "Add time block"],
  ["Alt+Left", "Previous day"],
  ["Alt+Right", "Next day"],
  ["Esc", "Close menus"]
];

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
    openManualEntry,
    refresh,
    selectedDate,
    toggleTimer
  } = useAppShellRuntime();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [query, setQuery] = useState("");
  const showTimerShell = pathname === "/" || pathname === "/timeline";
  const searchResults = useMemo(() => buildSearchResults(data, query), [data, query]);

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
    if (!showTimerShell) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", date);
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams, showTimerShell]);

  const previousDate = addDaysKey(selectedDate, -1);
  const nextDate = addDaysKey(selectedDate, 1);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverlay(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOverlay("search");
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setOverlay("help");
        return;
      }
      if (event.shiftKey && event.code === "Space") {
        event.preventDefault();
        void toggleTimer();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openManualEntry();
        if (!showTimerShell) router.push(`/?date=${selectedDate}`);
        return;
      }
      if (showTimerShell && event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        navigateDate(previousDate);
        return;
      }
      if (showTimerShell && event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        navigateDate(nextDate);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [navigateDate, nextDate, openManualEntry, previousDate, router, selectedDate, showTimerShell, toggleTimer]);

  return (
    <div className="swiss-app-shell">
      <aside className="swiss-sidebar">
        <div className="swiss-sidebar-head">
          <Link href="/" className="swiss-brand" aria-label="Dayframe dashboard">
            <DayframeBrand decorative size="md" />
          </Link>
          <div className="swiss-mobile-shell-actions">
            <IconButton label="Search" onClick={() => setOverlay("search")}><Search size={19} /></IconButton>
            <IconButton label="Help and shortcuts" onClick={() => setOverlay("help")}><HelpCircle size={19} /></IconButton>
            <button type="button" aria-label="Profile and workspace" className="swiss-mobile-account-button" onClick={() => setOverlay("profile")}>
              <span>{initials(data?.user.name ?? "Dayframe User")}</span>
            </button>
          </div>
        </div>
        <nav className="swiss-nav" aria-label="Main navigation">
          <button type="button" className="swiss-nav-search" onClick={() => setOverlay("search")}>
            <Search size={19} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "is-active" : ""}>
                <Icon size={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="swiss-sidebar-bottom">
          <button type="button" className="swiss-help-link" onClick={() => setOverlay("help")}>
            <HelpCircle size={20} />
            Help & Shortcuts
          </button>
          <button type="button" className="swiss-profile-button" onClick={() => setOverlay("profile")}>
            <span>{initials(data?.user.name ?? "Dayframe User")}</span>
            <span>
              <strong>{data?.user.name ?? "Local User"}</strong>
              <small>{data?.workspace.name ?? "Workspace"}</small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>

      <div className="swiss-main-frame">
        {showTimerShell ? (
          <div className="swiss-persistent-timer-shell">
            <PersistentTimerBar />
            <DateContextRow
              selectedDate={selectedDate}
              onPrevious={() => navigateDate(previousDate)}
              onNext={() => navigateDate(nextDate)}
              onToday={() => navigateDate(dateKey(new Date()))}
            />
          </div>
        ) : null}
        <main>{children}</main>
      </div>

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
        <SearchPalette query={query} setQuery={setQuery} results={searchResults} onClose={() => setOverlay(null)} />
      ) : null}
      {overlay === "help" ? <HelpDialog onClose={() => setOverlay(null)} /> : null}
    </div>
  );
}

function DateContextRow({
  onNext,
  onPrevious,
  onToday,
  selectedDate
}: {
  onNext: () => void;
  onPrevious: () => void;
  onToday: () => void;
  selectedDate: string;
}) {
  const today = dateKey(new Date());
  return (
    <div className="swiss-date-context-row" aria-label="Date navigation">
      <IconButton label="Previous day" onClick={onPrevious}><ChevronLeft size={19} /></IconButton>
      <strong>{formatLongDate(selectedDate)}</strong>
      <IconButton label="Next day" onClick={onNext}><ChevronRight size={19} /></IconButton>
      {selectedDate !== today ? <Button onClick={onToday}>Today</Button> : null}
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
  onClose
}: {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  onClose: () => void;
}) {
  return (
    <ModalDialog ariaLabel="Search Dayframe" onClose={onClose} showClose={false}>
      <div className="swiss-search-input">
        <Search size={21} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories, entries, places, review items" />
        <kbd>Esc</kbd>
        <IconButton label="Close search" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="swiss-search-results">
        {results.map((result) => {
          const Icon = result.icon;
          return (
            <Link key={result.id} href={result.href} onClick={onClose}>
              <Icon size={19} />
              <span><strong>{result.label}</strong><small>{result.detail}</small></span>
              <em>{result.group}</em>
            </Link>
          );
        })}
        {results.length === 0 ? <p>No matching results.</p> : null}
      </div>
    </ModalDialog>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalDialog description="Use these shortcuts from Dayframe screens when you are not typing in a field." onClose={onClose} title="Help & Shortcuts">
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
};

function buildSearchResults(data: BootstrapData | null, query: string): SearchResult[] {
  if (!data) return [];
  const needle = query.trim().toLowerCase();
  const results: SearchResult[] = [
    ...data.categories.map((category) => ({
      id: `category:${category.id}`,
      label: category.name,
      detail: category.isPinned ? "Pinned category" : "Category",
      group: "Category",
      href: "/categories",
      icon: FileText
    })),
    ...data.places.map((place) => ({
      id: `place:${place.id}`,
      label: place.name,
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "D";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "F";
  return `${first}${second}`.toUpperCase();
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
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
