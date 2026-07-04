import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DAYFRAME_THEME } from "@dayframe/shared";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";
export type MobileTheme = (typeof DAYFRAME_THEME)[ThemeMode] & {
  mode: ThemeMode;
  chartTrack: string;
  pressed: string;
};

const THEME_PREFERENCE_KEY = "dayframe.themePreference.v1";

type MobileThemeContextValue = {
  themePreference: ThemePreference;
  resolvedThemeMode: ThemeMode;
  theme: MobileTheme;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
};

const MobileThemeContext = createContext<MobileThemeContextValue | null>(null);

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const resolvedThemeMode: ThemeMode =
    themePreference === "system" ? colorScheme === "light" ? "light" : "dark" : themePreference;
  const theme = useMemo(() => createMobileTheme(resolvedThemeMode), [resolvedThemeMode]);

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREFERENCE_KEY)
      .then((value) => {
        if (isThemePreference(value)) setThemePreferenceState(value);
      })
      .catch(() => undefined);
  }, []);

  async function setThemePreference(preference: ThemePreference) {
    setThemePreferenceState(preference);
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
  }

  const value = useMemo(
    () => ({ themePreference, resolvedThemeMode, theme, setThemePreference }),
    [resolvedThemeMode, theme, themePreference]
  );

  return <MobileThemeContext.Provider value={value}>{children}</MobileThemeContext.Provider>;
}

export function useMobileTheme() {
  const value = useContext(MobileThemeContext);
  if (!value) throw new Error("useMobileTheme must be used inside MobileThemeProvider.");
  return value;
}

function createMobileTheme(mode: ThemeMode): MobileTheme {
  const base = DAYFRAME_THEME[mode];
  return {
    ...base,
    mode,
    chartTrack: mode === "dark" ? "#161A13" : "#E2E9D8",
    pressed: mode === "dark" ? "#1B2114" : "#E9F2DE"
  };
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
