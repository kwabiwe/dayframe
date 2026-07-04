import { PageHeader } from "@/components/PageHeader";
import { ThemeSettings } from "@/components/ThemeSettings";
import { resolvePageSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await resolvePageSession();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Privacy defaults and integration stubs for local development."
      />
      <div className="grid gap-5 px-5 py-6 md:px-8 xl:grid-cols-2">
        <div className="xl:col-span-2">
          <ThemeSettings />
        </div>
        <SettingsPanel
          title="Location retention"
          rows={[
            ["Raw location samples", "7 days by default"],
            ["Processed stay segments", "Stored separately from raw payloads"],
            ["Home auto-start", "Disabled by default"],
            ["Broad geofences", "Review first unless a user rule exists"]
          ]}
        />
        <SettingsPanel
          title="Integrations"
          rows={[
            ["Calendar", "Hint source only in v1"],
            ["Apple Health", "iOS native sleep and workout imports queue activity events first"]
          ]}
        />
        <SettingsPanel
          title="Auth and ingest"
          rows={[
            ["Session mode", process.env.DAYFRAME_AUTH_MODE ?? "dev fallback in local development"],
            ["Dev user", process.env.DAYFRAME_DEV_USER_ID ?? "seeded demo user"],
            ["Dev workspace", process.env.DAYFRAME_DEV_WORKSPACE_ID ?? "seeded Personal workspace"],
            ["Ingest tokens", "Bearer or x-dayframe-ingest-token with scoped token hashes"]
          ]}
        />
        <SettingsPanel
          title="Export and backup"
          rows={[
            ["Workspace JSON", "/api/export?kind=workspace_json"],
            ["Time entries CSV", "/api/export?kind=time_entries_csv"],
            ["Activity events JSON", "/api/export?kind=activity_events_json"],
            ["Local backup", "npm run export:workspace -w @dayframe/db -- ./backup.json"]
          ]}
        />
      </div>
    </>
  );
}

function SettingsPanel({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <section className="industrial-panel">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {rows.map(([label, value], index) => (
          <div key={`${title}-${index}-${label}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[220px_1fr]">
            <span className="font-medium">{label}</span>
            <span className="text-[var(--muted)]">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
