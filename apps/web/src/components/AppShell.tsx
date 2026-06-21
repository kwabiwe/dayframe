"use client";

import { useEffect } from "react";
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
  MapPin,
  Settings,
  SlidersHorizontal,
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

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const storedTheme = window.localStorage.getItem("dayframe.theme");
      if (storedTheme === "light" || storedTheme === "dark") {
        document.documentElement.dataset.theme = storedTheme;
      } else {
        delete document.documentElement.dataset.theme;
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

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="border-b border-[var(--line)] bg-[var(--surface)] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 lg:block">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center border border-[var(--accent)] bg-[var(--surface-inset)] text-[var(--accent)]">
                <Clock3 size={18} strokeWidth={2} />
              </span>
              <span>
                <span className="block text-lg font-semibold leading-tight">Dayframe</span>
                <span className="block text-xs text-[var(--muted)]">Personal workspace</span>
              </span>
            </Link>
            <SlidersHorizontal className="lg:hidden" size={20} />
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
