"use client";

import { useId, useState } from "react";
import type { ClockFormat } from "@dayframe/shared";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { displayTypedTime, maskTimeInput, parseTimeInput } from "@/lib/calendar-grid";

/**
 * Location evidence's Start / End (UI audit WUI-042): the shared date picker plus a typed time that
 * reads either clock and shows in this browser's 12 / 24-hour setting, as every other web time field
 * (it used to be a native `datetime-local`, which ignores that setting). `value` is a local
 * `YYYY-MM-DDTHH:MM`; `onChange` reports the newest value and whether its typed time can be read
 * (an unreadable time keeps the last readable one in `value`, so nothing guesses a time).
 */
export function LocationDateTimeField({
  clock,
  disabled,
  label,
  onChange,
  today,
  value
}: {
  clock: ClockFormat;
  disabled?: boolean;
  label: string;
  onChange: (value: string, readable: boolean) => void;
  today: string;
  value: string;
}) {
  const id = useId();
  const date = value.slice(0, 10) || today;
  const time = value.slice(11, 16);
  // What is being typed; null shows the value in the clock setting.
  const [typed, setTyped] = useState<string | null>(null);
  const readable = typed === null || parseTimeInput(typed) !== null;
  const errorId = `${id}-error`;

  return (
    <div className="location-resolve-field">
      <span id={`${id}-label`}>{label}</span>
      <div className="location-resolve-datetime">
        <DatePickerPopover
          ariaLabel={`Choose ${label} date, currently ${formatAccessibleDate(date)}`}
          className="location-resolve-date"
          disabled={disabled}
          label={formatShortDate(date)}
          max={today}
          onChange={(next) => onChange(`${next}T${(typed !== null ? parseTimeInput(typed) : null) ?? time}`, readable)}
          panelLabel={`Choose ${label} date`}
          portal
          today={today}
          triggerClassName="location-resolve-control location-resolve-date-trigger"
          value={date}
        />
        <input
          aria-describedby={readable ? undefined : errorId}
          aria-invalid={readable ? undefined : true}
          aria-label={`${label} time`}
          className="location-resolve-control location-resolve-time tabular"
          disabled={disabled}
          inputMode={clock === "12h" ? "text" : "numeric"}
          onBlur={() => {
            // A readable time settles into the clock setting; an unreadable one stays as typed.
            if (typed !== null && parseTimeInput(typed) !== null) setTyped(null);
          }}
          onChange={(event) => {
            const next = maskTimeInput(event.target.value);
            setTyped(next);
            const parsed = parseTimeInput(next);
            onChange(`${date}T${parsed ?? time}`, parsed !== null);
          }}
          onFocus={() => {
            if (typed === null) setTyped(displayTypedTime(time, clock));
          }}
          placeholder={displayTypedTime("09:30", clock)}
          type="text"
          value={typed ?? displayTypedTime(time, clock)}
        />
      </div>
      {readable ? null : (
        <span className="location-resolve-error" id={errorId} role="alert">
          Enter a time like {displayTypedTime("09:30", clock)}.
        </span>
      )}
    </div>
  );
}

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day, 12) : null;
}

function formatShortDate(value: string) {
  const date = localDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(date) : value;
}

function formatAccessibleDate(value: string) {
  const date = localDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date) : value;
}
