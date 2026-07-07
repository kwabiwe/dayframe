import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: "#000000" },
          headerShadowVisible: false,
          headerTintColor: "#C6FF4A",
          headerTitleStyle: { fontFamily: "Menlo", fontWeight: "700" },
          contentStyle: { backgroundColor: "#000000" }
        }}
      >
        <Stack.Screen name="index" options={{ title: "Dayframe" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="places" options={{ title: "Places" }} />
        <Stack.Screen name="review" options={{ title: "Review" }} />
        <Stack.Screen name="action/[verb]" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
