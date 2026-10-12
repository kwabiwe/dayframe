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
import { MOBILE_DISPLAY_FONT } from "./mobileTypography";
import * as SystemUI from "expo-system-ui";
import {
  StyleSheet,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { DAYFRAME_BLOCKS, DAYFRAME_THEME, type DayframeTheme } from "@dayframe/shared";
import {
  TIMER_CARD_ACTION_COLUMN_GAP,
  TIMER_CARD_ACTION_COLUMN_WIDTH,
  TIMER_CARD_CONTENT_MIN_HEIGHT,
  TIMER_CARD_CONTENT_TO_ACTION_GAP,
  TIMER_CARD_DESCRIPTION_TO_QUICK_ACTIONS_SPACING,
  TIMER_CARD_HORIZONTAL_INSET,
  TIMER_CARD_LABEL_TO_PILL_SPACING,
  TIMER_CARD_MIN_HEIGHT,
  TIMER_CARD_QUICK_ACTION_LABEL_LINE_HEIGHT,
  TIMER_CARD_QUICK_ACTION_PILL_HEIGHT,
  TIMER_CARD_TRAILING_SCROLL_INSET,
  TIMER_CARD_VERTICAL_INSET
} from "./timerCardLayout";

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

const THEME_PREFERENCE_KEY = "dayframe.themePreference.v1";
const monoFont = "System";
const TIME_ENTRY_SHEET_TOP_ACTION_MIN_TARGET = 44;
const TIME_ENTRY_SHEET_TITLE_ACTION_CLEARANCE = 104;
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
    todayListFooter: {
      paddingTop: 22
    },
    reportsScrollContent: {
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
      paddingTop: 14,
      paddingBottom: 4,
      backgroundColor: theme.background
    },
    nativeCalendarView: {
      flex: 1,
      backgroundColor: theme.background
    },
    // Blocks parity step 6a-1: the Settings index (prototype grouped lists).
    settingsBlocksStack: {
      gap: 22
    },
    settingsSignOut: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderRadius: 999,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      minHeight: 50,
      paddingHorizontal: 20
    },
    settingsSignOutText: {
      color: theme.textPrimary,
      fontSize: 16,
      fontWeight: "700"
    },
    settingsFooter: {
      color: theme.textMuted,
      marginTop: -8,
      textAlign: "center"
    },
    settingsGroupRows: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      overflow: "hidden"
    },
    logoLockup: {
      alignItems: "center",
      flexDirection: "row",
      flexShrink: 1,
      gap: 8
    },
    environmentBadge: {
      backgroundColor: theme.warning,
      borderRadius: 999,
      color: theme.background,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
      letterSpacing: 0.6,
      overflow: "hidden",
      flexShrink: 0,
      paddingHorizontal: 8,
      paddingVertical: 5
    },
    todayTitle: {
      color: theme.textPrimary,
      // Blocks display face for the Today title (docs/brand-style-guide.md, Typography).
      fontFamily: MOBILE_DISPLAY_FONT.extraBold,
      fontSize: 30,
      letterSpacing: -0.6
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
    calendarBlockMeta: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600"
    },
    label: {
      fontSize: 11,
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontWeight: "600",
      letterSpacing: 0.5
    },
    activeDescription: {
      fontSize: 14,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    muted: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    sectionTitle: {
      fontSize: 17,
      fontWeight: "600",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    legendText: {
      flex: 1,
      gap: 2
    },
    // Review deck (Blocks parity step 5a): prototype `.push` nav and padding.
    // Anchored to the round actions: the toast's bottom edge sits 12 points above them.
    // Above the deck's cards (their zIndex sets a layer position), so the toast is never hidden.
    reviewDeckActionsAnchor: {
      position: "relative",
      zIndex: 20
    },
    reviewDeckToast: {
      position: "absolute",
      bottom: "100%",
      left: 0,
      marginBottom: 12,
      right: 0,
      zIndex: 20
    },
    // Under Back to Today once all is framed.
    // Under Back to Today, out of flow: the summary stays readable and nothing moves on timeout.
    // Sits in the space its parent reserves below the last control (paddingBottom 84).
    reviewDeckToastUnderButton: {
      bottom: 0,
      marginBottom: 0
    },
    // Blocks navigation bar for pushed pages (BlocksNavHeader; UIA-001): text back, centred title,
    // trailing slot. The side slots flex equally so the title stays centred.
    blocksNav: {
      alignItems: "center",
      backgroundColor: theme.background,
      flexDirection: "row",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 16,
      paddingTop: 2,
      zIndex: 10
    },
    blocksNavBack: {
      alignItems: "center",
      alignSelf: "stretch",
      flex: 1,
      flexDirection: "row",
      gap: 2,
      minHeight: 44,
      minWidth: 0
    },
    blocksNavBackText: {
      flexShrink: 1,
      fontSize: 16,
      fontWeight: "600"
    },
    blocksNavTitle: {
      color: theme.textPrimary,
      flexShrink: 1,
      fontSize: 16,
      fontWeight: "700",
      maxWidth: "50%",
      textAlign: "center"
    },
    blocksNavTrailing: {
      alignItems: "flex-end",
      flex: 1,
      justifyContent: "center",
      minWidth: 0
    },
    reviewDeckNavCount: {
      color: theme.textSecondary,
      fontSize: 14,
      fontVariant: ["tabular-nums"],
      fontWeight: "600",
      textAlign: "right"
    },
    reviewDeckContent: {
      flexGrow: 1,
      gap: 12,
      paddingBottom: 18,
      paddingHorizontal: 20
    },
    reviewDeckWaiting: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center"
    },
    reviewDeckWaitingContent: {
      alignItems: "center",
      alignSelf: "stretch",
      gap: 12,
      // Room for the Undo toast hanging below (REVIEW_DECK_TOAST_RESERVE in ReviewDeck.tsx).
      paddingBottom: 84,
      position: "relative"
    },
    reviewMetaLine: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      lineHeight: 17
    },
    overflowMenuOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      alignItems: "center",
      paddingHorizontal: 12
    },
    overflowMenuBackdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.overlay
    },
    overflowMenuDismissLayer: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    },
    overflowMenuSurface: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 20,
      backgroundColor: theme.surfaceRaised,
      paddingVertical: 6,
      overflow: "hidden",
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10
    },
    overflowMenuRow: {
      minHeight: 48,
      paddingHorizontal: 18,
      paddingVertical: 12,
      justifyContent: "center"
    },
    overflowMenuRowText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600"
    },
    overflowMenuDangerText: {
      color: theme.dangerText,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600"
    },
    settingsNewActivity: {
      alignItems: "center",
      backgroundColor: theme.accent,
      borderRadius: 999,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      minHeight: 52
    },
    settingsNewActivityText: { color: theme.onAccent, fontFamily: monoFont, fontSize: 16, fontWeight: "700" },
    settingsActivityRow: { alignItems: "center", flexDirection: "row", minHeight: 60, paddingRight: 8 },
    settingsActivityRowDivider: { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
    settingsActivityOpen: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12, minHeight: 60, paddingLeft: 16, paddingVertical: 8 },
    settingsActivityBlock: { alignItems: "center", borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
    settingsActivityText: { flex: 1, minWidth: 0 },
    settingsActivityName: { color: theme.textPrimary, fontFamily: monoFont, fontSize: 15, fontWeight: "600" },
    settingsActivityMeta: { color: theme.textMuted, fontFamily: monoFont, fontSize: 13 },
    settingsActivityBlockArchived: { opacity: 0.6 },
    // Blocks parity step 7a: the Places page rows (Home and Work, Saved places, Suggested places).
    placesRow: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 60, paddingRight: 12 },
    placesRowMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12, minHeight: 60, paddingLeft: 16, paddingVertical: 10 },
    placesRowPressed: { backgroundColor: theme.surfaceMuted },
    placesRowActions: { flexDirection: "row", gap: 6 },
    placesBlock: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
    placesBlockSuggested: { opacity: 0.75 },
    placesEmpty: { minHeight: 52, justifyContent: "center", paddingHorizontal: 16 },
    placesStatus: { color: theme.textSecondary, fontFamily: monoFont, fontSize: 13, textAlign: "center" },
    settingsActivityPin: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, height: 44, justifyContent: "center", width: 44 },
    settingsActivityPinOn: { backgroundColor: theme.surfaceInset },
    healthNameRow: {
      alignItems: "center",
      borderTopColor: theme.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    healthNameLabel: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600"
    },
    healthNameInput: {
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      color: theme.textPrimary,
      flex: 1,
      fontFamily: monoFont,
      fontSize: 15,
      minHeight: 44,
      paddingHorizontal: 12
    },
    overflowMenuScroll: {
      flexGrow: 0,
      flexShrink: 1
    },
    overflowMenuCancelText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 15,
      fontWeight: "600"
    },
    overflowMenuSectionLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 0.4,
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 4,
      textTransform: "uppercase"
    },
    overflowMenuDivider: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: 18,
      backgroundColor: theme.border
    },
    reportScreenTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 28,
      lineHeight: 36,
      paddingVertical: 1,
      fontWeight: "700",
      letterSpacing: -0.35
    },
    historyDayGap: {
      height: 14
    },
    quickCategoryHint: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.45,
      lineHeight: TIMER_CARD_QUICK_ACTION_LABEL_LINE_HEIGHT,
      paddingHorizontal: 2
    },
    placeName: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "600"
    },
    radiusInput: {
      width: 112,
      textAlign: "center"
    },
    warningText: {
      color: theme.warningText,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "700",
      lineHeight: 17
    },
    categoryName: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
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
    // Sign in and sign up in Blocks (parity step 16b): one card, a display title, filled fields in
    // the system face, the coral pill and a plain switch line.
    authCard: {
      backgroundColor: theme.surface,
      borderRadius: DAYFRAME_BLOCKS.radius.phoneCard,
      gap: 12,
      padding: 20
    },
    authTitle: {
      color: theme.textPrimary,
      fontFamily: MOBILE_DISPLAY_FONT.bold,
      fontSize: 30,
      lineHeight: 34
    },
    authBody: {
      color: theme.textSecondary,
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 4
    },
    authInput: {
      backgroundColor: theme.surfaceInset,
      fontFamily: undefined,
      fontSize: 16
    },
    authPrimaryButton: {
      minHeight: 54
    },
    authPrimaryButtonText: {
      fontSize: 17,
      fontWeight: "700"
    },
    authSwitchRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
      gap: 4
    },
    authSwitchText: {
      color: theme.textSecondary,
      fontSize: 15
    },
    authSwitchLink: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 4
    },
    authSwitchLinkText: {
      color: theme.textPrimary,
      fontSize: 15,
      fontWeight: "700",
      textDecorationLine: "underline"
    },
    authPasswordField: {
      minHeight: 48,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      flexDirection: "row",
      alignItems: "center",
      overflow: "hidden"
    },
    authPasswordInputFrame: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      justifyContent: "center"
    },
    authPasswordInput: {
      flex: 1,
      minWidth: 0,
      backgroundColor: "transparent",
      borderRadius: 0,
      paddingRight: 4
    },
    authPasswordInputRevealed: {
      color: "transparent"
    },
    authPasswordRevealOverlay: {
      position: "absolute",
      top: 0,
      right: 4,
      bottom: 0,
      left: 12,
      justifyContent: "center"
    },
    authPasswordRevealText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15
    },
    authPasswordVisibilityButton: {
      width: 44,
      height: 44,
      marginRight: 2,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    authPasswordVisibilityPressed: {
      backgroundColor: theme.surfaceMuted
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
    startInput: {
      flex: 1,
      minHeight: 44,
      justifyContent: "center"
    },
    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end"
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
      borderRadius: DAYFRAME_BLOCKS.radius.sheet,
      backgroundColor: theme.surfaceRaised,
      padding: 16,
      gap: 10,
      shadowColor: theme.shadow,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8
    },
    datePickerHead: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 4
    },
    datePickerTitle: {
      flex: 1,
      minWidth: 0,
      color: theme.textPrimary,
      fontFamily: MOBILE_DISPLAY_FONT.bold,
      fontSize: 20
    },
    datePickerActions: {
      flexDirection: "row",
      justifyContent: "flex-start",
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
    // Neutral Done (UIA-011): coral is for live time and the one primary action of a screen.
    datePickerDoneButton: {
      minHeight: 44,
      borderRadius: 999,
      backgroundColor: theme.textPrimary,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center"
    },
    datePickerDoneText: {
      color: theme.background,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "700"
    },
    sheetBackdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.overlay
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
      position: "relative",
      maxHeight: "96%",
      borderTopLeftRadius: DAYFRAME_BLOCKS.radius.sheet,
      borderTopRightRadius: DAYFRAME_BLOCKS.radius.sheet,
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
    activeEditBody: {
      position: "relative",
      flexShrink: 1,
      minHeight: 0,
      gap: 8
    },
    activeEditBodyKeyboard: {
      flex: 1,
      minHeight: 0
    },
    sheetHandle: {
      alignSelf: "center",
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: theme.borderStrong
    },
    sheetHeader: {
      minHeight: TIME_ENTRY_SHEET_TOP_ACTION_MIN_TARGET,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4
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
      position: "relative",
      zIndex: 0,
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
    activeEditContentCompact: {
      gap: 7,
      paddingBottom: 2
    },
    activeEditContentCondensed: {
      gap: 5,
      paddingBottom: 0
    },
    activeEditObscuredContent: {
      gap: 10
    },
    activeEditObscuredContentCompact: {
      gap: 7
    },
    activeEditObscuredContentCondensed: {
      gap: 5
    },
    activeEditDeleteButton: {
      alignSelf: "center",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: 2
    },
    // Destructive text is danger red, never coral (UIA-014).
    activeEditDeleteText: {
      color: theme.dangerText,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    durationDialSection: {
      position: "relative",
      alignItems: "stretch",
      minHeight: 0
    },
    durationDialNativeView: {
      alignSelf: "center",
      width: "100%",
      maxWidth: 340,
      height: 258,
      backgroundColor: "transparent",
      overflow: "visible"
    },
    durationDialNativeViewCompact: {
      height: 200
    },
    durationDialNativeViewCondensed: {
      height: 128
    },
    // Stopped blocks: the hint row sits below the dial (see durationDialHintRowStopped), so the
    // dial gives up that overlap instead and the sheet's height stays the same.
    durationDialNativeViewStopped: {
      height: 242
    },
    durationDialNativeViewStoppedCompact: {
      height: 194
    },
    // The ring's radius is 34 % of the dial's shorter side, so a band under the ticks stays empty:
    // the hint row overlaps it by that much, keeping the sheet's total height unchanged.
    durationDialHintRow: {
      minHeight: 44,
      marginTop: -16,
      flexDirection: "row-reverse",
      alignItems: "center",
      zIndex: 3,
      elevation: 3
    },
    durationDialHintRowCompact: {
      marginTop: -6
    },
    durationDialHintRowCondensed: {
      marginTop: 0
    },
    durationDialHintRowStopped: {
      marginTop: 0
    },
    durationDialHint: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      justifyContent: "center"
    },
    // Balances the 44-point "…" on the right so the hint stays centred under the dial.
    durationDialHintBalanced: {
      paddingLeft: 44
    },
    durationDialHintText: {
      color: theme.textMuted,
      fontSize: 12.5,
      lineHeight: 16,
      textAlign: "center"
    },
    durationDialShortcuts: {
      flex: 1,
      minWidth: 0
    },
    durationDialShortcutsContent: {
      alignItems: "center",
      gap: 8,
      paddingRight: 8
    },
    durationDialShortcut: {
      minHeight: 36,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center"
    },
    durationDialShortcutText: {
      color: theme.textPrimary,
      fontSize: 13,
      fontWeight: "600",
      fontVariant: ["tabular-nums"]
    },
    durationDialShortcutToggle: {
      width: 44,
      height: 44,
      borderRadius: DAYFRAME_BLOCKS.radius.pill,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center"
    },
    activeEditSection: {
      gap: 8
    },
    activeEditSectionCompact: {
      gap: 6
    },
    activeEditSectionCondensed: {
      gap: 4
    },
    activeEditTagSectionLayer: {
      zIndex: 20
    },
    historicalSuggestionsOverlay: {
      position: "absolute",
      zIndex: 100,
      elevation: 24,
      backgroundColor: "transparent",
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 1,
      shadowRadius: 18
    },
    // UIA-021: a fill-led raised list (no outline), like the Switch sheet's rows.
    historicalSuggestionsSurface: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.surfaceRaised,
      borderRadius: 20,
      overflow: "hidden"
    },
    historicalSuggestionsHeader: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 14
    },
    historicalSuggestionsTitle: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: "600"
    },
    historicalSuggestionText: {
      flex: 1,
      minWidth: 0,
      gap: 1
    },
    historicalSuggestionName: {
      color: theme.textPrimary,
      fontSize: 15,
      fontWeight: "600"
    },
    historicalSuggestionMeta: {
      color: theme.textSecondary,
      fontSize: 12
    },
    historicalSuggestionsCloseButton: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center"
    },
    historicalSuggestionsList: {
      backgroundColor: "transparent",
      flex: 1,
      flexShrink: 1,
      minHeight: 0
    },
    taskSuggestionRow: {
      minHeight: 46,
      backgroundColor: "transparent",
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    taskSuggestionRowDivider: {
      position: "absolute",
      top: 0,
      left: 12,
      right: 12,
      height: 1,
      backgroundColor: theme.border
    },
    activeEditDescriptionInput: {
      minHeight: 48
    },
    activeEditDescriptionField: {
      position: "relative",
      zIndex: 20
    },
    tagAutocompletePanel: {
      position: "absolute",
      top: 54,
      left: 0,
      right: 0,
      zIndex: 30,
      backgroundColor: theme.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 14,
      overflow: "hidden",
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.mode === "dark" ? 0.7 : 0.18,
      shadowRadius: 12,
      elevation: 8
    },
    tagAutocompleteHeader: {
      minHeight: 36,
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted
    },
    tagAutocompleteTitle: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.4,
      paddingHorizontal: 12
    },
    tagAutocompleteList: {
      maxHeight: 264
    },
    tagSuggestionRow: {
      minHeight: 44,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center"
    },
    tagSuggestionDivider: {
      position: "absolute",
      top: 0,
      left: 12,
      right: 12,
      height: 1,
      backgroundColor: theme.border
    },
    tagSuggestionText: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "500"
    },
    tagSuggestionCreateText: {
      flex: 1,
      color: theme.accentText,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    tagSuggestionEmptyText: {
      minHeight: 44,
      paddingHorizontal: 12,
      textAlignVertical: "center",
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    tagEditorFooter: {
      minHeight: 32,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6
    },
    activeEditTimeGroups: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10
    },
    activeEditTimeGroupsStacked: {
      flexDirection: "column"
    },
    // Blocks prototype time card (.time-pair): a filled card, eyebrow over the time, date on the right.
    activeEditTimeGroup: {
      flex: 1,
      minWidth: 0,
      minHeight: 58,
      flexDirection: "row",
      alignItems: "stretch",
      borderRadius: 14,
      backgroundColor: theme.surfaceMuted,
      overflow: "hidden"
    },
    // Stacked at the largest text sizes: each card takes its own height (a flex basis of 0 would
    // let the column measure shorter than its cards, so the dial below would overlap them).
    activeEditTimeGroupStacked: {
      flex: 0,
      alignSelf: "stretch"
    },
    activeEditTimeCardMain: {
      flex: 1,
      // The sheet adds a minimum width for "00:00" at the current text size (timeCardMinWidth).
      minWidth: 0,
      justifyContent: "center",
      gap: 2,
      paddingLeft: 14,
      paddingRight: 4,
      paddingVertical: 8
    },
    activeEditCompactDate: {
      flexShrink: 1,
      minWidth: 0,
      maxWidth: "55%",
      minHeight: 44,
      paddingHorizontal: 12,
      alignItems: "flex-end",
      justifyContent: "center"
    },
    activeEditCompactDateText: {
      color: theme.textSecondary,
      fontSize: 12.5,
      fontWeight: "600"
    },
    activeEditCompactTimeInput: {
      minHeight: 28,
      backgroundColor: "transparent",
      borderRadius: 0,
      paddingHorizontal: 0,
      paddingVertical: 0,
      color: theme.textPrimary,
      fontSize: 18,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
      textAlign: "left"
    },
    activeEditRunningEndTime: {
      color: theme.textSecondary,
      fontSize: 18,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
      lineHeight: 28
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
    // Secondary actions are neutral (UIA-012); coral text read as a second primary action.
    secondaryButtonText: {
      color: theme.textPrimary,
      fontWeight: "600",
      fontFamily: monoFont,
      fontSize: 13,
      lineHeight: 17,
      textAlign: "center"
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
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
    // The shared Blocks toast (BlocksToast) on a pushed page: above the home indicator, full width
    // less the 16-point gutters, over the content (out of flow, so its exit moves nothing).
    blocksToastOverlay: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 24,
      zIndex: 30
    },
    // Today's toast place (BlocksToast: delete Undo, Switched, Already recording): above the
    // tab bar, out of flow, so its entrance and exit move nothing.
    todayToast: {
      position: "absolute",
      left: 20,
      right: 20,
      bottom: 92
    },
    accountValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600"
    },
    queueDiagnosticCard: {
      backgroundColor: theme.surfaceRaised,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4
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
