"use client";

import { useState } from "react";
import type { ClockFormat } from "@dayframe/shared";
import { displayTypedTime, maskTimeInput, parseTimeInput } from "@/lib/calendar-grid";

/**
 * The app's one typed time field (UI review round 2, owner 30 Oct 2026): the same text field as the block editor's
 * Start and End, never the browser's own time picker. It takes and gives `HH:MM` (24-hour, or "" for none), shows the
 * time in this browser's clock format, keeps exactly what is typed while it has focus (masked as the editor masks
 * it), and reads it on blur with the shared parser (`930`, `9:30 pm`, `21:30`); a time it can't read goes back to the
 * last good one. Styled by `.df-time-field`: fill-led, no border, the control height.
 */
export function TimeField({
  clock,
  describedBy,
  disabled,
  invalid,
  label,
  onChange,
  placeholder = "08:30",
  value
}: {
  clock: ClockFormat;
  describedBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** The field's accessible name ("Start time"). */
  label: string;
  onChange: (value: string) => void;
  /** An `HH:MM` example, shown in this browser's clock format. */
  placeholder?: string;
  value: string;
}) {
  // What is typed while the field has focus; null shows the value.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-label={label}
      autoComplete="off"
      className="df-time-field"
      disabled={disabled}
      inputMode={clock === "12h" ? "text" : "numeric"}
      onBlur={() => {
        if (typed !== null) {
          const parsed = parseTimeInput(typed);
          if (parsed) onChange(parsed);
          else if (!typed.trim()) onChange("");
        }
        setTyped(null);
      }}
      onChange={(event) => setTyped(maskTimeInput(event.target.value))}
      onFocus={() => setTyped(displayTypedTime(value, clock))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      placeholder={displayTypedTime(placeholder, clock)}
      type="text"
      value={typed ?? displayTypedTime(value, clock)}
    />
  );
}
