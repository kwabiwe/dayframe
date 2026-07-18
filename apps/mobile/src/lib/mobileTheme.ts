import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";
import {
  StyleSheet,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { DAYFRAME_THEME, type DayframeTheme } from "@dayframe/shared";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";
export type MobileTheme = DayframeTheme & {
  mode: ThemeMode;
  pressed: string;
};
export type MobileStyles = ReturnType<typeof createStyles>;

type MobileThemeContextValue = {
  reloadThemePreference: () => Promise<void>;
  setThemePreference: (nextPreference: ThemePreference) => Promise<void>;
  styles: MobileStyles;
  theme: MobileTheme;
  themePreference: ThemePreference;
};

export const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

const THEME_PREFERENCE_KEY = "dayframe.themePreference.v1";
const monoFont = "System";
const MobileThemeContext = createContext<MobileThemeContextValue | null>(null);

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const [hydrated, setHydrated] = useState(false);

  const reloadThemePreference = useCallback(async () => {
    const value = await AsyncStorage.getItem(THEME_PREFERENCE_KEY).catch(() => null);
    if (isThemePreference(value)) setThemePreferenceState(value);
  }, []);

  useEffect(() => {
    void reloadThemePreference().finally(() => setHydrated(true));
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

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background).catch(() => undefined);
  }, [theme.background]);

  const value = useMemo<MobileThemeContextValue>(() => ({
    reloadThemePreference,
    setThemePreference,
    styles,
    theme,
    themePreference
  }), [reloadThemePreference, setThemePreference, styles, theme, themePreference]);

  return createElement(
    MobileThemeContext.Provider,
    { value },
    hydrated
      ? children
      : createElement(View, {
          accessibilityElementsHidden: true,
          importantForAccessibility: "no-hide-descendants",
          style: { flex: 1, backgroundColor: theme.background }
        })
  );
}

export function useMobileTheme() {
  const value = useContext(MobileThemeContext);
  if (!value) throw new Error("useMobileTheme must be used within MobileThemeProvider");
  return value;
}

