"use client";

import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { DayframeGlyph } from "@dayframe/shared";

import {
  ChevronDown,
  X,
  type LucideIcon
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes
} from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; compact?: boolean }
>(function Button({ className, compact = false, type = "button", variant = "secondary", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classNames(
        "ui-button",
        `ui-button-${variant}`,
        compact ? "is-compact" : "",
        className
      )}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
    label: string;
    variant?: "normal" | "selected" | "danger";
  }
>(function IconButton({ children, className, label, type = "button", variant = "normal", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={label}
      className={classNames("ui-icon-button", `ui-icon-button-${variant}`, className)}
      // Its label as a tooltip on hover and keyboard focus (WUI-014; TooltipHost).
      data-tip={label}
    >
      {children}
    </button>
  );
});

export function Field({
  children,
  className,
  error,
  help,
  htmlFor,
  label
}: {
  children: ReactNode;
  className?: string;
  error?: string | null;
  help?: string;
  htmlFor: string;
  label: string;
}) {
  const helpId = `${htmlFor}-help`;
  const errorId = `${htmlFor}-error`;

  return (
    <div className={classNames("ui-field", className)}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help ? <span className="ui-field-help" id={helpId}>{help}</span> : null}
      {error ? <span className="ui-field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

export function TextField({
  className,
  error,
  help,
  id,
  label,
  compact = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  error?: string | null;
  help?: string;
  id: string;
  label: string;
  compact?: boolean;
}) {
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field error={error} help={help} htmlFor={id} label={label}>
      <input
        {...props}
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={classNames("ui-control", compact ? "is-compact" : "", className)}
      />
    </Field>
  );
}

export function SelectField({
  className,
  id,
  label,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Field htmlFor={id} label={label}>
      <select {...props} id={id} className={classNames("ui-control", className)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode; disabled?: boolean }>;
  value: T;
}) {
  return (
    <div className={classNames("ui-segmented-control", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Disclosure({
  children,
  className,
  defaultOpen = false,
  summary
}: {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  summary: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details className={classNames("ui-disclosure", className)} open={open || undefined}>
      <summary
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span>{summary}</span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="ui-disclosure-content">{children}</div>
    </details>
  );
}

export function SettingsRow({
  action,
  className,
  detail,
  glyph,
  icon: Icon,
  label
}: {
  action?: ReactNode;
  className?: string;
  detail?: ReactNode;
  /** A Dayframe thing (places, export, history…) draws its registry glyph; generic rows may use lucide. */
  glyph?: DayframeGlyph;
  icon?: LucideIcon;
  label: string;
}) {
  return (
    <div className={classNames("ui-settings-row", Icon || glyph ? "has-icon" : "", className)}>
      {glyph ? <DayframeIcon glyph={glyph} size={18} /> : Icon ? <Icon size={18} aria-hidden="true" /> : null}
      <div>
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {action ? <div className="ui-settings-row-action">{action}</div> : null}
    </div>
  );
}

type DialogRole = "dialog" | "alertdialog";
/** Anchored popovers, menus and lists become bottom sheets at this width (WUI-026). */
export const POPOVER_SHEET_QUERY = "(max-width: 560px)";

function isPopoverSheet() {
  return typeof window.matchMedia === "function" && window.matchMedia(POPOVER_SHEET_QUERY).matches;
}

function subscribeToPopoverSheet(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(POPOVER_SHEET_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  media.addListener?.(onChange);
  return () => media.removeListener?.(onChange);
}
/** Width tiers (web UI audit WUI-021): confirm 400, compact 520, form 620, wide 720. */
export type DialogSize = "confirm" | "compact" | "form" | "wide";

let openDialogCount = 0;

/**
 * The dialog's exit (WUI-020): hosts unmount a ModalDialog to close it, so its last frame is
 * copied into an inert, hidden-from-assistive-technology twin that fades out over the page in
 * 120 ms (opacity only under Reduce Motion, in the same 120 ms) and is then removed. The real
 * dialog has already closed, so focus and the page's interactivity return at once.
 */
/** Scroll offsets inside a dialog, by position in `[dialog, ...descendants]` (only non-zero ones). */
export type DialogScrollSnapshot = Array<[index: number, top: number, left: number]>;

/** Reads the dialog's scroll offsets while it is still laid out (a detached copy has none). */
export function captureDialogScroll(dialog: HTMLElement): DialogScrollSnapshot {
  const snapshot: DialogScrollSnapshot = [];
  [dialog, ...dialog.querySelectorAll<HTMLElement>("*")].forEach((element, index) => {
    if (element.scrollTop || element.scrollLeft) snapshot.push([index, element.scrollTop, element.scrollLeft]);
  });
  return snapshot;
}

export function playDialogExit(dialog: HTMLDialogElement, scroll: DialogScrollSnapshot = [], withScrim = true) {
  if (typeof document === "undefined" || !dialog.hasAttribute("open")) return;
  const ghost = dialog.cloneNode(true) as HTMLDialogElement;
  // Typed values are properties, not attributes: carry them over so fields do not blank.
  const sources = dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  const copies = ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  sources.forEach((source, index) => {
    const copy = copies[index];
    if (!copy) return;
    if (copy instanceof HTMLInputElement && source instanceof HTMLInputElement && (source.type === "checkbox" || source.type === "radio")) copy.checked = source.checked;
    else copy.value = source.value;
  });
  for (const element of [ghost, ...ghost.querySelectorAll("[id]")]) element.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.classList.add("ui-dialog-ghost");
  ghost.setAttribute("open", "");
  const scrim = document.createElement("div");
  scrim.className = "ui-dialog-ghost-scrim";
  // One inert, hidden layer holds the scrim and the copy. The outgoing dialog was the topmost layer,
  // so the copy joins the top layer as a manual popover, above any dialog still open (a nested
  // dialog closing over another fades in place, not behind it; Codex r1 on #487).
  const layer = document.createElement("div");
  layer.className = "ui-dialog-ghost-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  // A non-modal popover had no scrim, so its copy fades alone (Codex r1 on #492).
  if (withScrim) layer.append(scrim);
  layer.append(ghost);
  document.body.append(layer);
  if (typeof layer.showPopover === "function") {
    layer.popover = "manual";
    layer.showPopover();
  }
  // The frame as it was: the copy is scrolled where the dialog was.
  const nodes = [ghost, ...ghost.querySelectorAll<HTMLElement>("*")];
  for (const [index, top, left] of scroll) {
    const copy = nodes[index];
    if (!copy) continue;
    copy.scrollTop = top;
    copy.scrollLeft = left;
  }
  window.setTimeout(() => layer.remove(), 160);
}

export function ModalDialog({
  ariaLabel,
  busy = false,
  children,
  className,
  contentClassName,
  description,
  footer,
  initialFocusRef,
  modal = true,
  onClose,
  outsidePressIgnore,
  role = "dialog",
  showClose = true,
  size,
  title
}: {
  ariaLabel?: string;
  busy?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  description?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * false: a non-modal popover (web UI audit WUI-022): no scrim, the page stays usable, and a press
   * outside it, Escape or focus leaving it closes it; focus returns to the opener only when it
   * would otherwise be lost.
   */
  modal?: boolean;
  onClose: () => void;
  /** A non-modal popover's opener: a press on it is the opener's own toggle, not an outside press. */
  outsidePressIgnore?: string;
  role?: DialogRole;
  showClose?: boolean;
  /** Defaults to `confirm` for an alert dialog and `form` otherwise. */
  size?: DialogSize;
  title?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const exitScrollRef = useRef<DialogScrollSnapshot>([]);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });
  const titleId = useId();
  const descriptionId = useId();

  // A layout cleanup runs while the dialog is still laid out, before an unmount removes it: the
  // exit's copy is scrolled from what it records.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog) exitScrollRef.current = captureDialogScroll(dialog);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeFromOutside = () => {
      if (!busyRef.current) closeRef.current();
    };
    const isOpener = (target: EventTarget | null) =>
      Boolean(outsidePressIgnore && target instanceof Element && target.closest(outsidePressIgnore));
    const onOutsidePress = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || dialog.contains(target) || isOpener(target)) return;
      closeFromOutside();
    };
    // The opener closes the popover itself (busy-aware) and its own click never reaches the page,
    // so a press on it never closes and reopens it (Codex r1 on #492).
    const onOpenerClick = (event: MouseEvent) => {
      if (!isOpener(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      closeFromOutside();
    };
    const onDocumentKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeFromOutside();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && !dialog.contains(next) && !isOpener(next)) closeFromOutside();
    };
    if (modal) {
      if (!dialog.open) dialog.showModal();
      openDialogCount += 1;
      document.documentElement.classList.add("ui-dialog-open");
    } else {
      if (!dialog.open) dialog.show();
      document.addEventListener("pointerdown", onOutsidePress, true);
      document.addEventListener("click", onOpenerClick, true);
      document.addEventListener("keydown", onDocumentKey);
      dialog.addEventListener("focusout", onFocusOut);
    }

    const focusHandle = window.requestAnimationFrame(() => {
      const preferred = initialFocusRef?.current;
      const fallback = dialog.querySelector<HTMLElement>(
        "[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]"
      );
      (preferred ?? fallback)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusHandle);
      // A real close (the host unmounted it) fades out; a re-run while still mounted does not.
      // jsdom draws nothing, so there the copy would only duplicate the dialog for DOM queries.
      if (!dialog.isConnected && !navigator.userAgent.includes("jsdom")) playDialogExit(dialog, exitScrollRef.current, modal);
      if (dialog.open) dialog.close();
      if (modal) {
        openDialogCount = Math.max(0, openDialogCount - 1);
        if (openDialogCount === 0) document.documentElement.classList.remove("ui-dialog-open");
        previouslyFocused?.focus();
        return;
      }
      document.removeEventListener("pointerdown", onOutsidePress, true);
      document.removeEventListener("click", onOpenerClick, true);
      document.removeEventListener("keydown", onDocumentKey);
      dialog.removeEventListener("focusout", onFocusOut);
      // A press elsewhere put focus where it landed; only lost focus goes back to the opener.
      const active = document.activeElement;
      if (!active || active === document.body || dialog.contains(active)) previouslyFocused?.focus();
    };
  }, [initialFocusRef, modal, outsidePressIgnore]);

  function requestClose() {
    if (!busy) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={classNames("ui-dialog", `ui-dialog--${size ?? (role === "alertdialog" ? "confirm" : "form")}`, className)}
      role={role}
      aria-modal={modal ? "true" : undefined}
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        requestClose();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) requestClose();
      }}
    >
      {title ? (
        <header className="ui-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {showClose ? (
            <IconButton label={`Close ${title}`} onClick={requestClose} disabled={busy}>
              <X size={19} aria-hidden="true" />
            </IconButton>
          ) : null}
        </header>
      ) : null}
      <div className={classNames("ui-dialog-content", contentClassName)}>{children}</div>
      {footer ? <footer className="ui-dialog-actions">{footer}</footer> : null}
    </dialog>
  );
}

