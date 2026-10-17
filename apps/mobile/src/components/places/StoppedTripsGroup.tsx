import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { useFocusEffect } from "expo-router";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { SettingsBlockGroup, SettingsPillButton } from "@/components/settings/SettingsBlocks";
import { listStoppedTrips, resumeLoggingTrips, type StoppedTrip } from "@/lib/api";
import { isRetryableMobileConnectivityFailure } from "@/lib/mobile-network";
import { currentMobileAccountEpoch, subscribeActiveMobileAccount } from "@/lib/mobileAccount";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { mobileTextProps } from "@/lib/mobileTypography";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";

/**
 * Places › "Trips you log yourself" (PRD D19, A4; mirrors the web's StoppedTripsSection): the trips
 * the person stopped logging automatically ("Don't log trips like this"), each with "Log again".
 * Read whenever Places gains focus; shown only when there are any. "Log again" removes the row at
 * once (presence fade, the rows below reflow) and puts it back with a line under the group, announced,
 * if the server refuses (no system alert: UIA-005). Everything belongs to one account lifetime (the
 * account epoch): another account clears the list, and a read or answer from before is dropped; a read
 * that started before a "Log again" never brings that trip back, while a later read shows it again
 * if it was stopped again since (Codex r1/r2 on #464).
 */
export function StoppedTripsGroup({ reduceMotion, styles, theme }: { reduceMotion: boolean; styles: MobileStyles; theme: MobileTheme }) {
  const [shown, setShown] = useState<{ epoch: number; trips: StoppedTrip[] }>(() => ({ epoch: currentMobileAccountEpoch(), trips: [] }));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Each read and each "Log again" takes the next number; a read drops a trip logged again after it
  // started (it is stale for that trip), in this account lifetime.
  const sequence = useRef(0);
  const resumed = useRef<{ epoch: number; at: Map<string, number> }>({ epoch: currentMobileAccountEpoch(), at: new Map() });
  const resumedIn = (epoch: number) => {
    if (resumed.current.epoch !== epoch) resumed.current = { epoch, at: new Map() };
    return resumed.current.at;
  };

  useEffect(() => {
    const unsubscribe = subscribeActiveMobileAccount(() => {
      setShown({ epoch: currentMobileAccountEpoch(), trips: [] });
      setProblem(null);
      setBusyKey(null);
    });
    return () => { unsubscribe(); };
  }, []);

  useFocusEffect(useCallback(() => {
    let live = true;
    const epoch = currentMobileAccountEpoch();
    const readAt = ++sequence.current;
    listStoppedTrips()
      .then((next) => {
        if (!live || epoch !== currentMobileAccountEpoch()) return;
        const gone = resumedIn(epoch);
        setShown({ epoch, trips: next.filter((trip) => (gone.get(trip.patternKey) ?? 0) < readAt) });
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []));

  const epochNow = currentMobileAccountEpoch();
  const trips = shown.epoch === epochNow ? shown.trips : [];

  async function resume(trip: StoppedTrip) {
    const epoch = currentMobileAccountEpoch();
    if (busyKey || shown.epoch !== epoch) return;
    setBusyKey(trip.patternKey);
    setProblem(null);
    resumedIn(epoch).set(trip.patternKey, ++sequence.current);
    setShown((current) => current.epoch === epoch
      ? { epoch, trips: current.trips.filter((other) => other.patternKey !== trip.patternKey) } : current);
    try {
      await resumeLoggingTrips(trip.patternKey);
      if (epoch !== currentMobileAccountEpoch()) return;
      AccessibilityInfo.announceForAccessibility(`${trip.label} logs itself again when it's clear.`);
    } catch (error) {
      if (epoch !== currentMobileAccountEpoch()) return;
      resumedIn(epoch).delete(trip.patternKey);
      setShown((current) => current.epoch !== epoch || current.trips.some((other) => other.patternKey === trip.patternKey) ? current
        : { epoch, trips: [...current.trips, trip].sort((a, b) => b.stoppedAt.localeCompare(a.stoppedAt)) });
      const message = isRetryableMobileConnectivityFailure(error)
        ? `${trip.label} still waits in Review. Try again when you're online.`
        : `${trip.label} still waits in Review. Try again.`;
      setProblem(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      if (epoch === currentMobileAccountEpoch()) setBusyKey(null);
    }
  }

  if (trips.length === 0) return null;
  return (
    <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} layout={localLayoutTransition(reduceMotion)}>
      <SettingsBlockGroup foot="Trips like these wait in Review instead of logging themselves." theme={theme} title="Trips you log yourself">
        {trips.map((trip, index) => (
          <Reanimated.View
            key={trip.patternKey}
            entering={localPresenceEntering(reduceMotion)}
            exiting={localPresenceExiting(reduceMotion)}
            layout={localLayoutTransition(reduceMotion)}
          >
            <View style={[styles.placesRow, index > 0 ? styles.settingsActivityRowDivider : null]} testID={`places-trip-${index}`}>
              <View accessible accessibilityLabel={`Trip ${trip.label}, waits in Review`} style={styles.placesRowMain}>
                <View style={styles.placesBlock}>
                  <DayframeIcon color={theme.textSecondary} glyph="route" size={18} />
                </View>
                <View style={styles.settingsActivityText}>
                  <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={styles.settingsActivityName}>{trip.label}</Text>
                </View>
              </View>
              <View style={styles.placesRowActions}>
                <SettingsPillButton
                  accessibilityLabel={`Log ${trip.label} automatically again`}
                  disabled={busyKey !== null}
                  label="Log again"
                  onPress={() => void resume(trip)}
                  theme={theme}
                />
              </View>
            </View>
          </Reanimated.View>
        ))}
        {problem ? (
          <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
            <Text {...mobileTextProps("metadata")} style={[styles.placesStatus, { color: theme.dangerText }]} testID="places-trips-problem">
              {problem}
            </Text>
          </Reanimated.View>
        ) : null}
      </SettingsBlockGroup>
    </Reanimated.View>
  );
}
