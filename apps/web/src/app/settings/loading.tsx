import { PageHeader } from "@/components/PageHeader";

export default function SettingsLoading() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage how Dayframe looks, tracks goals, uses location and protects your account."
      />
      <div className="settings-page" aria-busy="true" aria-live="polite">
        <section className="settings-section" aria-labelledby="settings-loading-title">
          <header className="settings-section-header">
            <h2 id="settings-loading-title">Loading settings</h2>
            <p>Your preferences and account details will appear here.</p>
          </header>
          <div className="settings-group">
            <div className="ui-settings-row">
              <div>
                <strong>Just a moment</strong>
                <span>Dayframe is loading your settings.</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
