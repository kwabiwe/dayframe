"use client";

import { useEffect, useRef } from "react";
import { springTransition } from "@/lib/blocks-motion";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Rolling timer digits (motion.md: "Rolling digits", the `roll` spring). Each digit is a
 * vertical strip that moves to its value; unchanged digits stay still and separators never
 * move. Positions are keyed from the right, so "9:59" → "10:00" keeps the seconds in place.
 * The spring is a CSS transition set after mount; Reduce Motion turns it off in CSS. The
 * strips are hidden from assistive technology; the owner provides the spoken value.
 */
export function Odometer({ className, value }: { className?: string; value: string }) {
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const { easing, durationMs } = springTransition("roll");
    root.style.setProperty("--df-roll-easing", easing);
    root.style.setProperty("--df-roll-ms", `${durationMs}ms`);
  }, []);

  const characters = Array.from(value);
  return (
    <span ref={rootRef} className={["df-odometer", className].filter(Boolean).join(" ")} aria-hidden="true">
      {characters.map((character, index) => {
        const key = characters.length - index;
        if (!/\d/.test(character)) return <span key={`s${key}`} className="df-odometer-sep">{character}</span>;
        return (
          <span key={`d${key}`} className="df-odometer-digit">
            <span className="df-odometer-strip" style={{ transform: `translateY(-${Number(character) * 10}%)` }}>
              {DIGITS.map((digit) => <span key={digit}>{digit}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
