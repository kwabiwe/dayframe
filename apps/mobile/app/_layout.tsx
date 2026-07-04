import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: "#F7F8F5" },
          headerShadowVisible: false,
          headerTintColor: "#2F766D",
          headerTitleStyle: { fontFamily: "System", fontWeight: "700" },
          contentStyle: { backgroundColor: "#F7F8F5" }
        }}
      >
        <Stack.Screen name="index" options={{ title: "Dayframe" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="action/[verb]" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
