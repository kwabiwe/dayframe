"use client";

import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

export function ReportDonutSegment({
  ariaLabel,
  className,
  dash,
  href,
  offset,
  onFocusChange,
  onHighlight,
  radius,
  stroke,
  totalLength
}: {
  ariaLabel: string;
  className: string;
  dash: number;
  href: string;
  offset: number;
  /** Keyboard focus arriving (true) or leaving (false), for a focus ring drawn beside the slice. */
  onFocusChange?: (focused: boolean) => void;
  /** Hover or focus (true) and their end (false), for cross-highlighting; each source is tracked apart. */
  onHighlight?: (on: boolean, source: "hover" | "focus") => void;
  radius: number;
  stroke: string;
  totalLength: number;
}) {
  const router = useRouter();

  function activate() {
    router.push(href);
  }

  function handleKeyDown(event: KeyboardEvent<SVGCircleElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  }

  return (
    <circle
      role="link"
      tabIndex={0}
      aria-label={ariaLabel}
      className={className}
      cx="60"
      cy="60"
      r={radius}
      pathLength={totalLength}
      stroke={stroke}
      strokeDasharray={`${dash} ${totalLength - dash}`}
      strokeDashoffset={offset}
      onBlur={() => {
        onHighlight?.(false, "focus");
        onFocusChange?.(false);
      }}
      onClick={activate}
      onFocus={() => {
        onHighlight?.(true, "focus");
        onFocusChange?.(true);
      }}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onHighlight?.(true, "hover")}
      onMouseLeave={() => onHighlight?.(false, "hover")}
    />
  );
}
