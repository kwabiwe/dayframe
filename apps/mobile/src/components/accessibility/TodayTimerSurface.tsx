import type { ComponentProps } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import { PlusGlyph, PrimaryTimerAction } from "../PrimaryTimerAction";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "./diagnostics";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import type { MobileQuickAction } from "../../lib/timerPresentation";
import { TIMER_CARD_QUICK_ACTION_HIT_SLOP } from "../../lib/timerCardLayout";

export type TodayActiveTimerPresentation = {
  categoryColor: string | null;
  categoryLabel: string | null;
  elapsedLabel: string;
  hasLiveActiveTimer: boolean;
  title: string;
  titleIsPlaceholder: boolean;
};

export function TodayTimerSurface({
  active,
  activeTimerActionsStyle,
  activeTimerDetailsStyle,
  diagnostic,
  onAddTime,
  onOpenActiveTimer,
  onStartBlank,
  onStartQuickAction,
  onStop,
  quickActions,
  styles,
  theme,
}: {
  active: TodayActiveTimerPresentation | null;
  activeTimerActionsStyle?: ComponentProps<typeof Animated.View>["style"];
  activeTimerDetailsStyle?: ComponentProps<typeof Animated.View>["style"];
  diagnostic?: MobileAccessibilityDiagnostic;
  onAddTime: () => void;
  onOpenActiveTimer: () => void;
  onStartBlank: () => void;
  onStartQuickAction: (action: MobileQuickAction) => void;
  onStop: () => void;
  quickActions: MobileQuickAction[];
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  if (active) {
    return (
      <Pressable
        accessibilityLabel={active.hasLiveActiveTimer ? "Edit running timer" : undefined}
        accessibilityRole={active.hasLiveActiveTimer ? "button" : undefined}
        disabled={!active.hasLiveActiveTimer}
        onPress={onOpenActiveTimer}
        onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.running", event)}
        style={({ pressed }) => [
          styles.timerPanel,
          pressed && active.hasLiveActiveTimer ? styles.buttonPressed : null,
        ]}
      >
        {active.categoryColor ? (
          <View
            pointerEvents="none"
            style={[styles.activeTimerAccentRail, { backgroundColor: active.categoryColor }]}
          />
        ) : null}
        <View style={styles.activeTimerHeader}>
          <View style={styles.activeTimerTextStack}>
            <View style={styles.activeTitleRow}>
              {active.categoryColor ? (
                <View style={[styles.colorDot, { backgroundColor: active.categoryColor }]} />
              ) : null}
              <Text
                {...mobileTextProps("itemTitle")}
                style={[
                  styles.timerText,
                  styles.activeTitleText,
                  active.titleIsPlaceholder ? styles.activeTitlePlaceholderText : null,
                ]}
                onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.title.frame", event)}
                numberOfLines={2}
                onTextLayout={(event) => recordMobileTextLayout(
                  diagnostic,
                  "today.timer.title",
                  event,
                  "itemTitle",
                  [styles.timerText, styles.activeTitleText],
                )}
              >
                {active.title}
              </Text>
            </View>
            <Animated.View style={[styles.activeTimerExpandedContent, activeTimerDetailsStyle]}>
              {active.categoryLabel ? (
                <Text {...mobileTextProps("metadata")} style={styles.activeDescription}>
                  {active.categoryLabel}
                </Text>
              ) : null}
              <Text
                {...mobileTextProps("numeric")}
                style={styles.activeElapsed}
                onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.elapsed.frame", event)}
                onTextLayout={(event) => recordMobileTextLayout(
                  diagnostic,
                  "today.timer.elapsed",
                  event,
                  "numeric",
                  styles.activeElapsed,
                )}
              >
                {active.elapsedLabel}
              </Text>
            </Animated.View>
          </View>
          <Animated.View
            pointerEvents={active.hasLiveActiveTimer ? "auto" : "none"}
            style={[styles.activeTimerActions, activeTimerActionsStyle]}
          >
            <PrimaryTimerAction
              accessibilityLabel="Stop current timer"
              backgroundColor={theme.accent}
              glyphColor={theme.onAccent}
              mode="stop"
              onPress={(event) => {
                event.stopPropagation();
                onStop();
              }}
            />
            <Pressable
              accessibilityLabel="Add past time"
              accessibilityRole="button"
              onPress={(event: GestureResponderEvent) => {
                event.stopPropagation();
                onAddTime();
              }}
              style={({ pressed }) => [styles.addPastTimeButton, pressed ? styles.buttonPressed : null]}
              testID="active-timer-add-past-time"
            >
              <PlusGlyph color={theme.accentText} />
            </Pressable>
          </Animated.View>
        </View>
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.panel, styles.idleTimerPanel]}
      onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.idle", event)}
    >
      <View style={styles.startInputRow}>
        <View style={styles.startComposerMain}>
          <Pressable
            accessibilityLabel="Start timer and add details"
            accessibilityRole="button"
            style={({ pressed }) => [styles.textInput, styles.startInput, pressed ? styles.buttonPressed : null]}
            onPress={onStartBlank}
          >
            <Text
              {...mobileTextProps("control")}
              style={styles.startInputText}
              onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.composer.frame", event)}
            >
              What are you working on?
            </Text>
          </Pressable>
          <View style={styles.quickActionsGroup}>
            <Text {...mobileTextProps("counter")} style={styles.quickCategoryHint} numberOfLines={1}>
              QUICK ACTIONS
            </Text>
            <ScrollView
              accessibilityLabel="Quick actions"
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.quickActionsInline}
              contentContainerStyle={styles.compactCategoryScroller}
            >
              {quickActions.map((action) => {
                const categoryColor = action.isUncategorized
                  ? null
                  : paletteColorFor(action.color, action.subtitle ?? action.name, theme.mode);
                return (
                  <Pressable
                    key={action.key}
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${action.name}`}
                    hitSlop={{
                      top: TIMER_CARD_QUICK_ACTION_HIT_SLOP,
                      bottom: TIMER_CARD_QUICK_ACTION_HIT_SLOP,
                    }}
                    style={({ pressed }) => [styles.categoryPillTouch, pressed ? styles.buttonPressed : null]}
                    onPress={() => onStartQuickAction(action)}
                  >
                    <View
                      style={[
                        styles.categoryPill,
                        categoryColor
                          ? {
                              backgroundColor: colorWithAlpha(
                                categoryColor,
                                theme.mode === "dark" ? 0.18 : 0.13,
                              ),
                            }
                          : styles.categoryPillMuted,
                      ]}
                    >
                      <View
                        style={[
                          styles.colorDot,
                          categoryColor ? { backgroundColor: categoryColor } : styles.colorDotMuted,
                        ]}
                      />
                      <Text {...mobileTextProps("control")} style={styles.categoryPillText} numberOfLines={1}>
                        {action.name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
        <View style={styles.startActionColumn}>
          <PrimaryTimerAction
            accessibilityLabel="Start task"
            backgroundColor={theme.accent}
            glyphColor={theme.onAccent}
            mode="play"
            onPress={onStartBlank}
          />
          <Pressable
            accessibilityLabel="Add past time"
            accessibilityRole="button"
            style={({ pressed }) => [styles.addPastTimeButton, pressed ? styles.buttonPressed : null]}
            onPress={onAddTime}
          >
            <PlusGlyph color={theme.accentText} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function colorWithAlpha(hex: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
