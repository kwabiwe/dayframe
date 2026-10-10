"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { prefersReducedMotion, springTransition } from "@/lib/blocks-motion";
import { SHELL_SECTIONS, type ShellSectionId } from "@/lib/shell-nav";

function reviewLabel(count: number) {
  return `Review, ${count} to review`;
}

/**
 * The sidebar's five sections with one sliding neutral thumb. The thumb is the only animated
 * element: its first placement is still, later moves use the `snap` spring as a CSS transition
 * (which retargets from wherever it is when the route changes again), and Reduce Motion moves it
 * without travel. Pages outside the five sections (Settings) fade the thumb out.
 */
export function ShellSidebarNav({ activeId, reviewCount }: { activeId: ShellSectionId | null; reviewCount: number }) {
  const navRef = useRef<HTMLElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placedRef = useRef(false);

  useLayoutEffect(() => {
    const thumb = thumbRef.current;
    const nav = navRef.current;
    if (!thumb || !nav) return;
    const link = activeId ? nav.querySelector<HTMLElement>(`[data-section="${activeId}"]`) : null;
    if (!link) {
      thumb.style.opacity = "0";
      return;
    }
    const reduced = prefersReducedMotion();
    if (placedRef.current && !reduced) {
      const { easing, durationMs } = springTransition("snap");
      thumb.style.transition = `transform ${durationMs}ms ${easing}, opacity 140ms ease-out`;
    } else {
      thumb.style.transition = placedRef.current ? "opacity 140ms ease-out" : "none";
    }
    thumb.style.height = `${link.offsetHeight}px`;
    thumb.style.transform = `translateY(${link.offsetTop}px)`;
    thumb.style.opacity = "1";
    placedRef.current = true;
  }, [activeId]);

  // The sidebar is hidden at phone widths, where nothing can be measured; widening the window
  // places the thumb again without travel.
  useLayoutEffect(() => {
    function place() {
      const thumb = thumbRef.current;
      const link = activeId ? navRef.current?.querySelector<HTMLElement>(`[data-section="${activeId}"]`) : null;
      if (!thumb || !link || link.offsetHeight === 0) return;
      thumb.style.transition = "none";
      thumb.style.height = `${link.offsetHeight}px`;
      thumb.style.transform = `translateY(${link.offsetTop}px)`;
    }
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [activeId]);

  return (
    <nav ref={navRef} className="df-nav" aria-label="Main navigation">
      <span ref={thumbRef} className="df-nav-thumb" aria-hidden="true" />
      {SHELL_SECTIONS.map((section) => {
        const active = section.id === activeId;
        const count = section.id === "review" ? reviewCount : 0;
        return (
          <Link
            key={section.id}
            href={section.href}
            data-section={section.id}
            aria-current={active ? "page" : undefined}
            aria-label={count > 0 ? reviewLabel(count) : undefined}
          >
            <DayframeIcon glyph={section.glyph} size={19} />
            <span>{section.label}</span>
            {count > 0 ? <span className="df-nav-count" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Below 860 px the sections move to a glass bar along the bottom edge. */
export function ShellTabBar({ activeId, reviewCount }: { activeId: ShellSectionId | null; reviewCount: number }) {
  return (
    <nav className="df-tabbar" aria-label="Main navigation">
      {SHELL_SECTIONS.map((section) => {
        const active = section.id === activeId;
        const count = section.id === "review" ? reviewCount : 0;
        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={active ? "page" : undefined}
            aria-label={count > 0 ? reviewLabel(count) : undefined}
          >
            <span className="df-tab-icon">
              <DayframeIcon glyph={section.glyph} size={22} />
              {count > 0 ? <span className="df-tab-count" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
            </span>
            <span>{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
