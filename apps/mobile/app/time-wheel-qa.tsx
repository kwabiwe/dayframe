import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DayframeTimeWheelView } from "../modules/dayframe-time-wheel";
import { useMobileTheme } from "@/lib/mobileTheme";

// Development-only harness for the native time wheel (A11b): the wheel under one time (every
// minute) and an outside change (as the dial makes) that re-aims it.
export default function TimeWheelQaRoute() {
  const { theme } = useMobileTheme();
  const [valueMs, setValueMs] = useState(() => new Date(2026, 9, 14, 9, 35).getTime());
  const [revision, setRevision] = useState(0);
  const [bounded, setBounded] = useState(false);
  const [lastReason, setLastReason] = useState("");
  const model = useMemo(() => ({
    colorScheme: theme.mode === "dark" ? "dark" as const : "light" as const,
    minuteInterval: 1 as const,
    // A 10:00–18:00 window on the value's day, to see clamping reported as "normalized".
    minimumMs: bounded ? new Date(new Date(valueMs).setHours(10, 0, 0, 0)).getTime() : null,
    maximumMs: bounded ? new Date(new Date(valueMs).setHours(18, 0, 0, 0)).getTime() : null,
    modelVersion: 1 as const,
    presentationId: 1,
    revision,
    valueMs
  }), [bounded, revision, theme.mode, valueMs]);
  if (!__DEV__) return <Redirect href="/" />;
  const time = new Date(valueMs);
  const label = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, padding: 16, gap: 12 }} testID="time-wheel-qa">
      <Text style={{ color: theme.textPrimary, fontSize: 28, fontWeight: "700" }} testID="time-wheel-qa-value">{label}</Text>
      <Text style={{ color: theme.textSecondary }} testID="time-wheel-qa-instant">{time.toISOString()} {lastReason}</Text>
      <View style={{ height: 180, borderRadius: 18, backgroundColor: theme.surfaceMuted, overflow: "hidden" }}>
        <DayframeTimeWheelView
          model={model}
          onTimeChange={(event) => {
            setLastReason(event.nativeEvent.reason);
            setValueMs(event.nativeEvent.valueMs);
          }}
          style={{ flex: 1 }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => { setValueMs((ms) => ms - 7 * 60 * 1000); setRevision((r) => r + 1); }} style={{ padding: 12, borderRadius: 999, backgroundColor: theme.surfaceMuted }}>
          <Text style={{ color: theme.textPrimary }}>−7 min (outside change)</Text>
        </Pressable>
      </View>
      {/* Clock-change and bounds fixtures. The clock-change instants are Europe/London's: set the
          Simulator or iPhone to that time zone, or these land on ordinary hours. */}
      <Text style={{ color: theme.textSecondary }}>Clock-change fixtures need the device in Europe/London.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          ["Second 01:15, 25 Oct", Date.parse("2026-10-25T01:15:00Z")],
          ["First 01:15, 25 Oct", Date.parse("2026-10-25T00:15:00Z")],
          ["00:45, 29 Mar (01:00 skipped)", Date.parse("2026-03-29T00:45:00Z")]
        ].map(([label, ms]) => (
          <Pressable accessibilityRole="button" key={label as string} onPress={() => { setValueMs(ms as number); setRevision((r) => r + 1); }} style={{ padding: 12, borderRadius: 999, backgroundColor: theme.surfaceMuted }}>
            <Text style={{ color: theme.textPrimary }}>{label as string}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={() => setBounded((on) => !on)} style={{ padding: 12, borderRadius: 999, backgroundColor: theme.surfaceMuted }}>
          <Text style={{ color: theme.textPrimary }}>{bounded ? "No bounds" : "Bound 10:00–18:00"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
