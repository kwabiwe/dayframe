import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { readLandscapeEnabled, setKeepTodayAwake, setLandscapeEnabled, useKeepTodayAwake } from "@/lib/deviceDisplay";
import type { MobileTheme } from "@/lib/mobileTheme";
import { SettingsBlockRow, SettingsSwitch } from "./SettingsBlocks";

export function DeviceDisplaySettings({ theme }: { theme: MobileTheme }) {
  const keepAwake = useKeepTodayAwake();
  const [landscape, setLandscape] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    void readLandscapeEnabled()?.then((value) => { if (live) setLandscape(value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const toggleLandscape = async (enabled: boolean) => {
    setSaving(true);
    try {
      await setLandscapeEnabled(enabled);
      setLandscape(enabled);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {Platform.OS === "ios" && !Platform.isPad && landscape !== null ? (
        <SettingsBlockRow theme={theme} title="Allow landscape" testID="settings-allow-landscape"
          control={<SettingsSwitch label="Allow landscape" theme={theme} value={landscape} disabled={saving}
            onValueChange={(enabled) => { void toggleLandscape(enabled).catch(() => undefined); }} />} />
      ) : null}
      <SettingsBlockRow theme={theme} title="Keep Today awake" subtitle="While recording with Today in the foreground"
        testID="settings-keep-today-awake"
        control={<SettingsSwitch label="Keep Today awake" theme={theme} value={keepAwake}
          onValueChange={(enabled) => { void setKeepTodayAwake(enabled).catch(() => undefined); }} />} />
    </>
  );
}
