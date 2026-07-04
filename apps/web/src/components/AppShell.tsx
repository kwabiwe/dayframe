"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Command,
  FileText,
  Folder,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  ListFilter,
  LogOut,
  MapPin,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Workflow,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BootstrapData } from "@/lib/queries";
import { formatDuration, formatEventLabel, formatSourceLabel, formatTime } from "@/lib/format";

type Overlay = "search" | "notifications" | "profile" | "help" | "workspace" | null;

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/timeline", label: "Timeline", icon: CalendarRange },
  { href: "/entries", label: "Entries", icon: ListFilter },
  { href: "/categories", label: "Categories", icon: FileText },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/automation", label: "Automation", icon: Workflow },
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [data, setData] = useState<BootstrapData | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [query, setQuery] = useState("");
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const authScreen = pathname === "/login" || pathname === "/signup";
  const selectedDate = searchParams.get("date") ?? dateKey(new Date());

  const refreshShellData = useCallback(async () => {
    if (authScreen) return;
    const response = await fetch(`/api/bootstrap?date=${selectedDate}`, { cache: "no-store" });
    if (response.ok) setData((await response.json()) as BootstrapData);
  }, [authScreen, selectedDate]);

  useEffect(() => {
    if (authScreen) return undefined;
    let cancelled = false;

    fetch(`/api/bootstrap?date=${selectedDate}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: BootstrapData | null) => {
        if (!cancelled && payload) setData(payload);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [authScreen, selectedDate]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const stored = window.localStorage.getItem("dayframe.readNotifications");
      setReadNotifications(stored ? JSON.parse(stored) : []);
    }, 0);

    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const frame = window.requestAnimationFrame(applyTheme);

    function applyTheme() {
      const storedTheme = window.localStorage.getItem("dayframe.theme");
      if (storedTheme === "light" || storedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", storedTheme);
        setThemeMode(storedTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
        setThemeMode(media.matches ? "dark" : "light");
      }
    }

    window.addEventListener("storage", applyTheme);
    window.addEventListener("dayframe-theme-change", applyTheme);
    media.addEventListener("change", applyTheme);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("storage", applyTheme);
      window.removeEventListener("dayframe-theme-change", applyTheme);
      media.removeEventListener("change", applyTheme);
    };
  }, []);

  const notifications = useMemo(() => buildNotifications(data), [data]);
  const unreadCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;
  const searchResults = useMemo(() => buildSearchResults(data, query), [data, query]);

  const navigateDate = useCallback(
    (date: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", date);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

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
        void toggleTimer(data, refreshShellData);
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        window.dispatchEvent(new Event("dayframe-add-time-block"));
        if (pathname !== "/") router.push(`/?date=${selectedDate}`);
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        navigateDate(previousDate);
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        navigateDate(nextDate);
        return;
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [data, navigateDate, nextDate, pathname, previousDate, refreshShellData, router, selectedDate]);

  function toggleTheme() {
    const nextTheme = themeMode === "dark" ? "light" : "dark";
    window.localStorage.setItem("dayframe.theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    setThemeMode(nextTheme);
    window.dispatchEvent(new Event("dayframe-theme-change"));
  }

  function markNotificationsRead() {
    const ids = notifications.map((item) => item.id);
    window.localStorage.setItem("dayframe.readNotifications", JSON.stringify(ids));
    setReadNotifications(ids);
  }

  if (authScreen) return <>{children}</>;

  return (
    <div className="swiss-app-shell">
      <aside className="swiss-sidebar">
        <Link href="/" className="swiss-brand" aria-label="Dayframe dashboard">
          <Image
            className="swiss-brand-banner"
            src="/logos/dayframe_logo_banner.png"
            alt="Dayframe"
            width={2172}
            height={724}
            priority
          />
          <Image
            className="swiss-brand-mark"
            src="/logos/dayframe_logo.png"
            alt=""
            aria-hidden="true"
            width={1254}
            height={1254}
            priority
          />
        </Link>
        <nav className="swiss-nav" aria-label="Main navigation">
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
              <small>{data?.user.email ?? "Workspace account"}</small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>

      <div className="swiss-main-frame">
        <header className="swiss-topbar">
          <button type="button" className="swiss-workspace-button" onClick={() => setOverlay("workspace")}>
            <Command size={18} />
            <span>{data?.workspace.name ?? "Workspace"}</span>
            <ChevronDown size={15} />
          </button>
          <div className="swiss-date-switcher">
            <button type="button" aria-label="Previous day" onClick={() => navigateDate(previousDate)}>
              <ChevronLeft size={20} />
            </button>
            <span>{formatLongDate(selectedDate)}</span>
            <button type="button" aria-label="Next day" onClick={() => navigateDate(nextDate)}>
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="swiss-top-actions">
            <button type="button" aria-label="Search" onClick={() => setOverlay("search")}>
              <Search size={22} />
            </button>
            <button
              type="button"
              aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} theme`}
              className="swiss-theme-toggle"
              onClick={toggleTheme}
            >
              {themeMode === "dark" ? <Sun size={21} /> : <Moon size={21} />}
            </button>
            <button
              type="button"
              aria-label="Notifications"
              className={unreadCount > 0 ? "has-unread" : ""}
              onClick={() => {
                setOverlay("notifications");
                markNotificationsRead();
              }}
            >
              <Bell size={22} />
            </button>
            <Link href="/reports" aria-label="Reports">
              <BarChart3 size={22} />
            </Link>
            <button
              type="button"
              aria-label="Help and shortcuts"
              className="swiss-mobile-help-button"
              onClick={() => setOverlay("help")}
            >
              <HelpCircle size={21} />
            </button>
            <button
              type="button"
              aria-label="Profile and account"
              className="swiss-mobile-account-button"
              onClick={() => setOverlay("profile")}
            >
              <span>{initials(data?.user.name ?? "Dayframe User")}</span>
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>

      {overlay === "workspace" && data ? (
        <WorkspacePopover
          data={data}
          onClose={() => setOverlay(null)}
          onSwitched={async () => {
            setOverlay(null);
            await refreshShellData();
            router.refresh();
          }}
        />
      ) : null}
      {overlay === "profile" && data ? (
        <ProfilePopover
          data={data}
          themeMode={themeMode}
          onClose={() => setOverlay(null)}
          onThemeToggle={toggleTheme}
          onUpdated={async () => {
            await refreshShellData();
            router.refresh();
          }}
        />
      ) : null}
      {overlay === "search" ? (
        <SearchPalette
          query={query}
          setQuery={setQuery}
          results={searchResults}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay === "notifications" ? (
        <NotificationsPopover notifications={notifications} onClose={() => setOverlay(null)} />
      ) : null}
      {overlay === "help" ? <HelpDialog onClose={() => setOverlay(null)} /> : null}
    </div>
  );
}

function WorkspacePopover({
  data,
  onClose,
  onSwitched
}: {
  data: BootstrapData;
  onClose: () => void;
  onSwitched: () => Promise<void>;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [name, setName] = useState("");

  async function switchWorkspace(workspaceId: string) {
    setIsBusy(true);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId })
      });
      if (!response.ok) throw new Error(`Unable to switch workspace: ${response.status}`);
      await onSwitched();
    } finally {
      setIsBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setIsBusy(true);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!response.ok) throw new Error(`Unable to create workspace: ${response.status}`);
      await onSwitched();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <FloatingPanel title="Workspace" onClose={onClose} align="top-left">
      <div className="swiss-menu-list">
        {data.workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            disabled={isBusy}
            className={workspace.id === data.workspace.id ? "is-selected" : ""}
            onClick={() => switchWorkspace(workspace.id)}
          >
            <Folder size={18} />
            <span>{workspace.name}</span>
            {workspace.id === data.workspace.id ? <CheckCircle2 size={16} /> : null}
          </button>
        ))}
      </div>
      <form className="swiss-popover-form" onSubmit={createWorkspace}>
        <label>
          New workspace
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" />
        </label>
        <button className="swiss-primary-action" disabled={isBusy || !name.trim()}>
          <Plus size={15} />
          Create workspace
        </button>
      </form>
    </FloatingPanel>
  );
}

