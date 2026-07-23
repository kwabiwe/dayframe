import { DayframeBrand } from "@/components/brand/DayframeBrand";

export function AppLoadingState({
  embedded = false,
  message = "Loading Dayframe…"
}: {
  embedded?: boolean;
  message?: string;
}) {
  return (
    <div
      className={["swiss-app-loading", embedded ? "is-embedded" : ""].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <DayframeBrand decorative size="md" />
      <p>{message}</p>
    </div>
  );
}
