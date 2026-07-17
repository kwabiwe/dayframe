import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useMemo } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MobileThemeProvider, useMobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useReduceMotionPreference } from "@/lib/motion";
import { createNavigationColors } from "@/lib/navigationTheme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MobileThemeProvider>
          <ThemedStack />
        </MobileThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
        <Stack.Screen name="review" options={{ title: "Review" }} />
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
