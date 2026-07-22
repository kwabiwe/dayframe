"use client";

import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

export function ReportDonutSegment({
  ariaLabel,
  className,
  dash,
  href,
  offset,
  radius,
  stroke,
  totalLength
}: {
  ariaLabel: string;
  className: string;
  dash: number;
  href: string;
  offset: number;
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
      onClick={activate}
      onKeyDown={handleKeyDown}
    />
  );
}