export function createMobileTheme(mode: ThemeMode): MobileTheme {
  const base = DAYFRAME_THEME[mode];
  return {
    ...base,
    mode,
    pressed: base.accentPressed
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
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 20,
      backgroundColor: theme.background
    },
    contentStack: {
      gap: 12
    },
    todayListHeader: {
      marginBottom: 12
    },
    todayListContent: {
      paddingBottom: 112
    },
    settingsScrollView: {
      flex: 1
    },
    settingsScrollContent: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 18,
      backgroundColor: theme.background
    },
    settingsFloatingHeader: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 10,
      backgroundColor: theme.background,
      zIndex: 10
    },
    tabScreenStack: {
      gap: 12
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 2,
      paddingTop: 2
    },
    nativeCalendarScreen: {
      flex: 1,
      backgroundColor: theme.background
    },
    nativeCalendarHeader: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 4,
      backgroundColor: theme.background
    },
    nativeCalendarView: {
      flex: 1,
      backgroundColor: theme.background
    },
    settingsHeader: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    settingsGroup: {
      gap: 8
    },
    settingsGroupTitle: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      paddingHorizontal: 4
    },
    settingsGroupRows: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      overflow: "hidden"
    },
    settingsMenuRow: {
      minHeight: 58,
      paddingHorizontal: 14,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 11
    },
    settingsMenuDivider: {
      position: "absolute",
      left: 61,
      right: 14,
      bottom: 0,
      height: 1,
      backgroundColor: theme.border
    },
    settingsMenuIcon: {
      width: 36,
      height: 36,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center"
    },
    settingsMenuText: {
      flex: 1,
      minWidth: 0,
      gap: 3
    },
    settingsMenuTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600"
    },
    settingsMenuMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "500"
    },
    appearanceStack: {
      gap: 14
    },
    appearanceIntro: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: 2
    },
    appearanceSelectionCard: {
      backgroundColor: theme.accentSoft,
      borderRadius: 18,
      padding: 16,
      gap: 5
    },
    appearanceSelectionTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 16,
      fontWeight: "600"
    },
    appearanceSelectionMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      lineHeight: 18
    },
    appearanceSectionLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      paddingHorizontal: 2,
      marginTop: 4
    },
    appearancePreviewRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12
    },
    appearancePreviewColumn: {
      flex: 1,
      minWidth: 0,
      gap: 8
    },
    appearancePreviewLabel: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600",
      paddingHorizontal: 2
    },
    appearancePreviewCard: {
      borderRadius: 20,
      padding: 12,
      gap: 10
    },
    appearancePreviewCardLight: {
      backgroundColor: "#FFFFFF"
    },
    appearancePreviewCardDark: {
      backgroundColor: "#050914"
    },
    appearancePreviewCardSelected: {
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3
    },
    appearancePreviewSurface: {
      minHeight: 76,
      borderRadius: 14,
      padding: 12,
      gap: 9,
      justifyContent: "center"
    },
    appearancePreviewSurfaceLight: {
      backgroundColor: "#F4F6F9"
    },
    appearancePreviewSurfaceDark: {
      backgroundColor: "#1B2230"
    },
    appearancePreviewLine: {
      height: 7,
      width: "68%",
      borderRadius: 999
    },
    appearancePreviewLineShort: {
      height: 7,
      width: "88%",
      borderRadius: 999
    },
    appearancePreviewLineLight: {
      backgroundColor: "#111827"
    },
    appearancePreviewLineDark: {
      backgroundColor: "#F7F8FB"
    },
    appearancePreviewLineMutedLight: {
      backgroundColor: "#667085"
    },
    appearancePreviewLineMutedDark: {
      backgroundColor: "#8993A7"
    },
    appearancePreviewAccent: {
      width: 48,
      height: 8,
      borderRadius: 999,
      backgroundColor: "#F45D43"
    },
    appearancePreviewPill: {
      minHeight: 38,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8
    },
    appearancePreviewPillLight: {
      backgroundColor: "#EEF1F6"
    },
    appearancePreviewPillDark: {
      backgroundColor: "#202838"
    },
    appearancePreviewPillText: {
      color: "#111827",
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "500"
    },
    appearancePreviewPillTextDark: {
      color: "#F7F8FB"
    },
    appearanceDetailsCard: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      overflow: "hidden",
      paddingHorizontal: 14
    },
    appearanceDetailRow: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    appearanceDetailDivider: {
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    appearanceDetailTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "500"
    },
    appearanceDetailMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "400",
      textAlign: "right"
    },
    logoLockup: {
      flexShrink: 1,
      gap: 4
    },
    datePill: {
      minHeight: 38,
      borderRadius: 999,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5
    },
    datePillText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    todayHeading: {
      gap: 2,
      paddingHorizontal: 2,
      paddingBottom: 2
    },
    todayTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 28,
      fontWeight: "700",
      letterSpacing: -0.35
    },
    todaySubtitle: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "400"
    },
    iconButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    title: {
      fontSize: 30,
      fontWeight: "700",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    settingsTitle: {
      flex: 1,
      fontSize: 22,
      fontWeight: "700",
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
      backgroundColor: theme.surface,
      borderRadius: 18,
      padding: 14,
      gap: 10
    },
    timerPanel: {
      position: "relative",
      backgroundColor: theme.surfaceRaised,
      borderRadius: 18,
      minHeight: 104,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 8,
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: theme.mode === "dark" ? 12 : 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2
    },
    activeTimerAccentRail: {
      position: "absolute",
      left: 0,
      top: 12,
      bottom: 12,
      width: 4,
      borderRadius: 999
    },
    lifecyclePanel: {
      backgroundColor: theme.surfaceRaised,
      borderRadius: 18,
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
      minHeight: 56,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      gap: 4
    },
    calendarDayButtonSelected: {
      backgroundColor: theme.accentSoft
    },
    calendarDayButtonToday: {
      backgroundColor: theme.surfaceMuted
    },
    calendarWeekday: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600"
    },
    calendarDayNumber: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "600"
    },
    calendarDayTextSelected: {
      color: theme.accentText
    },
    calendarOptionsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    calendarOptionChip: {
      minHeight: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 13,
      alignItems: "center",
      justifyContent: "center"
    },
    calendarOptionChipSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft
    },
    calendarOptionChipText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    calendarOptionChipTextSelected: {
      color: theme.accentText
    },
    calendarTimelinePanel: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 18,
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
      borderRadius: 13,
      backgroundColor: theme.surfaceMuted,
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
      fontWeight: "600",
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
      borderRadius: 13,
      paddingHorizontal: 10,
      paddingVertical: 7,
      gap: 4,
      justifyContent: "center"
    },
    calendarBlockCompact: {
      paddingVertical: 4,
      gap: 0
    },
    calendarBlockTiny: {
      borderRadius: 8,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    calendarBlockActive: {
      borderStyle: "dashed"
    },
    calendarBlockReview: {
      borderStyle: "dashed",
      opacity: 0.72
    },
    calendarBlockFromPrevious: {
      borderTopWidth: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0
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
      fontWeight: "600"
    },
    calendarBlockMeta: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600"
    },
    calendarReviewLabel: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 10,
      fontWeight: "600"
    },
    currentTimeRow: {
      position: "absolute",
      left: 68,
      right: 8,
      height: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 6
    },
    currentTimeLabel: {
      width: 68,
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600",
      textAlign: "right",
      paddingRight: 8
    },
    currentTimeLine: {
      flex: 1,
      height: 2,
      borderRadius: 999,
      backgroundColor: theme.accent
    },
    label: {
      fontSize: 11,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontWeight: "600",
      letterSpacing: 0.5
    },
    timerText: {
      fontSize: 18,
      fontWeight: "600",
      color: theme.textPrimary,
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
    activeTimerExpandedContent: {
      overflow: "hidden",
      gap: 5
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
    activeTitlePlaceholderText: {
      color: theme.textSecondary,
      fontWeight: "700"
    },
    activeDescription: {
      fontSize: 14,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    activeElapsed: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 30,
      fontWeight: "700",
      fontVariant: ["tabular-nums"]
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
      fontSize: 17,
      fontWeight: "600",
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
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 20,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
    },
    segmentedControl: {
      flexDirection: "row",
      borderRadius: 999,
      backgroundColor: theme.mode === "dark" ? theme.surfaceMuted : theme.textPrimary,
      padding: 4
    },
    segmentButton: {
      flex: 1,
      minHeight: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 999,
      paddingVertical: 7
    },
    segmentButtonSelected: {
      backgroundColor: theme.mode === "dark" ? theme.textPrimary : theme.surfaceRaised
    },
    segmentButtonText: {
      color: theme.mode === "dark" ? theme.textSecondary : theme.surface,
      fontFamily: monoFont,
      fontWeight: "600"
    },
    segmentButtonTextSelected: {
      color: theme.mode === "dark" ? theme.background : theme.textPrimary
    },
    chartWrap: {
      alignItems: "center",
      paddingVertical: 2
    },
    chartBox: {
      width: 184,
      height: 184,
      alignItems: "center",
      justifyContent: "center"
    },
    chartCenter: {
      position: "absolute",
      width: 86,
      height: 86,
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
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
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
      height: 32,
      borderRadius: 999,
      overflow: "hidden"
    },
    legendText: {
      flex: 1,
      gap: 2
    },
    legendPlace: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600"
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
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
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
      backgroundColor: theme.surfaceRaised,
      borderRadius: 16,
      padding: 14,
      gap: 12
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
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 10,
      justifyContent: "center"
    },
    reviewBadgeText: {
      color: theme.warningText,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600"
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
      fontWeight: "600"
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
      backgroundColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center"
    },
    reviewSecondaryButton: {
      minHeight: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center"
    },
    reviewSecondaryButtonText: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontWeight: "600"
    },
    reviewNote: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      lineHeight: 17
    },
    reviewNoteButton: {
      minHeight: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    reviewNoteText: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
      lineHeight: 17
    },
    reviewNoteAction: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    reportRangeRow: {
      flexDirection: "row",
      gap: 8
    },
    reportScreenTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 28,
      fontWeight: "700",
      letterSpacing: -0.35
    },
    reportRangeChip: {
      minHeight: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center"
    },
    reportRangeChipSelected: {
      backgroundColor: theme.accentSoft
    },
    reportRangeChipText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    reportRangeChipTextSelected: {
      color: theme.accentText
    },
    reportChartSwitchRow: {
      flexDirection: "row",
      alignSelf: "flex-start",
      backgroundColor: theme.mode === "dark" ? theme.surfaceMuted : theme.textPrimary,
      borderRadius: 999,
      padding: 4
    },
    reportChartSwitchButton: {
      minHeight: 36,
      minWidth: 68,
      borderRadius: 999,
      paddingHorizontal: 13,
      alignItems: "center",
      justifyContent: "center"
    },
    reportChartSwitchButtonSelected: {
      backgroundColor: theme.mode === "dark" ? theme.textPrimary : theme.surfaceRaised
    },
    reportChartSwitchText: {
      color: theme.mode === "dark" ? theme.textSecondary : theme.surface,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    reportChartSwitchTextSelected: {
      color: theme.mode === "dark" ? theme.background : theme.textPrimary
    },
    reportTotalsRow: {
      flexDirection: "row",
      gap: 10
    },
    reportTotalCard: {
      flex: 1,
      minHeight: 78,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      justifyContent: "space-between"
    },
    reportTotalValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 22,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
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
      height: 36,
      borderRadius: 999,
      overflow: "hidden"
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
    reportBarFillUncategorized: {
      backgroundColor: theme.surfaceMuted
    },
    uncategorizedSwatch: {
      backgroundColor: theme.surfaceMuted
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
      backgroundColor: theme.surfaceMuted,
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
      fontWeight: "600"
    },
    todaySummaryBlock: {
      gap: 8
    },
    historyDayGap: {
      height: 14
    },
    historyDayTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600",
      paddingHorizontal: 2
    },
    todayEntryCard: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      overflow: "hidden",
      paddingHorizontal: 14
    },
    todayEntryRow: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: 4
    },
    todayEntryDivider: {
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    todayEntryDot: {
      width: 9,
      height: 9,
      borderRadius: 999
    },
    todayEntryText: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    todayEntryTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600"
    },
    todayEntryMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "400"
    },
    todayEntryDuration: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
    },
    historyEntryMain: {
      flex: 1,
      minWidth: 0,
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    historyGroupCountBadge: {
      minWidth: 34,
      height: 34,
      borderRadius: 999,
      paddingHorizontal: 8,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center"
    },
    historyGroupCountText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
    },
    historyGroupChildren: {
      marginLeft: 44,
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    historyGroupChild: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingLeft: 10
    },
    historyGroupChildDivider: {
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    historyGroupChildTime: {
      flex: 1,
      minWidth: 0,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "500",
      fontVariant: ["tabular-nums"]
    },
    historyEntryActions: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 3
    },
    historyReplayButton: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    historySwipeDeleteActionPressable: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    todayEmptyText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      lineHeight: 18,
      paddingVertical: 18
    },
    todayTrackedRow: {
      minHeight: 48,
      borderRadius: 16,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    todayTrackedLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "500"
    },
    todayTrackedValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 17,
      fontWeight: "700",
      fontVariant: ["tabular-nums"]
    },
    compactCategoryScroller: {
      gap: 7,
      paddingRight: 4
    },
    quickActionsInline: {
      flexGrow: 0,
      minHeight: 44
    },
    categoryPillTouch: {
      minHeight: 44,
      justifyContent: "center"
    },
    categoryPill: {
      minHeight: 32,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    categoryPillMuted: {
      backgroundColor: theme.surfaceMuted
    },
    categoryPillText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
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
      width: 9,
      height: 9,
      borderRadius: 999
    },
    colorDotMuted: {
      backgroundColor: "transparent",
      borderColor: theme.textSecondary
    },
    categoryList: {
      gap: 0
    },
    placeList: {
      gap: 8
    },
    placeRow: {
      minHeight: 62,
      backgroundColor: theme.surfaceRaised,
      borderRadius: 16,
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
      fontWeight: "600"
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
    learnedPlaceSaveButton: {
      minHeight: 44,
      minWidth: 52,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 0,
      alignItems: "center",
      justifyContent: "center"
    },
    learnedPlaceSaveButtonText: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
      lineHeight: 16,
      textAlign: "center"
    },
    placeForm: {
      backgroundColor: theme.surfaceRaised,
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
      color: theme.warningText,
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
      backgroundColor: theme.surfaceRaised,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 12
    },
    healthPreferenceHeader: {
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
    healthMappingPanel: {
      gap: 8
    },
    healthMappingLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600",
      textTransform: "uppercase"
    },
    healthMappingInput: {
      minHeight: 44
    },
    categoryChoiceScroller: {
      gap: 8,
      paddingRight: 4
    },
    categoryChoice: {
      minHeight: 32,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    categoryChoiceSelected: {
      backgroundColor: theme.accentSoft
    },
    categoryChoiceText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
      lineHeight: 16
    },
    categoryChoiceTextSelected: {
      color: theme.accentText
    },
    categoryRow: {
      minHeight: 54,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: "transparent",
      paddingHorizontal: 2,
      paddingVertical: 5,
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    categoryRowPinned: {
      backgroundColor: "transparent"
    },
    categoryRowMain: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8
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
      fontWeight: "600"
    },
    categoryMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "400"
    },
    categoryMetaPinned: {
      color: theme.accentText
    },
    categoryActions: {
      flexDirection: "row",
      gap: 4
    },
    categoryIconButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    categoryIconButtonSelected: {
      backgroundColor: theme.accentSoft
    },
    categoryIconButtonPrimary: {
      width: 44,
      height: 44,
      backgroundColor: theme.accent,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    categoryEditCard: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 16,
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
      minHeight: 44
    },
    paletteGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    paletteSwatch: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.controlBorder,
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
      minHeight: 44
    },
    textInput: {
      minHeight: 48,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    primaryButton: {
      marginTop: 8,
      minHeight: 48,
      backgroundColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 0,
      alignItems: "center",
      justifyContent: "center"
    },
    primaryInlineButton: {
      minHeight: 44,
      backgroundColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 0,
      alignItems: "center",
      justifyContent: "center"
    },
    startInputRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8
    },
    startComposerMain: {
      flex: 1,
      minWidth: 0,
      gap: 8
    },
    startInput: {
      flex: 1,
      minHeight: 44,
      justifyContent: "center"
    },
    startInputText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600",
      lineHeight: 18
    },
    startActionColumn: {
      gap: 8
    },
    playButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.accent,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3
    },
    addPastTimeButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.accentSoft,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    stopButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.accent,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3
    },
    deleteTimerButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.danger,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: theme.overlay
    },
    datePickerOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      justifyContent: "flex-start",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: 118,
      backgroundColor: theme.overlay
    },
    datePickerSheet: {
      width: "100%",
      maxWidth: 361,
      borderRadius: 24,
      backgroundColor: theme.surfaceRaised,
      padding: 16,
      gap: 10,
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8
    },
    datePickerHeader: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8
    },
    datePickerNavButton: {
      width: 44,
      height: 44,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center"
    },
    datePickerMonth: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center"
    },
    datePickerWeekdays: {
      flexDirection: "row"
    },
    datePickerWeekday: {
      width: `${100 / 7}%`,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600",
      textAlign: "center"
    },
    datePickerGrid: {
      flexDirection: "row",
      flexWrap: "wrap"
    },
    datePickerDay: {
      width: `${100 / 7}%`,
      minHeight: 44,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    datePickerDayToday: {
      backgroundColor: theme.surfaceMuted
    },
    datePickerDaySelected: {
      backgroundColor: theme.accent
    },
    datePickerDayText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "500",
      fontVariant: ["tabular-nums"]
    },
    datePickerDayTextOutside: {
      color: theme.textSecondary,
      opacity: 0.5
    },
    datePickerDayTextSelected: {
      color: theme.onAccent,
      fontWeight: "700"
    },
    datePickerActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      paddingTop: 2
    },
    datePickerTodayButton: {
      minHeight: 44,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center"
    },
    datePickerTodayText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    datePickerDoneButton: {
      minHeight: 44,
      borderRadius: 999,
      backgroundColor: theme.accent,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center"
    },
    datePickerDoneText: {
      color: theme.onAccent,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "700"
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
      backgroundColor: theme.surfaceRaised,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 10,
      gap: 8,
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: -8 },
      elevation: 8
    },
    sheetDeleteConfirmationOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 10,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
      backgroundColor: theme.overlay,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24
    },
    deleteConfirmationModalRoot: {
      flex: 1
    },
    screenDeleteConfirmationOverlay: {
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0
    },
    sheetDeleteConfirmationCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 20,
      backgroundColor: theme.surfaceRaised,
      padding: 18,
      gap: 12,
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10
    },
    sheetDeleteConfirmationTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "700"
    },
    sheetDeleteConfirmationText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 14,
      lineHeight: 20
    },
    sheetDeleteConfirmationActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      paddingTop: 4
    },
    sheetDeleteConfirmationCancel: {
      minHeight: 44,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetDeleteConfirmationCancelText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    sheetDeleteConfirmationDelete: {
      minHeight: 44,
      borderRadius: 999,
      backgroundColor: theme.danger,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetDeleteConfirmationDeleteText: {
      color: theme.onDanger,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "700"
    },
    sheetHandle: {
      alignSelf: "center",
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: theme.borderStrong
    },
    sheetHeader: {
      minHeight: 42,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    sheetHeaderRunning: {
      justifyContent: "flex-end"
    },
    sheetHeaderCentered: {
      justifyContent: "center"
    },
    sheetTitle: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "600",
      textAlign: "left"
    },
    sheetTitleCentered: {
      flex: 0,
      textAlign: "center"
    },
    sheetIconButton: {
      width: 52,
      height: 52,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetHeaderSpacer: {
      width: 52,
      height: 52
    },
    sheetSaveButton: {
      width: 52,
      height: 52,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetDoneButton: {
      minHeight: 36,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center"
    },
    sheetDoneText: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    sheetProgressSlot: {
      height: 3,
      borderRadius: 999,
      backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(8,14,24,0.08)",
      overflow: "hidden"
    },
    sheetProgressFill: {
      width: 118,
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.accent
    },
    activeEditScroller: {
      flexShrink: 1,
      minHeight: 0
    },
    activeEditScrollerKeyboard: {
      flex: 1,
      minHeight: 0
    },
    activeEditContent: {
      gap: 10,
      paddingBottom: 8
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
      color: theme.dangerText,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    activeEditHeroRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    activeEditElapsedStack: {
      flex: 1,
      minWidth: 0,
      alignItems: "flex-start"
    },
    activeEditElapsed: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 34,
      fontWeight: "700",
      fontVariant: ["tabular-nums"]
    },
    activeEditElapsedLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    activeEditSection: {
      gap: 8
    },
    activeEditSectionLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    taskSuggestionsPanel: {
      backgroundColor: theme.surfaceMuted,
      borderRadius: 16,
      overflow: "hidden"
    },
    taskSuggestionsTitle: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.4,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    taskSuggestionsList: {
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    taskSuggestionRow: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    taskSuggestionRowDivider: {
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    taskSuggestionTextStack: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    taskSuggestionTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "500",
      flexShrink: 1,
      minWidth: 0
    },
    taskSuggestionMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      flexShrink: 2,
      minWidth: 0
    },
    taskSuggestionMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "400",
      flexShrink: 1
    },
    activeEditDescriptionInput: {
      minHeight: 48
    },
    activeEditCategoryScroller: {
      gap: 8,
      paddingRight: 4
    },
    activeEditCategoryChip: {
      minHeight: 32,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 7
    },
    activeEditCategoryChipSelected: {
      backgroundColor: theme.accentSoft
    },
    activeEditCategoryChipText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
      lineHeight: 16
    },
    activeEditCategoryChipTextSelected: {
      color: theme.textPrimary
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
      width: 94,
      minHeight: 48,
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlign: "center"
    },
    activeEditStartSummary: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
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
      fontSize: 14,
      fontWeight: "600"
    },
    activeEditStartMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700"
    },
    activeEditStartTime: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 20,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
    },
    activeEditLastStopButton: {
      minHeight: 36,
      borderWidth: 0,
      borderColor: "transparent",
      backgroundColor: "transparent",
      borderRadius: 12,
      paddingHorizontal: 2,
      paddingVertical: 4,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    activeEditLastStopText: {
      flex: 1,
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    activeEditLastStopMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    activeEditPickerPanel: {
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
      fontWeight: "600"
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
      minHeight: 44,
      backgroundColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerPrimaryText: {
      color: theme.onAccent,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    activeEditPickerSecondaryButton: {
      minHeight: 44,
      backgroundColor: theme.surfaceRaised,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerSecondaryText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    activeEditPickerShortcutRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    activeEditPickerChip: {
      minHeight: 44,
      backgroundColor: theme.surfaceRaised,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerChipText: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    activeEditPickerGrid: {
      gap: 8
    },
    activeEditPickerStepper: {
      backgroundColor: theme.surfaceRaised,
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
      fontWeight: "600",
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
      width: 44,
      height: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditPickerStepperButtonText: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "600",
      lineHeight: 20
    },
    activeEditPickerStepperValue: {
      flex: 1,
      minWidth: 0,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600",
      textAlign: "center"
    },
    activeEditStopButton: {
      width: 44,
      height: 44,
      backgroundColor: theme.accent,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 9,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3
    },
    activeEditStartButton: {
      width: 52,
      height: 52,
      backgroundColor: theme.accentSoft,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditStopButtonText: {
      color: theme.onAccent,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600"
    },
    buttonPressed: {
      borderColor: theme.pressed,
      opacity: 0.88,
      transform: [{ translateY: 1 }]
    },
    buttonDisabled: {
      opacity: 0.62,
      borderColor: theme.disabled
    },
    primaryButtonText: {
      color: theme.onAccent,
      fontWeight: "600",
      fontFamily: monoFont,
      fontSize: 13,
      lineHeight: 17,
      textAlign: "center"
    },
    secondaryButton: {
      minHeight: 44,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 0,
      alignItems: "center",
      justifyContent: "center"
    },
    authSecondaryButton: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center"
    },
    toggleSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft
    },
    secondaryButtonText: {
      color: theme.accentText,
      fontWeight: "600",
      fontFamily: monoFont,
      fontSize: 13,
      lineHeight: 17,
      textAlign: "center"
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
      backgroundColor: theme.surfaceRaised,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2
    },
    learnedPlaceDetailHeader: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8
    },
    learnedPlaceCopyButton: {
      minHeight: 44,
      minWidth: 72,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10
    },
    learnedPlaceCopyText: {
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    copyToast: {
      alignSelf: "center",
      backgroundColor: theme.surfaceRaised,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 9
    },
    copyToastText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600"
    },
    copyToastOverlay: {
      position: "absolute",
      left: 24,
      right: 24,
      bottom: 24,
      alignItems: "center",
      zIndex: 3
    },
    historyDeleteUndoToast: {
      position: "absolute",
      left: 20,
      right: 20,
      bottom: 92,
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      backgroundColor: theme.textPrimary,
      borderRadius: 999,
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 8,
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5
    },
    historyDeleteUndoText: {
      flex: 1,
      color: theme.background,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    historyDeleteUndoButton: {
      minWidth: 64,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: 10
    },
    historyDeleteUndoButtonText: {
      color: theme.onAccent,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "700"
    },
    accountValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    accountMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    queueDiagnosticCard: {
      backgroundColor: theme.surfaceRaised,
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
      fontWeight: "600"
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
      color: theme.dangerText,
      backgroundColor: theme.surfaceMuted,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      fontFamily: monoFont
    }
  });
}
