"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { resolveActivityIcon } from "@dayframe/shared";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { GoalSettings } from "@/components/GoalSettings";
import {
  AccountSettings,
  DataPrivacySettings,
  HelpSettings,
  PlacesLocationSettings,
  SettingsSignOut
} from "@/components/SettingsForms";
import { ThemeSettings } from "@/components/ThemeSettings";
import { ClockFormatSettings } from "@/components/ClockFormat";
import { blockStyle } from "@/lib/block-style";
import type { CategoryRow } from "@/lib/queries";

/**
 * Settings in Blocks (parity step 14b): the account card (Edit profile, Workspace, Change
 * password), then two columns of cards — Your day, Activities, Appearance; Automatic tracking,
 * Privacy and data, Help — and Sign out. Every earlier setting stays; the page reads the shell's
 * last bootstrap and refreshes quietly.
 */
export default function SettingsPage() {
  const { data, refresh } = useAppShellRuntime();
  // Account feedback lives here: the account card is re-created when the workspace changes.
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) return <SettingsInitialLoading />;
  const authMode = data.authMode ?? "provider";

  return (
    <div className="df-settings-page">
      <SettingsHead />
      <AccountSettings
        key={`${data.user.id}:${data.workspace.id}`}
        authMode={authMode}
        notice={accountNotice}
        onNotice={setAccountNotice}
        user={data.user}
        workspace={data.workspace}
        workspaces={data.workspaces}
      />
      <div className="df-settings">
        <div className="df-set-col">
          <SetCard glyph="timer" id="your-day" title="Your day">
            <GoalSettings
              // A different account gets a fresh control: no draft or save crosses over.
              key={data.user.id}
              dailyGoalMinutes={data.user.dailyGoalMinutes}
              goalsRevision={data.user.goalsRevision ?? 0}
              userId={data.user.id}
              weeklyGoalMinutes={data.user.weeklyGoalMinutes}
            />
          </SetCard>
          <SetCard glyph="palette" id="activities" title="Activities">
            <ActivitiesSummary categories={data.categories} />
          </SetCard>
          <SetCard glyph="sun" id="appearance" title="Appearance">
            <ThemeSettings />
            <ClockFormatSettings />
          </SetCard>
        </div>
        <div className="df-set-col">
          <SetCard
            glyph="map-pin"
            id="automatic-tracking"
            note="Dayframe logs on its own only when it’s clear: visits at places you trust, and trips between your places. Anything it isn’t sure about waits in Review for you. Visit suggestions are set for each saved place; background location is managed in the iPhone app, and the web only asks for this browser’s location when you choose Current location for a place."
            title="Automatic tracking"
          >
            <PlacesLocationSettings />
          </SetCard>
          <SetCard
            glyph="shield"
            id="privacy-data"
            note="Health and precise location stay private to your account and are never used for analytics."
            title="Privacy and data"
          >
            <DataPrivacySettings />
          </SetCard>
          <SetCard glyph="message-circle" id="help" title="Help">
            <HelpSettings authMode={authMode} />
          </SetCard>
          <SettingsSignOut />
        </div>
      </div>
    </div>
  );
}

function SettingsHead() {
  return (
    <div className="df-page-head">
      <div>
        <h1>Settings</h1>
        <p>Your account, your day, and what Dayframe tracks for you.</p>
      </div>
    </div>
  );
}

function SettingsInitialLoading() {
  return (
    <div className="df-settings-page" aria-busy="true" aria-live="polite">
      <SettingsHead />
      <section className="df-card df-set-account df-set-placeholder" aria-label="Loading settings">
        <p className="df-muted">Dayframe is loading your settings.</p>
      </section>
    </div>
  );
}

function SetCard({
  children,
  glyph,
  id,
  note,
  title
}: {
  children: ReactNode;
  glyph: Parameters<typeof DayframeIcon>[0]["glyph"];
  id: string;
  note?: string;
  title: string;
}) {
  const titleId = `${id}-title`;
  return (
    <section className="df-card df-set-card" aria-labelledby={titleId}>
      <h2 id={titleId}>
        <DayframeIcon glyph={glyph} size={18} />
        {title}
      </h2>
      {note ? <p className="df-set-note">{note}</p> : null}
      <div className="settings-group">{children}</div>
    </section>
  );
}

function ActivitiesSummary({ categories }: { categories: CategoryRow[] }) {
  const pinned = categories.filter((category) => category.isPinned).length;
  const own = categories.filter((category) => !category.starterKey).length;
  return (
    <>
      <div className="ui-settings-row">
        <div>
          <strong>{categories.length} {categories.length === 1 ? "activity" : "activities"}</strong>
          <span>{pinned} in quick start · {own} of your own</span>
        </div>
        <div className="ui-settings-row-action">
          <Link className="df-rbtn df-rbtn--sm" href="/categories">Manage</Link>
        </div>
      </div>
      <div className="df-act-strip" aria-hidden="true">
        {categories.slice(0, 12).map((category) => (
          <span className="df-block" key={category.id} style={blockStyle(category.color, category.name)}>
            <DayframeIcon glyph={resolveActivityIcon({ icon: category.icon ?? null, name: category.name }).glyph} size={16} />
          </span>
        ))}
      </div>
    </>
  );
}
