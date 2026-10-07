import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import type { MobileTimeEntry } from "../../lib/api";
import { BLOCKS_SPRING, type LandingRequest } from "../../lib/blocksMotion";
import { playHaptic } from "../../lib/haptics";
import type { HistoryEntryGroup } from "../../lib/historyPresentation";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import {
  canDeleteGroup,
  canStartAgain,
  ROW_BLOCK,
  ROW_SWIPE_COMMIT,
  rowBlockHeight,
  rowDuration,
  rowMeta,
  rowTimeRange,
  rowTitle,
  todayBlocksCaption,
} from "../../lib/todayBlockRows";
import { DayframeIcon } from "../icons/DayframeIcon";
import { ActivityBlockMark } from "./ActivityBlockMark";
import { spokenDuration } from "./todayBlocksLayout";

type Entry = MobileTimeEntry;

/** How long a deleted row waits off-screen before springing back if the list still holds it. */
const DELETE_SETTLE_MS = 900;
/** A running row resists a little and never commits, as in the prototype. */
const LIVE_RESISTANCE = { limit: 40, factor: 0.4 } as const;

/**
 * "Today's blocks" (Blocks prototype): today's entries as rows whose activity block is as tall as
 * their time. Swipe right past the threshold to start the block again, left to delete it (with the
 * Dashboard's Undo); tap to edit, or to open a group of repeats. One Pan gesture per row owns the
 * swipe on the UI thread; vertical scrolling wins until the finger has moved 8 points sideways.
 */
export function TodayBlockRows({
  activeTimerRunning,
  activityIconFor,
  groups,
  nowMs,
  onDeleteEntries,
  onOpenEntry,
  onReplayEntry,
  reduceMotion,
  rowLanding,
  theme,
}: {
  activeTimerRunning: boolean;
  activityIconFor: (categoryId: string | null | undefined) => string | null;
  groups: readonly HistoryEntryGroup[];
  nowMs: number;
  onDeleteEntries: (entries: Entry[]) => void;
  onOpenEntry: (entry: Entry) => void;
  onReplayEntry: (entry: Entry) => void;
  reduceMotion: boolean;
  rowLanding: LandingRequest | null;
  theme: MobileTheme;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const layout = useMemo(() => localLayoutTransition(reduceMotion), [reduceMotion]);
  const entering = useMemo(() => localPresenceEntering(reduceMotion), [reduceMotion]);
  const exiting = useMemo(() => localPresenceExiting(reduceMotion), [reduceMotion]);
  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <View style={styles.section} testID="today-blocks">
      <View style={styles.head}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
          Today's blocks
        </Text>
        {groups.length ? (
          <Text {...mobileTextProps("metadata")} style={[styles.caption, { color: theme.textMuted }]}>
            {todayBlocksCaption(groups)}
          </Text>
        ) : null}
      </View>
      <Reanimated.View layout={layout} style={[styles.card, { backgroundColor: theme.surface }]}>
        {groups.length === 0 ? (
          <Reanimated.View entering={entering} layout={layout} style={styles.empty}>
            <Text {...mobileTextProps("itemTitle")} style={[styles.title, { color: theme.textPrimary }]}>No blocks yet</Text>
            <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>Start one above</Text>
          </Reanimated.View>
        ) : groups.map((group, index) => {
          const grouped = group.entries.length > 1;
          const isExpanded = grouped && expanded.has(group.key);
          return (
            <Reanimated.View entering={entering} exiting={exiting} key={group.key} layout={layout}>
              <TodayBlockRow
                activeTimerRunning={activeTimerRunning}
                blockSeconds={group.totalSeconds}
                count={grouped ? group.entries.length : 0}
                deletable={canDeleteGroup(group)}
                divider={index > 0}
                durationSeconds={group.totalSeconds}
                entry={group.representative.entry}
                expanded={grouped ? isExpanded : undefined}
                icon={activityIconFor(group.representative.entry.categoryId)}
                meta={rowMeta(group, nowMs)}
                onDelete={() => onDeleteEntries(group.entries.map(({ entry }) => entry))}
                onOpen={() => (grouped ? toggle(group.key) : onOpenEntry(group.representative.entry))}
                onReplay={() => onReplayEntry(group.representative.entry)}
                reduceMotion={reduceMotion}
                rowLanding={rowLanding}
                theme={theme}
              />
              {isExpanded ? (
                <Reanimated.View entering={entering} exiting={exiting} layout={layout} testID={`today-block-children-${group.key}`}>
                  {group.entries.map(({ entry, overlapSeconds }) => (
                    <Reanimated.View entering={entering} exiting={exiting} key={entry.id} layout={layout}>
                      <TodayBlockRow
                        activeTimerRunning={activeTimerRunning}
                        blockSeconds={overlapSeconds}
                        child
                        count={0}
                        deletable={Boolean(entry.stoppedAt)}
                        divider
                        durationSeconds={overlapSeconds}
                        entry={entry}
                        icon={activityIconFor(entry.categoryId)}
                        meta={rowTimeRange(entry, nowMs)}
                        onDelete={() => onDeleteEntries([entry])}
                        onOpen={() => onOpenEntry(entry)}
                        onReplay={() => onReplayEntry(entry)}
                        reduceMotion={reduceMotion}
                        rowLanding={rowLanding}
                        theme={theme}
                      />
                    </Reanimated.View>
                  ))}
                </Reanimated.View>
              ) : null}
            </Reanimated.View>
          );
        })}
      </Reanimated.View>
    </View>
  );
}

