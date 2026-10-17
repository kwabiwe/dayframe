import { X } from "lucide-react";

/**
 * A page or panel error (web UI audit WUI-030, owner 17 Oct 2026): one sentence on the danger-tinted
 * `df-review-error` banner with a Dismiss action whose target is 44 px (`df-icon-action`). Field
 * errors stay beside their field as `ui-field-error`.
 */
export function ErrorBanner({
  message,
  onDismiss,
  role = "alert"
}: {
  message: string;
  onDismiss?: () => void;
  role?: "alert" | "status";
}) {
  return (
    <p className="df-review-error" role={role}>
      <span>{message}</span>
      {onDismiss ? (
        <button className="df-icon-action" data-tip="Dismiss" type="button" aria-label="Dismiss" onClick={onDismiss}>
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </p>
  );
}
