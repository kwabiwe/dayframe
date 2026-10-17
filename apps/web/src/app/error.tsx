"use client";

import { StatusPage } from "@/components/blocks/StatusPage";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPage
      action={<button className="df-rbtn df-rbtn--inverse" onClick={reset} type="button">Try again</button>}
      explanation="Dayframe couldn’t load this page. Nothing you saved has changed."
      title="Something went wrong"
    />
  );
}
