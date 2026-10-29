import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, NativeModules, StatusBar, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConnectivityStatusProvider } from "@/components/ConnectivityStatusStrip";
import { ConnectivityRecoveryOwner } from "@/components/ConnectivityRecoveryOwner";
import { ReportsSheetPortalContext } from "@/components/reports/ReportsSheetPortal";
import { ConnectivityProvider } from "@/lib/connectivity";
import { loadClockFormatPreference, refreshSystemClockFormat, registerSystemClockFormatReader } from "@/lib/clockFormat";
import { systemUses24HourClock } from "../modules/dayframe-time-wheel";
import { MobileThemeProvider, useMobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import { createNavigationColors } from "@/lib/navigationTheme";
import { primeSettingsLastKnown } from "@/lib/settingsLastKnown";
import { installHealthBackgroundSync } from "@/lib/healthBackgroundSync";
import { sweepStorageQuarantine } from "@/lib/api";
import { installTrackingNotice } from "@/lib/trackingNotice";
import { installStallWatchdog, type NativeDiagnostics } from "@/lib/stallWatchdog";

// Apple Health wakes (new sleep or workouts, or a background app refresh) are handled from module
// evaluation, so a cold background launch captures and uploads without any screen becoming active.
installHealthBackgroundSync();

// Quarantined queue/correlation contents another account owns, or kept signed out in an earlier
// launch, are deleted at every launch, background launches and signed-out ones included (Codex r2 on #552).
void sweepStorageQuarantine().catch(() => undefined);

// The tracking-stopped notice's armed flag is kept current from module evaluation (headless
// launches included), because iOS reads it natively while ending Dayframe.
installTrackingNotice();

// The freeze watchdog's JS half (staging freeze, 22 Oct 2026): JS answers native once a second while in
// front, and labelled JS work is named in any stall native records. Installed at module evaluation so
// a freeze during the first screen is caught too.
installStallWatchdog(NativeModules.DayframeDiagnosticsModule as NativeDiagnostics | undefined, AppState);

// A4 (Codex r1 on #365): Settings' last-known display values start loading when this module is
// evaluated, before any screen renders, so Settings opened by the user finds them ready on its
// first frame; a page that mounts while they are still loading mounts its rows only once they
// settle (bounded; SettingsHydrationGate) instead of flipping.
void primeSettingsLastKnown();

// The 12/24-hour time format (PRD D18): System follows the iPhone's 24-Hour Time setting, read
// natively; the stored choice starts loading now and the theme gate waits for it, so no time is
// ever drawn in the wrong format first.
registerSystemClockFormatReader(() => {
  const uses24Hour = systemUses24HourClock();
  return uses24Hour === null ? null : uses24Hour ? "24h" : "12h";
});
void loadClockFormatPreference();

export default function RootLayout() {
  // The iPhone's 24-Hour Time setting can change while Dayframe is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshSystemClockFormat();
    });
    return () => subscription.remove();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MobileThemeProvider>
          <ConnectivityProvider>
            <ConnectivityStatusProvider>
              <ConnectivityAppShell />
            </ConnectivityStatusProvider>
          </ConnectivityProvider>
        </MobileThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ConnectivityAppShell() {
  const [reportsSheet, setReportsSheet] = useState<ReactNode>(null);
  const presentReportsSheet = useCallback(
    (sheet: ReactNode) => setReportsSheet(sheet),
    [],
  );
  const reportsSheetPortal = useMemo(
    () => ({
      isPresented: Boolean(reportsSheet),
      present: presentReportsSheet,
    }),
    [presentReportsSheet, reportsSheet],
  );
  return (
    <ReportsSheetPortalContext.Provider value={reportsSheetPortal}>
      <View style={{ flex: 1 }}>
        <ThemedStack />
        <ConnectivityRecoveryOwner />
        {reportsSheet ? (
          <View style={StyleSheet.absoluteFill}>{reportsSheet}</View>
        ) : null}
      </View>
    </ReportsSheetPortalContext.Provider>
  );
}

function ThemedStack() {
  const { theme } = useMobileTheme();
  const reduceMotion = useReduceMotionPreference();
  const navigationTheme = useMemo(() => ({
    ...(theme.mode === "dark" ? DarkTheme : DefaultTheme),
    dark: theme.mode === "dark",
    colors: createNavigationColors(theme)
  }), [theme]);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar
        backgroundColor={theme.background}
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: theme.background },
          headerShadowVisible: false,
          headerTintColor: theme.textPrimary,
          headerTitleStyle: { fontFamily: "System", fontWeight: "700" },
          contentStyle: { backgroundColor: theme.background },
          animation: reduceMotion ? "none" : "simple_push",
          animationDuration: MOBILE_MOTION.screen,
          animationMatchesGesture: true,
          fullScreenGestureEnabled: true,
          fullScreenGestureShadowEnabled: false,
          gestureEnabled: true
        }}
      >
        <Stack.Screen name="index" options={{ title: "Dayframe", gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ title: "Dayframe", gestureEnabled: false }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="places" options={{ title: "Places" }} />
        <Stack.Screen name="place-editor" options={{ title: "Place" }} />
        {/* Setup owns its own Back (previous step) and Later; a swipe can't skip a permission
            prompt half-way. It fades in over the app rather than pushing. */}
        <Stack.Screen
          name="onboarding"
          options={{ title: "Set up Dayframe", animation: reduceMotion ? "none" : "fade", gestureEnabled: false }}
        />
        <Stack.Screen
          name="action/[verb]"
          options={{
            animation: reduceMotion ? "none" : "fade",
            animationDuration: MOBILE_MOTION.control,
            gestureEnabled: false,
            headerShown: false
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
