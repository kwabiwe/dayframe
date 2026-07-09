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
    tabScreenStack: {
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
    floatingTabBarWrap: {
      position: "absolute",
      left: 16,
      right: 16,
      alignItems: "center"
    },
    floatingTabBarShell: {
      width: "100%",
      maxWidth: 420,
      minHeight: 72,
      borderRadius: 28,
      shadowColor: "#000000",
      shadowOpacity: theme.mode === "dark" ? 0.34 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8
    },
    floatingTabBarGlass: {
      minHeight: 72,
      borderWidth: 1,
      borderColor: theme.mode === "dark" ? "rgba(138, 215, 196, 0.24)" : "rgba(47, 118, 109, 0.18)",
      borderRadius: 28,
      padding: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      overflow: "hidden"
    },
    floatingTabBarFallback: {
      minHeight: 72,
      borderWidth: 1,
      borderColor: theme.mode === "dark" ? "rgba(138, 215, 196, 0.24)" : "rgba(47, 118, 109, 0.18)",
      backgroundColor: theme.mode === "dark" ? "rgba(23, 32, 40, 0.88)" : "rgba(255, 255, 255, 0.88)",
      borderRadius: 28,
      padding: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      overflow: "hidden"
    },
    floatingTabButton: {
      flex: 1,
      minHeight: 58,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      gap: 3
    },
    floatingTabButtonSelected: {
      backgroundColor: theme.mode === "dark" ? "rgba(138, 215, 196, 0.14)" : "rgba(47, 118, 109, 0.10)"
    },
    floatingTabLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800"
    },
    floatingTabLabelSelected: {
      color: theme.accent
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
    calendarWeekStrip: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: 6
    },
    calendarDayButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 64,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      gap: 4
    },
    calendarDayButtonSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    calendarDayButtonToday: {
      borderColor: theme.accentStrong
    },
    calendarWeekday: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800"
    },
    calendarDayNumber: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "800"
    },
    calendarDayTextSelected: {
      color: theme.accent
    },
    calendarOptionsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    calendarOptionChip: {
      minHeight: 38,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 13,
      alignItems: "center",
      justifyContent: "center"
    },
    calendarOptionChipSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    calendarOptionChipText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    calendarOptionChipTextSelected: {
      color: theme.accent
    },
    calendarTimelinePanel: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 16,
      overflow: "hidden"
    },
    calendarEdgeStack: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      paddingHorizontal: 10,
      paddingVertical: 10,
      gap: 8
    },
    calendarEdgeTimeRow: {
      minHeight: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 6
    },
    calendarOutsideBlock: {
      minHeight: 52,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: 13,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4,
      justifyContent: "center"
    },
    calendarTimelineCanvas: {
      position: "relative"
    },
    calendarHourLabel: {
      position: "absolute",
      left: 0,
      width: 68,
      height: 22,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800",
      textAlign: "right",
      paddingRight: 8
    },
    calendarHourLine: {
      position: "absolute",
      left: 68,
      right: 0,
      height: 1,
      backgroundColor: theme.border
    },
    calendarBlock: {
      position: "absolute",
      left: 76,
      right: 10,
      minHeight: 44,
      borderWidth: 1,
      borderRadius: 13,
      paddingHorizontal: 10,
      paddingVertical: 7,
      gap: 4,
      justifyContent: "center"
    },
    calendarBlockActive: {
      borderStyle: "dashed"
    },
    calendarBlockReview: {
      borderStyle: "dashed",
      opacity: 0.72
    },
    calendarBlockIntoNext: {
      borderBottomWidth: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0
    },
    calendarBlockTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      minWidth: 0
    },
    calendarBlockTitle: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    calendarBlockMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800"
    },
    calendarReviewLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 10,
      fontWeight: "800"
    },
    currentTimeRow: {
      position: "absolute",
      left: 0,
      right: 8,
      height: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 6
    },
    currentTimeLabel: {
      width: 68,
      color: theme.danger,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800",
      textAlign: "right",
      paddingRight: 8
    },
    currentTimeLine: {
      flex: 1,
      height: 2,
      borderRadius: 999,
      backgroundColor: theme.danger
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
    reviewList: {
      gap: 10
    },
    reviewCard: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      padding: 12,
      gap: 10
    },
    reviewCardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 10
    },
    reviewBadge: {
      alignSelf: "flex-start",
      minHeight: 28,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 10,
      justifyContent: "center"
    },
    reviewBadgeText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800"
    },
    reviewTitleStack: {
      flex: 1,
      minWidth: 0,
      gap: 4
    },
    reviewTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "800"
    },
    reviewMetaLine: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      lineHeight: 17
    },
    reviewActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    reviewPrimaryButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center"
    },
    reviewSecondaryButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center"
    },
    reviewSecondaryButtonText: {
      color: theme.accent,
      fontFamily: monoFont,
      fontWeight: "800"
    },
    reviewNote: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      lineHeight: 17
    },
    reportRangeRow: {
      flexDirection: "row",
      gap: 8
    },
    reportRangeChip: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center"
    },
    reportRangeChipSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    reportRangeChipText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    reportRangeChipTextSelected: {
      color: theme.accent
    },
    reportChartSwitchRow: {
      flexDirection: "row",
      alignSelf: "flex-start",
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      overflow: "hidden"
    },
    reportChartSwitchButton: {
      minHeight: 36,
      minWidth: 72,
      paddingHorizontal: 13,
      alignItems: "center",
      justifyContent: "center"
    },
    reportChartSwitchButtonSelected: {
      backgroundColor: theme.surfaceMuted
    },
    reportChartSwitchText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    reportChartSwitchTextSelected: {
      color: theme.accent
    },
    reportTotalsRow: {
      flexDirection: "row",
      gap: 10
    },
    reportTotalCard: {
      flex: 1,
      minHeight: 78,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      justifyContent: "space-between"
    },
    reportTotalValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 22,
      fontWeight: "800"
    },
    reportCategoryList: {
      gap: 12
    },
    reportCategoryRow: {
      flexDirection: "row",
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 12
    },
    reportCategorySwatch: {
      width: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 999
    },
    reportCategoryBody: {
      flex: 1,
      minWidth: 0,
      gap: 6
    },
    reportCategoryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    reportBarTrack: {
      height: 9,
      borderRadius: 999,
      backgroundColor: theme.chartTrack,
      overflow: "hidden"
    },
    reportBarFill: {
      height: "100%",
      borderRadius: 999
    },
    reportDailyChart: {
      height: 150,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      paddingTop: 8
    },
    reportDailySlot: {
      flex: 1,
      height: "100%",
      alignItems: "center",
      gap: 8
    },
    reportDailyTrack: {
      flex: 1,
      width: "100%",
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      justifyContent: "flex-end",
      overflow: "hidden"
    },
    reportDailyFill: {
      width: "100%",
      borderTopLeftRadius: 999,
      borderTopRightRadius: 999
    },
    reportDailyLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800"
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
    placeList: {
      gap: 8
    },
    placeRow: {
      minHeight: 62,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 9
    },
    placeTextStack: {
      flex: 1,
      gap: 3,
      minWidth: 0
    },
    placeName: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "800"
    },
    placeMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700"
    },
    placeActions: {
      flexDirection: "row",
      gap: 4
    },
    placeForm: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      padding: 12,
      gap: 10
    },
    placeFormRow: {
      flexDirection: "row",
      gap: 8
    },
    placeFormField: {
      flex: 1,
      minWidth: 0,
      gap: 5
    },
    coordinateInput: {
      minHeight: 46
    },
    radiusInput: {
      width: 112,
      textAlign: "center"
    },
    diagnosticText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      lineHeight: 16
    },
    warningText: {
      color: theme.danger,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700",
      lineHeight: 17
    },
    healthPreferenceList: {
      gap: 8
    },
    healthPreferenceRow: {
      minHeight: 58,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    healthPreferenceText: {
      flex: 1,
      minWidth: 0,
      gap: 3
    },
    categoryChoiceScroller: {
      gap: 8,
      paddingRight: 4
    },
    categoryChoice: {
      minHeight: 42,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    categoryChoiceSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    categoryChoiceText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    categoryChoiceTextSelected: {
      color: theme.accent
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
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.danger,
      backgroundColor: theme.danger,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.danger,
      shadowOpacity: theme.mode === "dark" ? 0.18 : 0.22,
      shadowRadius: 9,
      shadowOffset: { width: 0, height: 4 },
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
    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: theme.mode === "dark" ? "rgba(0, 0, 0, 0.56)" : "rgba(10, 18, 8, 0.32)"
    },
    sheetBackdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    },
    sheetKeyboardAvoidingView: {
      flex: 1,
      justifyContent: "flex-end"
    },
    sheetSafeArea: {
      flex: 1,
      justifyContent: "flex-end",
      width: "100%"
    },
    activeEditSheet: {
      maxHeight: "96%",
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 10,
      gap: 8,
      shadowColor: "#000000",
      shadowOpacity: theme.mode === "dark" ? 0.36 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: -8 },
      elevation: 8
    },
    sheetHandle: {
      alignSelf: "center",
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: theme.borderStrong
    },
    sheetHeader: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    sheetTitle: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 16,
      fontWeight: "800",
      textAlign: "center"
    },
    sheetIconButton: {
      width: 52,
      height: 52,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetSaveButton: {
      width: 52,
      height: 52,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.accent,
      shadowOpacity: theme.mode === "dark" ? 0.16 : 0.24,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3
    },
    activeEditScroller: {
      flexShrink: 1
    },
    activeEditScrollerKeyboard: {
      flex: 1
    },
    activeEditContent: {
      gap: 12,
      paddingBottom: 18
    },
    activeEditDeleteButton: {
      alignSelf: "center",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: 2
    },
    activeEditDeleteText: {
      color: theme.danger,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    activeEditHeroRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14
    },
    activeEditElapsedStack: {
      flex: 1,
      minWidth: 0
    },
    activeEditElapsed: {
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 40,
      fontWeight: "800"
    },
    activeEditElapsedLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    activeEditSection: {
      gap: 8
    },
    activeEditSectionLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    activeEditDescriptionInput: {
      minHeight: 52
    },
    activeEditCategoryScroller: {
      gap: 8,
      paddingRight: 4
    },
    activeEditCategoryChip: {
      minHeight: 42,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    activeEditCategoryChipSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    activeEditCategoryChipText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    activeEditCategoryChipTextSelected: {
      color: theme.accent
    },
    activeEditTimeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    activeEditDateInput: {
      flex: 1.25,
      minHeight: 48
    },
    activeEditTimeInput: {
      width: 108,
      minHeight: 56,
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 20,
      fontWeight: "800",
      textAlign: "center"
    },
    activeEditStartSummary: {
      flex: 1,
      minWidth: 0,
      minHeight: 56,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 9,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    activeEditStartSummaryText: {
      flex: 1,
      minWidth: 0
    },
    activeEditStartDate: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "800"
    },
    activeEditStartMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700"
    },
    activeEditStartTime: {
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 20,
      fontWeight: "800"
    },
    activeEditLastStopButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    activeEditLastStopText: {
      flex: 1,
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    activeEditLastStopMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    activeEditPickerPanel: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 16,
      padding: 12,
      gap: 12
    },
    activeEditPickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    activeEditPickerHeaderText: {
      flex: 1,
      minWidth: 0
    },
    activeEditPickerTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "800"
    },
    activeEditPickerMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700"
    },
    activeEditPickerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    activeEditPickerPrimaryButton: {
      minHeight: 36,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerPrimaryText: {
      color: theme.mode === "dark" ? theme.background : "#FFFFFF",
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    activeEditPickerSecondaryButton: {
      minHeight: 36,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerSecondaryText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    activeEditPickerShortcutRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    activeEditPickerChip: {
      minHeight: 34,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerChipText: {
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "800"
    },
    activeEditPickerGrid: {
      gap: 8
    },
    activeEditPickerStepper: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    activeEditPickerStepperLabel: {
      width: 58,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "800",
      textAlign: "left"
    },
    activeEditPickerStepperControls: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 6
    },
    activeEditPickerStepperButton: {
      width: 30,
      height: 30,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerStepperButtonText: {
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "800",
      lineHeight: 20
    },
    activeEditPickerStepperValue: {
      flex: 1,
      minWidth: 0,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "800",
      textAlign: "center"
    },
    activeEditStopButton: {
      width: 52,
      height: 52,
      borderWidth: 1,
      borderColor: theme.danger,
      backgroundColor: theme.danger,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.danger,
      shadowOpacity: theme.mode === "dark" ? 0.16 : 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3
    },
    activeEditStopButtonText: {
      color: theme.mode === "dark" ? theme.background : "#FFFFFF",
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "800"
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
    authSecondaryButton: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center"
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
    authSecondaryButtonText: {
      lineHeight: 18,
      textAlign: "center"
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
    queueDiagnosticCard: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4
    },
    detailsToggle: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: 4
    },
    detailsToggleText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
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
