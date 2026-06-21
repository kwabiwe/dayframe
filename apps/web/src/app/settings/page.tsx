import { PageHeader } from "@/components/PageHeader";
import { ThemeSettings } from "@/components/ThemeSettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
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
            ["HealthKit", "Sleep/workout import stub for iOS"],
            ["Health Connect", "Android import stub"],
            ["Data export/deletion", "Design notes in README"]
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
