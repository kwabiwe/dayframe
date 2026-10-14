import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DayframeTimeWheelView } from "../modules/dayframe-time-wheel";
import { useMobileTheme } from "@/lib/mobileTheme";
import { timeWheelMinuteInterval } from "@/lib/timeWheel";

// Development-only harness for the native time wheel (A11b): the wheel under one time, Every
// minute, and an outside change (as the dial makes) that re-aims it.
export default function TimeWheelQaRoute() {
  const { theme } = useMobileTheme();
  const [valueMs, setValueMs] = useState(() => new Date(2026, 9, 14, 9, 35).getTime());
  const [everyMinute, setEveryMinute] = useState(false);
  const [revision, setRevision] = useState(0);
  const model = useMemo(() => ({
    colorScheme: theme.mode === "dark" ? "dark" as const : "light" as const,
    minuteInterval: timeWheelMinuteInterval(valueMs, everyMinute),
    modelVersion: 1 as const,
    presentationId: 1,
    revision,
    valueMs
  }), [everyMinute, revision, theme.mode, valueMs]);
  if (!__DEV__) return <Redirect href="/" />;
  const time = new Date(valueMs);
  const label = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, padding: 16, gap: 12 }} testID="time-wheel-qa">
      <Text style={{ color: theme.textPrimary, fontSize: 28, fontWeight: "700" }} testID="time-wheel-qa-value">{label}</Text>
      <View style={{ height: 180, borderRadius: 18, backgroundColor: theme.surfaceMuted, overflow: "hidden" }}>
        <DayframeTimeWheelView
          model={model}
          onTimeChange={(event) => setValueMs(event.nativeEvent.valueMs)}
          style={{ flex: 1 }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => setEveryMinute((on) => !on)} style={{ padding: 12, borderRadius: 999, backgroundColor: theme.surfaceMuted }}>
          <Text style={{ color: theme.textPrimary }}>{everyMinute ? "5-minute steps" : "Every minute"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { setValueMs((ms) => ms - 7 * 60 * 1000); setRevision((r) => r + 1); }} style={{ padding: 12, borderRadius: 999, backgroundColor: theme.surfaceMuted }}>
          <Text style={{ color: theme.textPrimary }}>−7 min (outside change)</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
