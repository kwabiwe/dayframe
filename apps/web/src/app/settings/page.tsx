"use client";

import { useEffect, type ReactNode } from "react";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { GoalSettings } from "@/components/GoalSettings";
import { PageHeader } from "@/components/PageHeader";
import {
  AccountSettings,
  DataPrivacySettings,
  PlacesLocationSettings,
  TroubleshootingSettings
} from "@/components/SettingsForms";
import { ThemeSettings } from "@/components/ThemeSettings";

export default function SettingsPage() {
  const { data, refresh } = useAppShellRuntime();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) return <SettingsInitialLoading />;
  const authMode = data.authMode ?? "provider";

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage how Dayframe looks, tracks goals, uses location and protects your account."
      />
      <div className="settings-page">
        <SettingsSection
          id="general"
          title="General"
          description="Your appearance and progress targets."
        >
          <ThemeSettings />
          <GoalSettings
            dailyGoalMinutes={data.user.dailyGoalMinutes}
            weeklyGoalMinutes={data.user.weeklyGoalMinutes}
          />
        </SettingsSection>

        <SettingsSection
          id="places-location"
          title="Places and location"
          description="Saved places, visit suggestions and browser access."
        >
          <PlacesLocationSettings />
        </SettingsSection>

        <SettingsSection
          id="account"
          title="Account and workspace"
          description="Your profile, current workspace and sign-in security."
        >
          <AccountSettings
            key={`${data.user.id}:${data.workspace.id}`}
            authMode={authMode}
            user={data.user}
            workspace={data.workspace}
            workspaces={data.workspaces}
          />
        </SettingsSection>

        <SettingsSection
          id="data-privacy"
          title="Data and privacy"
          description="Export your information or remove recent raw location evidence."
        >
          <DataPrivacySettings />
        </SettingsSection>

        <section className="settings-section" aria-labelledby="privacy-troubleshooting-title">
          <h2 className="sr-only" id="privacy-troubleshooting-title">Privacy and troubleshooting</h2>
          <TroubleshootingSettings authMode={authMode} />
        </section>
      </div>
    </>
  );
}

function SettingsInitialLoading() {
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

function SettingsSection({
  children,
  description,
  id,
  title
}: {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}) {
  const titleId = `${id}-title`;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <header className="settings-section-header">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="settings-group">{children}</div>
    </section>
  );
}
