"use client";

import { StatusPage } from "@/components/blocks/StatusPage";

export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPage
      action={<button className="df-rbtn df-rbtn--inverse" onClick={reset} type="button">Try again</button>}
      explanation="Dayframe could not load your settings. Your saved preferences have not changed."
      title="Settings are unavailable"
    />
  );
}