export const TodayBlockRow = memo(function TodayBlockRow({
  activeTimerRunning,
  blockSeconds,
  child = false,
  count,
  deletable,
  divider,
  durationSeconds,
  entry,
  expanded,
  icon,
  meta,
  onDelete,
  onOpen,
  onReplay,
  reduceMotion,
  rowLanding,
  theme,
}: {
  activeTimerRunning: boolean;
  blockSeconds: number;
  child?: boolean;
  count: number;
  deletable: boolean;
  divider: boolean;
  durationSeconds: number;
  entry: Entry;
  /** Set for a group of repeats: tapping opens or closes it instead of editing. */
  expanded?: boolean;
  icon: string | null;
  meta: string;
  onDelete: () => void;
  onOpen: () => void;
  onReplay: () => void;
  reduceMotion: boolean;
  rowLanding: LandingRequest | null;
  theme: MobileTheme;
}) {
  const { width } = useWindowDimensions();
  const live = !entry.stoppedAt;
  const replayable = !live && canStartAgain(entry);
  const title = rowTitle(entry);
  const duration = rowDuration(durationSeconds);
  const offset = useSharedValue(0);
  const armed = useSharedValue(0);
  const flyOut = -Math.max(width, 400) * 1.1;

  // The Dashboard's deletion owner plays the delete haptic once the deletion is accepted.
  const commitDelete = useCallback(() => onDelete(), [onDelete]);
  const commitReplay = useCallback(() => onReplay(), [onReplay]);
  const tick = useCallback(() => playHaptic("tick"), []);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      "worklet";
      let dx = event.translationX;
      if (live || (dx > 0 && !replayable) || (dx < 0 && !deletable)) {
        dx = Math.max(Math.min(dx, LIVE_RESISTANCE.limit), -LIVE_RESISTANCE.limit) * LIVE_RESISTANCE.factor;
      }
      offset.value = dx;
      const next = dx > ROW_SWIPE_COMMIT ? 1 : dx < -ROW_SWIPE_COMMIT ? -1 : 0;
      if (next !== armed.value) {
        armed.value = next;
        if (next !== 0) runOnJS(tick)();
      }
    })
    .onEnd(() => {
      "worklet";
      const state = armed.value;
      armed.value = 0;
      if (state === -1) {
        if (reduceMotion) {
          offset.value = 0;
        } else {
          offset.value = withSequence(
            withTiming(flyOut, { duration: 180, easing: Easing.in(Easing.quad) }),
            withDelay(DELETE_SETTLE_MS, withSpring(0, BLOCKS_SPRING.land)),
          );
        }
        runOnJS(commitDelete)();
        return;
      }
      offset.value = reduceMotion ? withTiming(0, { duration: 120 }) : withSpring(0, BLOCKS_SPRING.land);
      if (state === 1) runOnJS(commitReplay)();
    })
    .onFinalize(() => {
      "worklet";
      armed.value = 0;
    }), [armed, commitDelete, commitReplay, deletable, flyOut, live, offset, reduceMotion, replayable, tick]);

  const mainStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: offset.value > 0 ? 1 : 0 }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: offset.value < 0 ? 1 : 0 }));

  const spoken = spokenDuration(durationSeconds);
  const label = count > 1
    ? `${expanded ? "Collapse" : "Expand"} ${count} ${title} entries, ${meta}, ${spoken}`
    : `${title}, ${meta}, ${spoken}`;
  const actions = [
    ...(replayable ? [{ name: "startAgain", label: activeTimerRunning ? `Switch to ${title}` : "Start again" }] : []),
    ...(deletable ? [{ name: "delete", label: count > 1 ? `Delete ${count} ${title} entries` : `Delete ${title}` }] : []),
  ];

  return (
    <View style={[styles.row, divider ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
      {replayable ? (
        <Reanimated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.under, styles.underLeft, { backgroundColor: theme.accent }, leftStyle]}
        >
          <DayframeIcon color={theme.onAccent} glyph={DAYFRAME_APP_ICONS.startAgain} size={20} />
          <Text style={[styles.underText, { color: theme.onAccent }]}>Start again</Text>
        </Reanimated.View>
      ) : null}
      {deletable ? (
        <Reanimated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.under, styles.underRight, { backgroundColor: theme.danger }, rightStyle]}
        >
          <Text style={[styles.underText, { color: theme.onDanger }]}>Delete</Text>
          <DayframeIcon color={theme.onDanger} glyph={DAYFRAME_APP_ICONS.delete} size={20} />
        </Reanimated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[{ backgroundColor: theme.surface }, mainStyle]}>
          <Pressable
            accessibilityActions={actions.length ? actions : undefined}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={count > 1 ? { expanded } : undefined}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "startAgain" && replayable) onReplay();
              if (event.nativeEvent.actionName === "delete" && deletable) onDelete();
            }}
            onPress={onOpen}
            style={({ pressed }) => [styles.main, child ? styles.mainChild : null, pressed ? styles.pressed : null]}
            testID={`today-block-${child ? "child" : "row"}-${entry.id}`}
          >
            {count > 1 ? (
              <View style={[styles.count, { backgroundColor: theme.surfaceMuted }]}>
                <Text {...mobileTextProps("counter")} style={[styles.countText, { color: theme.textPrimary }]}>{count}</Text>
              </View>
            ) : null}
            <View style={styles.blockSlot}>
              <ActivityBlockMark
                categoryColor={entry.categoryColor ?? entry.categoryId ?? null}
                categoryIcon={icon}
                categoryName={entry.categoryName ?? null}
                entryId={entry.id}
                height={rowBlockHeight(blockSeconds)}
                landing={rowLanding}
                reduceMotion={reduceMotion}
                theme={theme}
                width={ROW_BLOCK.width}
              />
            </View>
            <View style={styles.text}>
              <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.title, { color: theme.textPrimary }]}>
                {title}
              </Text>
              <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
                {meta}
              </Text>
            </View>
            <Text {...mobileTextProps("numeric")} style={[styles.duration, { color: live ? theme.accent : theme.textPrimary }]}>
              {duration}
            </Text>
          </Pressable>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  section: { gap: 10 },
  head: { alignItems: "baseline", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  heading: { flexShrink: 1, fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  caption: { fontSize: 13 },
  card: { borderRadius: 22, overflow: "hidden" },
  empty: { gap: 2, minHeight: 64, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 },
  row: { overflow: "hidden" },
  under: { alignItems: "center", bottom: 0, flexDirection: "row", gap: 8, left: 0, paddingHorizontal: 22, position: "absolute", right: 0, top: 0 },
  underLeft: { justifyContent: "flex-start" },
  underRight: { justifyContent: "flex-end" },
  underText: { fontSize: 14, fontWeight: "800" },
  main: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 64, paddingLeft: 14, paddingRight: 16, paddingVertical: 10 },
  mainChild: { minHeight: 56, paddingLeft: 30 },
  pressed: { opacity: 0.82 },
  count: { alignItems: "center", borderRadius: 14, height: 28, justifyContent: "center", minWidth: 28, paddingHorizontal: 6 },
  countText: { fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  blockSlot: { alignItems: "center", justifyContent: "center", width: ROW_BLOCK.width },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 12.5, fontVariant: ["tabular-nums"] },
  duration: { fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "700" },
});
