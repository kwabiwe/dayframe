import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MobileThemeProvider, useMobileTheme } from "@/lib/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MobileThemeProvider>
        <ThemedStack />
      </MobileThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
  const { theme } = useMobileTheme();

  return (
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: theme.background },
          headerShadowVisible: false,
          headerTintColor: theme.accent,
          headerTitleStyle: { fontFamily: "System", fontWeight: "700" },
          contentStyle: { backgroundColor: theme.background }
        }}
      >
        <Stack.Screen name="index" options={{ title: "Dayframe" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="action/[verb]" options={{ headerShown: false }} />
      </Stack>
  );
}
