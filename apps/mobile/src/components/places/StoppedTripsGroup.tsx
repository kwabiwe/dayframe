import { useCallback, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { useFocusEffect } from "expo-router";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { SettingsBlockGroup, SettingsPillButton } from "@/components/settings/SettingsBlocks";
import { listStoppedTrips, resumeLoggingTrips, type StoppedTrip } from "@/lib/api";
import { isRetryableMobileConnectivityFailure } from "@/lib/mobile-network";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { mobileTextProps } from "@/lib/mobileTypography";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";

/**
 * Places › "Trips you log yourself" (PRD D19, A4; mirrors the web's StoppedTripsSection): the trips
 * the person stopped logging automatically ("Don't log trips like this"), each with "Log again".
 * Read whenever Places gains focus; shown only when there are any. "Log again" removes the row at
 * once (presence fade, the rows below reflow) and puts it back with a line under the group, announced,
 * if the server refuses (no system alert: UIA-005).
 */
export function StoppedTripsGroup({ reduceMotion, styles, theme }: { reduceMotion: boolean; styles: MobileStyles; theme: MobileTheme }) {
  const [trips, setTrips] = useState<StoppedTrip[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    listStoppedTrips()
      .then((next) => { if (live) setTrips(next); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []));

  async function resume(trip: StoppedTrip) {
    if (busyKey) return;
    setBusyKey(trip.patternKey);
    setProblem(null);
    setTrips((current) => current.filter((other) => other.patternKey !== trip.patternKey));
    try {
      await resumeLoggingTrips(trip.patternKey);
      AccessibilityInfo.announceForAccessibility(`${trip.label} logs itself again when it's clear.`);
    } catch (error) {
      setTrips((current) => current.some((other) => other.patternKey === trip.patternKey) ? current
        : [...current, trip].sort((a, b) => b.stoppedAt.localeCompare(a.stoppedAt)));
      const message = isRetryableMobileConnectivityFailure(error)
        ? `${trip.label} still waits in Review. Try again when you're online.`
        : `${trip.label} still waits in Review. Try again.`;
      setProblem(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setBusyKey(null);
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
