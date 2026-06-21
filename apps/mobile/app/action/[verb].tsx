import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { enqueueShortcutAction } from "@/lib/deepLinks";

type LocalParams = Record<string, string | string[]>;

export default function ShortcutActionRoute() {
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
    <View style={styles.container}>
      <Text style={styles.title}>Dayframe</Text>
      <Text style={styles.caption}>Shortcut queued</Text>
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
    gap: 10,
    backgroundColor: "#000000"
  },
  title: {
    color: "#C6FF4A",
    fontFamily: "Menlo",
    fontSize: 26,
    fontWeight: "800"
  },
  caption: {
    color: "#8B9383",
    fontFamily: "Menlo",
    fontSize: 14
  }
});