function ProfilePopover({
  data,
  themeMode,
  onClose,
  onThemeToggle,
  onUpdated
}: {
  data: BootstrapData;
  themeMode: "light" | "dark";
  onClose: () => void;
  onThemeToggle: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [name, setName] = useState(data.user.name);
  const [workspaceName, setWorkspaceName] = useState(data.workspace.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword && newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          workspaceName,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to update profile.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(newPassword ? "Profile and password updated." : "Profile updated.");
      await onUpdated();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <FloatingPanel title="Profile" onClose={onClose} align="bottom-left">
      <div className="swiss-profile-summary">
        <span>{initials(data.user.name)}</span>
        <div>
          <strong>{data.user.name}</strong>
          <small>{data.user.email}</small>
        </div>
      </div>
      <form className="swiss-popover-form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Workspace name
          <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
        </label>
        <fieldset className="swiss-password-fields">
          <legend>Security</legend>
          <label>
            Current password
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Required to change password"
            />
          </label>
          <label>
            New password
            <input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          <label>
            Confirm new password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
            />
          </label>
        </fieldset>
        {error ? <p className="swiss-form-message is-error">{error}</p> : null}
        {message ? <p className="swiss-form-message">{message}</p> : null}
        <button className="swiss-primary-action" disabled={isBusy}>
          Save profile
        </button>
      </form>
      <button type="button" className="swiss-menu-action" onClick={onThemeToggle}>
        <Settings size={17} />
        Switch to {themeMode === "dark" ? "light" : "dark"} theme
      </button>
      <Link href="/logout" className="swiss-menu-action">
        <LogOut size={17} />
        Log out
      </Link>
    </FloatingPanel>
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
    <div className="swiss-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="swiss-command-palette" role="dialog" aria-modal="true" aria-label="Search Dayframe" onMouseDown={(event) => event.stopPropagation()}>
        <div className="swiss-search-input">
          <Search size={21} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search categories, entries, places, review items"
          />
          <kbd>Esc</kbd>
          <button type="button" className="swiss-command-close" aria-label="Close search" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="swiss-search-results">
          {results.map((result) => {
            const Icon = result.icon;
            return (
              <Link key={result.id} href={result.href} onClick={onClose}>
                <Icon size={19} />
                <span>
                  <strong>{result.label}</strong>
                  <small>{result.detail}</small>
                </span>
                <em>{result.group}</em>
              </Link>
            );
          })}
          {results.length === 0 ? <p>No matching results.</p> : null}
        </div>
      </section>
    </div>
  );
}

function NotificationsPopover({
  notifications,
  onClose
}: {
  notifications: NotificationItem[];
  onClose: () => void;
}) {
  return (
    <FloatingPanel title="Notifications" onClose={onClose} align="top-right">
      <div className="swiss-notification-list">
        {notifications.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href} onClick={onClose}>
              <Icon size={18} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </Link>
          );
        })}
        {notifications.length === 0 ? <p>No notifications.</p> : null}
      </div>
    </FloatingPanel>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="swiss-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="swiss-help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="swiss-dialog-title">
          <div>
            <h2 id="help-title">Help & Shortcuts</h2>
            <p>Use these shortcuts from Dayframe screens when you are not typing in a field.</p>
          </div>
          <button type="button" aria-label="Close help" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="swiss-shortcut-list">
          {shortcuts.map(([keys, action]) => (
            <div key={keys}>
              <kbd>{keys}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FloatingPanel({
  title,
  align,
  onClose,
  children
}: {
  title: string;
  align: "top-left" | "top-right" | "bottom-left";
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="swiss-floating-layer" role="presentation" onMouseDown={onClose}>
      <section
        className={`swiss-floating-panel ${align}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="swiss-floating-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
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

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
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
    ...data.automationRules.map((rule) => ({
      id: `automation:${rule.id}`,
      label: rule.name,
      detail: `${rule.triggerSource} -> ${rule.action}`,
      group: "Automation",
      href: "/automation",
      icon: Workflow
    })),
    ...data.entries.slice(0, 40).map((entry) => ({
      id: `entry:${entry.id}`,
      label: entry.description ?? entry.categoryName ?? "Time entry",
      detail: `${formatTime(entry.startedAt)} · ${formatDuration(entry.durationSeconds)}`,
      group: "Entry",
      href: "/entries",
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
  return results
    .filter((result) => `${result.label} ${result.detail} ${result.group}`.toLowerCase().includes(needle))
    .slice(0, 12);
}

function buildNotifications(data: BootstrapData | null): NotificationItem[] {
  if (!data) return [];
  const items: NotificationItem[] = [];
  if (data.activeEntry) {
    items.push({
      id: `active:${data.activeEntry.id}`,
      title: data.activeEntry.description ?? data.activeEntry.categoryName ?? "Timer running",
      detail: `Started ${formatTime(data.activeEntry.startedAt)}`,
      href: "/",
      icon: Clock3
    });
  }
  for (const item of data.reviewItems.filter((review) => review.status === "open").slice(0, 5)) {
    items.push({
      id: `review:${item.id}`,
      title: item.title,
      detail: item.confidence,
      href: "/review",
      icon: Inbox
    });
  }
  for (const event of data.activityEvents.slice(0, 3)) {
    items.push({
      id: `event:${event.id}`,
      title: formatEventLabel(event.eventType),
      detail: `${formatSourceLabel(event.source)} · ${formatTime(event.occurredAt)}`,
      href: "/entries",
      icon: Activity
    });
  }
  return items;
}

async function toggleTimer(data: BootstrapData | null, refresh: () => Promise<void>) {
  if (!data) return;
  const active = data.activeEntry;
  const category = data.categories[0];
  if (!active && !category) return;
  await fetch("/api/time-entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      active
        ? { mode: "stop" }
        : {
            mode: "start",
            categoryId: category?.id
          }
    )
  });
  await refresh();
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
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
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
