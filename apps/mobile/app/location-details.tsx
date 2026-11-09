import { useEffect, useRef, useState } from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { evidencePlainSummary, formatClockTime, type LocationTimeline, type TimelinePlace, type TimelineTrip } from "@dayframe/shared";
import { BlocksNavHeader, usePreviousScreenLabel } from "@/components/BlocksNavHeader";
import { SettingsBlockGroup, SettingsBlockRow } from "@/components/settings/SettingsBlocks";
import { fetchLocationTimeline, fetchTimelineItemEvidence } from "@/lib/api";
import { useClockFormat } from "@/lib/clockFormat";
import {
  currentMobileAccountEpoch,
  mobileAccountKey,
  readActiveMobileAccount,
  subscribeActiveMobileAccount,
  type MobileAccountOwner
} from "@/lib/mobileAccount";
import { useMobileTheme } from "@/lib/mobileTheme";

/** The account lifetime a read belongs to: its owner and the epoch it was asked in. */
type Lifetime = { owner: MobileAccountOwner; key: string; epoch: number };

/**
 * Settings › Something not syncing? › Location details (Codex r1 on #620): the diagnostic words for today's places
 * and trips — how many readings, each silence ("No readings 19:44–19:59") and each stop — that the place and trip
 * sheets no longer show (owner feedback, 29 Oct 2026). Read on demand, one item at a time; nothing is kept or sent.
 * Every read and everything shown belongs to the account lifetime it was asked in (Codex r2 on #620): an account
 * change clears the screen and reads again for the new account, and a late answer for the old one is dropped.
 */
export default function LocationDetailsRoute() {
  const { styles, theme } = useMobileTheme();
  const backLabel = usePreviousScreenLabel() ?? "Settings";
  const clockFormat = useClockFormat();
  const [lifetime, setLifetime] = useState<Lifetime | null>(null);
  const [timeline, setTimeline] = useState<{ key: string; epoch: number; value: LocationTimeline | "unavailable" } | null>(null);
  const [details, setDetails] = useState<{ key: string; epoch: number; byItem: Record<string, string> } | null>(null);
  const lifetimeRef = useRef<Lifetime | null>(null);
  const current = (life: Lifetime) => currentMobileAccountEpoch() === life.epoch && lifetimeRef.current === life;

  // The account now, and again whenever it changes: the old one's screen goes at once.
  useEffect(() => {
    let live = true;
    const resolve = () => {
      lifetimeRef.current = null;
      setLifetime(null);
      const epoch = currentMobileAccountEpoch();
      void readActiveMobileAccount().then((owner) => {
        if (!live || epoch !== currentMobileAccountEpoch()) return;
        const next = owner ? { owner, key: mobileAccountKey(owner), epoch } : null;
        lifetimeRef.current = next;
        setLifetime(next);
      });
    };
    resolve();
    const unsubscribe = subscribeActiveMobileAccount(resolve);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!lifetime) return;
    const controller = new AbortController();
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    fetchLocationTimeline(date, { signal: controller.signal }).then(
      (value) => { if (!controller.signal.aborted && current(lifetime)) setTimeline({ key: lifetime.key, epoch: lifetime.epoch, value }); },
      () => { if (!controller.signal.aborted && current(lifetime)) setTimeline({ key: lifetime.key, epoch: lifetime.epoch, value: "unavailable" }); });
    return () => controller.abort();
    // `current` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifetime]);

  const time = (iso: string) => formatClockTime(new Date(iso), clockFormat);
  const mine = <T extends { key: string; epoch: number }>(value: T | null) =>
    value && lifetime && value.key === lifetime.key && value.epoch === lifetime.epoch ? value : null;
  const shownTimeline = mine(timeline)?.value ?? null;
  const shownDetails = mine(details)?.byItem ?? {};

  async function read(item: TimelinePlace | TimelineTrip) {
    const life = lifetimeRef.current;
    if (!life || !current(life)) return;
    const note = (text: string) => {
      if (!current(life)) return;
      setDetails((now) => ({ key: life.key, epoch: life.epoch,
        byItem: { ...(now && now.key === life.key && now.epoch === life.epoch ? now.byItem : {}), [item.id]: text } }));
    };
    note("Reading…");
    try {
      // Under the account the list was read for, never whichever is signed in by the time it answers.
      const evidence = await fetchTimelineItemEvidence({ id: item.id, kind: item.kind, startedAt: item.startedAt }, { owner: life.owner });
      note(evidencePlainSummary(evidence, time));
    } catch {
      note("Couldn't read this one. Try again.");
    }
  }

  const items = shownTimeline && shownTimeline !== "unavailable" ? shownTimeline.items : [];
  return (
    <SafeAreaView style={styles.safeArea}>
      <BlocksNavHeader backLabel={backLabel} onBack={() => router.back()} title="Location details" />
      <ScrollView style={styles.settingsScrollView} contentContainerStyle={styles.settingsScrollContent}>
        <SettingsBlockGroup foot="Tap a place or trip for its readings and the times with none. Read on this iPhone only; nothing is shared."
          theme={theme} title="Today">
          {shownTimeline === null ? (
            <SettingsBlockRow testID="location-details-loading" theme={theme} title="Loading today's places…" />
          ) : shownTimeline === "unavailable" ? (
            <SettingsBlockRow subtitle="Check your connection and open this again." theme={theme} title="Today's places couldn't be read" />
          ) : !items.length ? (
            <SettingsBlockRow theme={theme} title="No places or trips today" />
          ) : items.map((item) => (
            <SettingsBlockRow key={`${item.kind}-${item.id}-${item.startedAt}`} onPress={() => void read(item)}
              subtitle={shownDetails[item.id] ?? `${time(item.startedAt)}–${item.stoppedAt ? time(item.stoppedAt) : "now"}`}
              testID={`location-details-${item.id}`} theme={theme}
              title={item.kind === "place" ? item.name ?? "Unknown place" : "Trip"} />
          ))}
        </SettingsBlockGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
