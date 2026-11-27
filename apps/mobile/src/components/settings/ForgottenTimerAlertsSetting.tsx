import { useCallback, useRef, useState } from "react";
import { Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { mobileAccountOwnersEqual, readActiveMobileAccount } from "@/lib/mobileAccount";
import { readForgottenTimerAlerts, setForgottenTimerAlerts } from "@/lib/forgottenTimer";
import type { MobileTheme } from "@/lib/mobileTheme";
import { SettingsBlockRow, SettingsSwitch } from "./SettingsBlocks";

export function ForgottenTimerAlertsSetting({ theme }: { theme: MobileTheme }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"denied" | "unavailable" | null>(null);
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
    return () => {
      live = false;
      active.current = false;
      setEnabled(null);
      setNotice(null);
    };
  }, []));

  async function toggle(next: boolean) {
    if (updating.current) return;
    updating.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const owner = await readActiveMobileAccount();
      if (!owner) return;
      const result = await setForgottenTimerAlerts(owner, next);
      if (!active.current || !mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return;
      if (result === "saved") setEnabled(next);
      if (result === "denied" || result === "unavailable") setNotice(result);
    } catch {
      if (active.current) setNotice("unavailable");
    } finally {
      updating.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsBlockRow
        title="Long-running block reminder"
        subtitle="One notification after eight hours"
        theme={theme}
        testID="settings-forgotten-timer-alerts"
        control={<SettingsSwitch label="Long-running block reminder" theme={theme} value={enabled === true}
          disabled={busy || enabled === null} onValueChange={(next) => { void toggle(next); }} />}
      />
      {notice === "denied" ? (
        <SettingsBlockRow title="Notifications are off" subtitle="Open iPhone Settings to allow them"
          theme={theme} onPress={() => { void Linking.openSettings(); }} />
      ) : notice === "unavailable" ? (
        <SettingsBlockRow title="Couldn’t update reminders" subtitle="Try again while connected" theme={theme} />
      ) : null}
    </>
  );
}
