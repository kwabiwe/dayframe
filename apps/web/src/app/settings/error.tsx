"use client";

import { Button } from "@/components/ui/Primitives";
import { PageHeader } from "@/components/PageHeader";

export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage how Dayframe looks, tracks goals, uses location and protects your account."
      />
      <div className="settings-page">
        <section className="settings-section" aria-labelledby="settings-error-title">
          <header className="settings-section-header">
            <h2 id="settings-error-title">Settings are unavailable</h2>
            <p>Dayframe could not load your settings. Your saved preferences have not changed.</p>
          </header>
          <div className="settings-group">
            <div className="ui-settings-row">
              <div>
                <strong>Try again</strong>
                <span>Check your connection, then retry. You can also sign out and back in.</span>
              </div>
              <div className="ui-settings-row-action">
                <Button variant="primary" onClick={reset}>Retry</Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
