import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MobileThemeProvider, useMobileTheme } from "@/lib/mobileTheme";

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
    <>
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
          contentStyle: { backgroundColor: theme.background }
        }}
      >
        <Stack.Screen name="index" options={{ title: "Dayframe" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="places" options={{ title: "Places" }} />
        <Stack.Screen name="review" options={{ title: "Review" }} />
        <Stack.Screen name="action/[verb]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
