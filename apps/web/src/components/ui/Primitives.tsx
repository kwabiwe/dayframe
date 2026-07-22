"use client";

import {
  ChevronDown,
  X,
  type LucideIcon
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
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
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
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
  return (
    <details className={classNames("ui-disclosure", className)} open={defaultOpen || undefined}>
      <summary>
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
  icon: Icon,
  label
}: {
  action?: ReactNode;
  className?: string;
  detail?: ReactNode;
  icon?: LucideIcon;
  label: string;
}) {
  return (
    <div className={classNames("ui-settings-row", Icon ? "has-icon" : "", className)}>
      {Icon ? <Icon size={18} aria-hidden="true" /> : null}
      <div>
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {action ? <div className="ui-settings-row-action">{action}</div> : null}
    </div>
  );
}

type DialogRole = "dialog" | "alertdialog";

let openDialogCount = 0;

export function ModalDialog({
  ariaLabel,
  busy = false,
  children,
  className,
  contentClassName,
  description,
  footer,
  initialFocusRef,
  onClose,
  role = "dialog",
  showClose = true,
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
  onClose: () => void;
  role?: DialogRole;
  showClose?: boolean;
  title?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    openDialogCount += 1;
    document.documentElement.classList.add("ui-dialog-open");

    const focusHandle = window.requestAnimationFrame(() => {
      const preferred = initialFocusRef?.current;
      const fallback = dialog.querySelector<HTMLElement>(
        "[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]"
      );
      (preferred ?? fallback)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusHandle);
      if (dialog.open) dialog.close();
      openDialogCount = Math.max(0, openDialogCount - 1);
      if (openDialogCount === 0) document.documentElement.classList.remove("ui-dialog-open");
      previouslyFocused?.focus();
    };
  }, [initialFocusRef]);

  function requestClose() {
    if (!busy) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={classNames("ui-dialog", className)}
      role={role}
      aria-modal="true"
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
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

export function PopoverPanel({
  align,
  busy = false,
  children,
  onClose,
  title
}: {
  align: "top-left" | "top-right" | "bottom-left";
  busy?: boolean;
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <ModalDialog
      busy={busy}
      className={classNames("ui-popover-panel", align)}
      contentClassName="ui-popover-content"
      onClose={onClose}
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
