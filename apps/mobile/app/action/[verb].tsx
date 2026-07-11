import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DayframeBrand } from "@/components/brand";
import { enqueueShortcutAction } from "@/lib/deepLinks";
import { useMobileTheme } from "@/lib/mobileTheme";

type LocalParams = Record<string, string | string[]>;

export default function ShortcutActionRoute() {
  const { theme } = useMobileTheme();
  const params = useLocalSearchParams<LocalParams>();
  const serializedParams = JSON.stringify(params);

  useEffect(() => {
    let active = true;

    async function run() {
      const current = JSON.parse(serializedParams) as LocalParams;
      const verb = firstString(current.verb);
      const query = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== "verb")
      );

      if (verb) {
        await enqueueShortcutAction(`action/${verb}`, query, {
          route: `action/${verb}`,
          query
        });
      }

      if (active) router.replace("/");
    }

    void run();

    return () => {
      active = false;
    };
  }, [serializedParams]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <DayframeBrand
        layout="horizontal"
        size="lg"
        tone={theme.mode === "dark" ? "light" : "dark"}
      />
      <Text style={[styles.caption, { color: theme.textSecondary }]}>Shortcut queued</Text>
    </View>
  );
}

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24
  },
  caption: {
    fontFamily: "System",
    fontSize: 14
  }
});