/**
 * An anchored popover (web UI audit WUI-022/WUI-026): non-modal beside its opener on wider
 * screens (no scrim; a press outside, Escape or focus leaving closes it); at ≤560 px a modal bottom
 * sheet over the scrim with a grabber and ✕. Decided when it opens.
 */
export function PopoverPanel({
  align,
  busy = false,
  children,
  onClose,
  outsidePressIgnore,
  title
}: {
  align: "top-left" | "top-right" | "bottom-left";
  busy?: boolean;
  children: ReactNode;
  onClose: () => void;
  outsidePressIgnore?: string;
  title: string;
}) {
  // Follows the viewport while open: crossing 560 px swaps the anchored popover and the sheet
  // (Codex r1 on #492).
  const sheet = useSyncExternalStore(subscribeToPopoverSheet, isPopoverSheet, () => false);
  return (
    <ModalDialog
      busy={busy}
      className={classNames("ui-popover-panel", align, sheet ? "is-sheet" : "is-anchored")}
      contentClassName="ui-popover-content"
      modal={sheet}
      onClose={onClose}
      outsidePressIgnore={outsidePressIgnore}
      title={title}
    >
      {children}
    </ModalDialog>
  );
}

export function IconLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="ui-icon-label">
      <Icon size={16} aria-hidden="true" />
      {children}
    </span>
  );
}

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
