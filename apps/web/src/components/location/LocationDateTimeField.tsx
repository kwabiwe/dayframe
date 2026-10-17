"use client";

import { useId, useState } from "react";
import type { ClockFormat } from "@dayframe/shared";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { displayTypedTime, maskTimeInput, parseTimeInput } from "@/lib/calendar-grid";
import { dateTimeLocalInputToIso } from "@/lib/format";

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
  const status = locationDateTimeStatus(value, typed, today);
  const readable = status === "ok";
  const errorId = `${id}-error`;
  // The parent hears the value and whether it can be sent, by the same rule this field shows.
  const report = (nextValue: string, nextTyped: string | null) =>
    onChange(nextValue, locationDateTimeStatus(nextValue, nextTyped, today) === "ok");

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
          onChange={(next) => report(`${next}T${(typed !== null ? parseTimeInput(typed) : null) ?? time}`, typed)}
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
            // Emptying a field that had no time leaves it empty (nothing is sent for it).
            report(next.trim() === "" && !time ? "" : `${date}T${parseTimeInput(next) ?? time}`, next);
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
          {status === "nonexistent"
            ? "That time doesn’t exist on this day (the clocks went forward). Choose another."
            : `Enter a time like ${displayTypedTime("09:30", clock)}.`}
        </span>
      )}
    </div>
  );
}

/**
 * Whether a Start / End field can be sent (Codex r1/r2 on #474): an empty field can (nothing is
 * sent for it); a day without a time, a time that cannot be read, or a local time the day does not
 * have (the hour the clocks skip) cannot, and say why.
 */
export function locationDateTimeStatus(value: string, typed: string | null, today: string) {
  const time = value.slice(11, 16);
  const text = typed ?? time;
  if (text.trim() === "") return value === "" ? "ok" : time ? "unreadable" : "missing";
  const parsed = parseTimeInput(text);
  if (!parsed) return "unreadable";
  return dateTimeLocalInputToIso(`${value.slice(0, 10) || today}T${parsed}`) ? "ok" : "nonexistent";
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
