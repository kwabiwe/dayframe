"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  CalendarRange,
  Clock3,
  FolderKanban,
  Inbox,
  ListFilter,
  LogOut,
  MapPin,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
  Workflow
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/timeline", label: "Timeline", icon: CalendarRange },
  { href: "/entries", label: "Entries", icon: ListFilter },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/automation", label: "Automation", icon: Workflow },
  { href: "/review", label: "Review", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const authScreen = pathname === "/login" || pathname === "/signup";

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

  function toggleTheme() {
    const nextTheme = themeMode === "dark" ? "light" : "dark";
    window.localStorage.setItem("dayframe.theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    setThemeMode(nextTheme);
    window.dispatchEvent(new Event("dayframe-theme-change"));
  }

  if (authScreen) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="border-b border-[var(--line)] bg-[var(--surface)] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center border border-[var(--accent)] bg-[var(--surface-inset)] text-[var(--accent)]">
                <Clock3 size={18} strokeWidth={2} />
              </span>
              <span>
                <span className="block text-lg font-semibold leading-tight">Dayframe</span>
                <span className="block text-xs text-[var(--muted)]">Personal workspace</span>
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <button
                className="focus-ring grid h-9 w-9 place-items-center border border-[var(--line-strong)] bg-[var(--surface-inset)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                type="button"
                aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                onClick={toggleTheme}
              >
                {themeMode === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              <Link
                className="focus-ring grid h-9 w-9 place-items-center border border-[var(--line-strong)] bg-[var(--surface-inset)] text-[var(--foreground)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                href="/logout"
                aria-label="Log out"
                title="Log out"
              >
                <LogOut size={17} />
              </Link>
              <SlidersHorizontal className="lg:hidden" size={20} />
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:block lg:space-y-1 lg:overflow-visible">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "focus-ring flex min-w-fit items-center gap-3 border px-3 py-2 text-sm",
                    active
                      ? "border-[var(--accent)] bg-[var(--surface-inset)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--foreground)]"
                  ].join(" ")}
                >
                  <Icon size={17} strokeWidth={1.9} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
