import { useCallback, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { mobileAccountOwnersEqual, readActiveMobileAccount } from "@/lib/mobileAccount";
import { readForgottenTimerAlerts, setForgottenTimerAlerts } from "@/lib/forgottenTimer";
import type { MobileTheme } from "@/lib/mobileTheme";
import { SettingsBlockRow, SettingsSwitch } from "./SettingsBlocks";

export function ForgottenTimerAlertsSetting({ theme }: { theme: MobileTheme }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const updating = useRef(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    active.current = true;
    void (async () => {
      const owner = await readActiveMobileAccount();
      if (!owner) return;
      const value = await readForgottenTimerAlerts(owner);
      if (live && mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) setEnabled(value);
    })().catch(() => undefined);
    return () => { live = false; active.current = false; setEnabled(null); };
  }, []));

  async function toggle(next: boolean) {
    if (updating.current) return;
    updating.current = true;
    setBusy(true);
    try {
      const owner = await readActiveMobileAccount();
      if (!owner) return;
      const result = await setForgottenTimerAlerts(owner, next);
      if (!active.current || !mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return;
      if (result === "saved") setEnabled(next);
      if (result === "denied") Alert.alert("Notifications are off", "Allow notifications in iPhone Settings.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => { void Linking.openSettings(); } }
      ]);
      if (result === "unavailable") Alert.alert("Couldn’t update timer reminders", "Try again while connected.");
    } catch {
      if (active.current) Alert.alert("Couldn’t update timer reminders", "Try again while connected.");
    } finally {
      updating.current = false;
      setBusy(false);
    }
  }

  return (
    <SettingsBlockRow
      title="Eight-hour timer reminder"
      subtitle="One notification when a block is still running"
      theme={theme}
      testID="settings-forgotten-timer-alerts"
      control={<SettingsSwitch label="Eight-hour timer reminder" theme={theme} value={enabled === true}
        disabled={busy || enabled === null} onValueChange={(next) => { void toggle(next); }} />}
    />
  );
}
