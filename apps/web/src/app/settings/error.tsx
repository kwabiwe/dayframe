"use client";

import { StatusPage, useErrorRetry } from "@/components/blocks/StatusPage";

export default function SettingsError({
  reset,
  unstable_retry: unstableRetry
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  const retry = useErrorRetry(reset, unstableRetry);
  return (
    <StatusPage
      action={<button className="df-rbtn df-rbtn--inverse" onClick={retry} type="button">Try again</button>}
      explanation="Dayframe could not load your settings. Your saved preferences have not changed."
      title="Settings are unavailable"
    />
  );
}
