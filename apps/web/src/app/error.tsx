"use client";

import { StatusPage, useErrorRetry } from "@/components/blocks/StatusPage";

export default function AppError({
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
      explanation="Dayframe couldn’t load this page. Nothing you saved has changed."
      title="Something went wrong"
    />
  );
}
