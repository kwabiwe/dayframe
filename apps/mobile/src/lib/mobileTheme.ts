import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  StyleSheet,
  useColorScheme,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { DAYFRAME_THEME } from "@dayframe/shared";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";
export type MobileTheme = (typeof DAYFRAME_THEME)[ThemeMode] & {
  mode: ThemeMode;
  chartTrack: string;
  pressed: string;
};
export type MobileStyles = ReturnType<typeof createStyles>;

export const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

const THEME_PREFERENCE_KEY = "dayframe.themePreference.v1";
const monoFont = "System";

export function useMobileTheme() {
  const colorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");

  const reloadThemePreference = useCallback(async () => {
    const value = await AsyncStorage.getItem(THEME_PREFERENCE_KEY).catch(() => null);
    if (isThemePreference(value)) setThemePreferenceState(value);
  }, []);

  useEffect(() => {
    void reloadThemePreference();
  }, [reloadThemePreference]);

  const setThemePreference = useCallback(async (nextPreference: ThemePreference) => {
    setThemePreferenceState(nextPreference);
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, nextPreference);
  }, []);

  const resolvedThemeMode = themePreference === "system"
    ? colorScheme === "light" ? "light" : "dark"
    : themePreference;
  const theme = useMemo(() => createMobileTheme(resolvedThemeMode), [resolvedThemeMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  return {
    reloadThemePreference,
    setThemePreference,
    styles,
    theme,
    themePreference
  };
}

export function createMobileTheme(mode: ThemeMode): MobileTheme {
  const base = DAYFRAME_THEME[mode];
  return {
    ...base,
    mode,
    chartTrack: mode === "dark" ? "#161A13" : "#E2E9D8",
    pressed: mode === "dark" ? "#1B2114" : "#E9F2DE"
  };
}

export function pressable(baseStyle: StyleProp<ViewStyle>, pressedStyle: StyleProp<ViewStyle>) {
  return ({ pressed }: { pressed: boolean }) => [
    baseStyle,
    pressed ? pressedStyle : null
  ];
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background
    },
    container: {
      padding: 18,
      backgroundColor: theme.background
    },
    contentStack: {
      gap: 14
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 6,
      paddingTop: 6
    },
    settingsHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    logoLockup: {
      flexShrink: 1,
      gap: 4
    },
    logoImage: {
      width: 148,
      height: 46
    },
    iconButton: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    title: {
      fontSize: 30,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    settingsTitle: {
      flex: 1,
      fontSize: 22,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont,
      textAlign: "right"
    },
    subtitle: {
      marginTop: 2,
      fontSize: 13,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    panel: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 14,
      gap: 10
    },
    timerPanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 16,
      padding: 12,
      gap: 8
    },
    lifecyclePanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 14,
      gap: 12
    },
    label: {
      fontSize: 11,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    timerText: {
      fontSize: 23,
      fontWeight: "800",
      color: theme.accent,
      fontFamily: monoFont
    },
    activeTimerHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12
    },
    activeTimerTextStack: {
      flex: 1,
      gap: 5,
      minWidth: 0
    },
    activeTimerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    activeTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    activeTitleText: {
      flex: 1
    },
    activeDescription: {
      fontSize: 14,
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    muted: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    sectionHeader: {
      gap: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      paddingBottom: 10
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    summaryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    summaryTotal: {
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 20,
      fontWeight: "800"
    },
    segmentedControl: {
      flexDirection: "row",
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
      overflow: "hidden"
    },
    segmentButton: {
      flex: 1,
      alignItems: "center",
      borderRightWidth: 1,
      borderRightColor: theme.border,
      paddingVertical: 9
    },
    segmentButtonSelected: {
      backgroundColor: theme.surfaceInset
    },
    segmentButtonText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontWeight: "700"
    },
    segmentButtonTextSelected: {
      color: theme.accent
    },
    chartWrap: {
      alignItems: "center",
      paddingVertical: 2
    },
    chartBox: {
      width: 264,
      height: 264,
      alignItems: "center",
      justifyContent: "center"
    },
    chartCenter: {
      position: "absolute",
      width: 116,
      height: 116,
      alignItems: "center",
      justifyContent: "center"
    },
    chartCenterLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11
    },
    chartCenterValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "800"
    },
    legendList: {
      gap: 10
    },
    legendRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 10
    },
    legendSwatch: {
      width: 12,
      height: 28,
      borderWidth: 1,
      borderColor: theme.borderStrong
    },
    legendText: {
      flex: 1,
      gap: 2
    },
    legendPlace: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "800"
    },
    legendProject: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    legendNumbers: {
      alignItems: "flex-end",
      gap: 2
    },
    legendDuration: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    legendShare: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    compactCategoryScroller: {
      gap: 7,
      paddingRight: 4
    },
    categoryPill: {
      minHeight: 38,
      borderWidth: 1,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 7,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    categoryPillText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    quickCategoryHint: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700",
      paddingHorizontal: 2,
      paddingTop: 2
    },
    colorDot: {
      width: 12,
      height: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 999
    },
    categoryList: {
      gap: 8
    },
    categoryRow: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    categoryRowPinned: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    categoryTextStack: {
      flex: 1,
      gap: 1,
      minWidth: 0
    },
    categoryName: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    categoryMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "700"
    },
    categoryMetaPinned: {
      color: theme.accent
    },
    categoryActions: {
      flexDirection: "row",
      gap: 4
    },
    categoryIconButton: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center"
    },
    categoryIconButtonSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    categoryIconButtonPrimary: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    categoryEditCard: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      padding: 10,
      gap: 10
    },
    categoryEditHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    categoryEditInput: {
      flex: 1,
      minHeight: 42
    },
    paletteGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    paletteSwatch: {
      width: 34,
      height: 34,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 999
    },
    paletteSwatchSelected: {
      borderWidth: 3,
      borderColor: theme.accent
    },
    categoryCreateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    categoryCreateInput: {
      flex: 1,
      minHeight: 42
    },
    textInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    primaryButton: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center"
    },
    primaryInlineButton: {
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      alignItems: "center"
    },
    startInputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    startInput: {
      flex: 1,
      minHeight: 44
    },
    playButton: {
      width: 52,
      height: 52,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.accent,
      shadowOpacity: theme.mode === "dark" ? 0.18 : 0.24,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3
    },
    stopButton: {
      width: 52,
      height: 52,
      borderWidth: 1,
      borderColor: theme.danger,
      backgroundColor: theme.danger,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.danger,
      shadowOpacity: theme.mode === "dark" ? 0.18 : 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3
    },
    deleteTimerButton: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.danger,
      backgroundColor: theme.surface,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    buttonPressed: {
      opacity: 0.84,
      transform: [{ translateY: 1 }]
    },
    buttonDisabled: {
      opacity: 0.45
    },
    primaryButtonText: {
      color: theme.mode === "dark" ? theme.background : "#FFFFFF",
      fontWeight: "800",
      fontFamily: monoFont
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10
    },
    toggleSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    secondaryButtonText: {
      color: theme.accent,
      fontWeight: "800",
      fontFamily: monoFont
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    settingsDivider: {
      height: 1,
      backgroundColor: theme.border,
      marginVertical: 8
    },
    accountList: {
      gap: 8
    },
    accountRow: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2
    },
    accountValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    accountMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    buttonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10
    },
    statusText: {
      fontSize: 13,
      color: theme.textPrimary,
      fontWeight: "700",
      fontFamily: monoFont
    },
    errorText: {
      borderWidth: 1,
      borderColor: theme.danger,
      color: theme.danger,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      fontFamily: monoFont
    }
  });
}
