import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { evidencePlainSummary, formatClockTime, type LocationTimeline, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import { BlocksNavHeader, usePreviousScreenLabel } from "@/components/BlocksNavHeader";
import { SettingsBlockGroup, SettingsBlockRow } from "@/components/settings/SettingsBlocks";
import { fetchLocationTimeline, fetchTimelineItemEvidence } from "@/lib/api";
import { useClockFormat } from "@/lib/clockFormat";
import { readActiveMobileAccount } from "@/lib/mobileAccount";
import { useMobileTheme } from "@/lib/mobileTheme";

/**
 * Settings › Something not syncing? › Location details (Codex r1 on #620): the diagnostic words for today's places
 * and trips — how many readings, each silence ("No readings 19:44–19:59") and each stop — that the place and trip
 * sheets no longer show (owner feedback, 29 Oct 2026). Read on demand, one item at a time; nothing is kept or sent.
 */
export default function LocationDetailsRoute() {
  const { styles, theme } = useMobileTheme();
  const backLabel = usePreviousScreenLabel() ?? "Settings";
  const clockFormat = useClockFormat();
  const [timeline, setTimeline] = useState<LocationTimeline | null | "unavailable">(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    fetchLocationTimeline(date, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setTimeline(result); },
        () => { if (!controller.signal.aborted) setTimeline("unavailable"); });
    return () => controller.abort();
  }, []);
  const time = (iso: string) => formatClockTime(new Date(iso), clockFormat);
  async function read(item: TimelinePlace | TimelineTrip) {
    setDetails((current) => ({ ...current, [item.id]: "Reading…" }));
    try {
      const owner = await readActiveMobileAccount();
      if (!owner) throw new Error("No account.");
      const evidence = await fetchTimelineItemEvidence({ id: item.id, kind: item.kind, startedAt: item.startedAt }, { owner });
      setDetails((current) => ({ ...current, [item.id]: evidencePlainSummary(evidence, time) }));
    } catch {
      setDetails((current) => ({ ...current, [item.id]: "Couldn't read this one. Try again." }));
    }
  }
  const items = timeline && timeline !== "unavailable" ? timeline.items : [];
  return (
    <SafeAreaView style={styles.safeArea}>
      <BlocksNavHeader backLabel={backLabel} onBack={() => router.back()} title="Location details" />
      <ScrollView style={styles.settingsScrollView} contentContainerStyle={styles.settingsScrollContent}>
        <SettingsBlockGroup foot="Tap a place or trip for its readings and the times with none. Read on this iPhone only; nothing is shared."
          theme={theme} title="Today">
          {timeline === null ? (
            <SettingsBlockRow theme={theme} title="Loading today's places…" />
          ) : timeline === "unavailable" ? (
            <SettingsBlockRow subtitle="Check your connection and open this again." theme={theme} title="Today's places couldn't be read" />
          ) : !items.length ? (
            <SettingsBlockRow theme={theme} title="No places or trips today" />
          ) : items.map((item) => (
            <SettingsBlockRow key={`${item.kind}-${item.id}-${item.startedAt}`} onPress={() => void read(item)}
              subtitle={details[item.id] ?? `${time(item.startedAt)}–${item.stoppedAt ? time(item.stoppedAt) : "now"}`}
              testID={`location-details-${item.id}`} theme={theme}
              title={item.kind === "place" ? item.name ?? "Unknown place" : "Trip"} />
          ))}
        </SettingsBlockGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
