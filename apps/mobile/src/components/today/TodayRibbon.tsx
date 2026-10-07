import { memo, useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import Svg, { Circle, Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import { blockColorsFor } from "@dayframe/shared";
import type { MobileTimeEntry } from "../../lib/api";
import { playHaptic } from "../../lib/haptics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { todayReviewNavigationTarget } from "../../lib/todayReviewNavigation";
import {
  buildTodayRibbon,
  RIBBON_LABEL_HOURS,
  RIBBON_MIN_BLOCK_WIDTH,
  RIBBON_TICK_HOURS,
  ribbonHitAt,
  ribbonSpokenBlock,
  ribbonTip,
  type RibbonBlock,
  type RibbonHit,
  type RibbonModel,
} from "../../lib/todayRibbon";
import { colorWithAlpha } from "./todayBlocksLayout";
import { useTodayReviewPresentationContext } from "./TodayReviewPresentationContext";

const TRACK_HEIGHT = 46;
/** Room above and below the track for the now line's dot and a lifted block. */
const BLEED = 6;
const BLOCK_INSET = 4;
const HOT_SCALE = 1.18;
const CARD_PADDING = 14;
const TIP_WIDTH = 180;

/**
 * Today's ribbon card (Blocks prototype): "Today · Drag to scrub" over a 24-hour strip. A
 * horizontal drag scrubs (tooltip, a selection haptic per block), a tap opens what is under the
 * finger; vertical drags stay with the list. VoiceOver steps through the blocks as an adjustable
 * element and activates the current one.
 */
export const TodayRibbon = memo(function TodayRibbon({
  model,
  onOpenBlock,
  theme,
}: {
  model: RibbonModel;
  onOpenBlock: (block: RibbonBlock) => void;
  theme: MobileTheme;
}) {
  const [width, setWidth] = useState(0);
  const [hit, setHit] = useState<RibbonHit | null>(null);
  const [voiceIndex, setVoiceIndex] = useState(-1);
  const lastKey = useRef<string | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const scrubTo = useCallback((x: number, scrubbing: boolean) => {
    if (width <= 0) return;
    const next = ribbonHitAt(modelRef.current, x / width);
    const key = next.kind === "block" ? next.block.key : "gap";
    if (key !== lastKey.current) {
      if (scrubbing && next.kind === "block") playHaptic("tick");
      lastKey.current = key;
    }
    setHit(next);
  }, [width]);
  const endScrub = useCallback(() => {
    lastKey.current = null;
    setHit(null);
  }, []);
  const tapAt = useCallback((x: number) => {
    if (width <= 0) return;
    const next = ribbonHitAt(modelRef.current, x / width);
    if (next.kind === "block") onOpenBlock(next.block);
  }, [onOpenBlock, width]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-4, 4])
      .failOffsetY([-10, 10])
      .onStart((event) => {
        "worklet";
        runOnJS(scrubTo)(event.x, true);
      })
      .onUpdate((event) => {
        "worklet";
        runOnJS(scrubTo)(event.x, true);
      })
      .onFinalize(() => {
        "worklet";
        runOnJS(endScrub)();
      });
    const tap = Gesture.Tap()
      .maxDistance(8)
      .onEnd((event, success) => {
        "worklet";
        if (success) runOnJS(tapAt)(event.x);
      });
    return Gesture.Race(pan, tap);
  }, [endScrub, scrubTo, tapAt]);

  const hotKey = hit?.kind === "block" ? hit.block.key : null;
  const tip = hit ? ribbonTip(hit) : null;
  const tipCenter = hit && width > 0 ? ((hit.atMs - model.dayStartMs) / model.dayMs) * width : 0;
  const voiceBlock = voiceIndex >= 0 ? model.blocks[voiceIndex] ?? null : null;
  const loggedCount = model.blocks.filter((block) => block.kind === "entry").length;
  const pendingCount = model.blocks.length - loggedCount;
  const summary = model.blocks.length
    ? `${loggedCount} ${loggedCount === 1 ? "block" : "blocks"}${pendingCount ? `, ${pendingCount} waiting for review` : ""}. Swipe up or down to step through them.`
    : "Nothing tracked yet today.";
  const ordered = useMemo(() => [...model.blocks].sort((a, b) => a.startMs - b.startMs), [model.blocks]);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]} testID="today-ribbon">
      <View style={styles.head}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
          Today
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.caption, { color: theme.textMuted }]}>Drag to scrub</Text>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "activate" }]}
          accessibilityLabel="Today, hour by hour"
          accessibilityRole="adjustable"
          accessibilityValue={{ text: voiceBlock ? ribbonSpokenBlock(voiceBlock) : summary }}
          onAccessibilityAction={(event) => {
            const name = event.nativeEvent.actionName;
            if (!ordered.length) return;
            const current = voiceBlock ? ordered.indexOf(voiceBlock) : -1;
            if (name === "increment") setVoiceIndex(model.blocks.indexOf(ordered[Math.min(ordered.length - 1, current + 1)]));
            if (name === "decrement") setVoiceIndex(model.blocks.indexOf(ordered[Math.max(0, current - 1)]));
            if (name === "activate" && voiceBlock) onOpenBlock(voiceBlock);
          }}
          onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
          style={styles.track}
          testID="today-ribbon-track"
        >
          {width > 0 ? (
            <Svg height={TRACK_HEIGHT + BLEED * 2} style={styles.svg} width={width}>
              <Defs>
                {model.blocks.filter((block) => block.kind === "pending").map((block) => {
                  const color = block.color ? blockColorsFor(block.color, theme.mode).fill : theme.textMuted;
                  return (
                    <Pattern height={12} id={patternId(block)} key={block.key} patternUnits="userSpaceOnUse" width={12}>
                      <Path d="M-3 9 9 -3M3 15 15 3" stroke={colorWithAlpha(color, 0.4)} strokeWidth={4.2} />
                    </Pattern>
                  );
                })}
              </Defs>
              <Rect fill={theme.surfaceMuted} height={TRACK_HEIGHT} rx={12} width={width} x={0} y={BLEED} />
              {RIBBON_TICK_HOURS.map((hour) => (
                <Line
                  key={hour}
                  stroke={hour % 6 ? theme.border : theme.borderStrong}
                  strokeWidth={1}
                  x1={(hour / 24) * width}
                  x2={(hour / 24) * width}
                  y1={BLEED + 8}
                  y2={BLEED + TRACK_HEIGHT - 8}
                />
              ))}
              {model.blocks.map((block) => {
                const color = block.color ? blockColorsFor(block.color, theme.mode).fill : theme.textMuted;
                const hot = block.key === hotKey;
                const height = (TRACK_HEIGHT - BLOCK_INSET * 2) * (hot ? HOT_SCALE : 1);
                const y = BLEED + TRACK_HEIGHT / 2 - height / 2;
                const x = block.left * width;
                const w = Math.max(RIBBON_MIN_BLOCK_WIDTH, block.width * width);
                return block.kind === "pending" ? (
                  <Rect
                    fill={`url(#${patternId(block)})`}
                    height={height}
                    key={block.key}
                    rx={6}
                    stroke={colorWithAlpha(color, 0.7)}
                    strokeWidth={1.5}
                    width={w}
                    x={x}
                    y={y}
                  />
                ) : (
                  <Rect fill={color} height={height} key={block.key} rx={6} width={w} x={x} y={y} />
                );
              })}
              {model.now !== null ? (
                <>
                  <Rect fill={theme.accent} height={TRACK_HEIGHT + 8} rx={1} width={2} x={model.now * width - 1} y={BLEED - 4} />
                  <Circle cx={model.now * width} cy={BLEED - 4} fill={theme.accent} r={4} />
                </>
              ) : null}
            </Svg>
          ) : null}
        </View>
      </GestureDetector>
      <View style={styles.hours}>
        {RIBBON_LABEL_HOURS.map((hour, index) => (
          <Text
            {...mobileTextProps("metadata")}
            key={hour}
            style={[
              styles.hour,
              { color: theme.textMuted, left: `${(hour / 24) * 100}%` },
              index === 0 ? null : index === RIBBON_LABEL_HOURS.length - 1 ? styles.hourLast : styles.hourMid,
            ]}
          >
            {`${String(hour).padStart(2, "0")}:00`}
          </Text>
        ))}
      </View>
      {tip && width > 0 ? (
        <View
          pointerEvents="none"
          style={[styles.tip, { backgroundColor: theme.textPrimary, left: CARD_PADDING + Math.min(Math.max(tipCenter - TIP_WIDTH / 2, 0), Math.max(0, width - TIP_WIDTH)) }]}
          testID="today-ribbon-tip"
        >
          <Text numberOfLines={1} style={[styles.tipTitle, { color: theme.background }]}>{tip.title}</Text>
          <Text numberOfLines={1} style={[styles.tipDetail, { color: theme.background }]}>{tip.detail}</Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * The ribbon on Today: today's logged entries plus the Review time still waiting in the cached
 * presentation (hatched). Tapping a logged block edits it; a hatched block opens its exact Review
 * item. Rebuilt on the per-minute clock.
 */
export function TodayRibbonSection({
  entries,
  nowMs,
  onOpenEntry,
  theme,
}: {
  entries: readonly MobileTimeEntry[];
  nowMs: number;
  onOpenEntry: (entry: MobileTimeEntry) => void;
  theme: MobileTheme;
}) {
  const context = useTodayReviewPresentationContext();
  const presentation = context?.isSummaryAvailable ? context.presentation : null;
  const pending = useMemo(
    () => (presentation?.daySections ?? []).flatMap((section) => section.activities).filter((activity) => activity.awaitingDecision),
    [presentation]
  );
  const model = useMemo(() => buildTodayRibbon({ entries, nowMs, pending }), [entries, nowMs, pending]);
  const onOpenBlock = useCallback((block: RibbonBlock) => {
    if (block.kind === "entry") {
      onOpenEntry(block.entry);
      return;
    }
    const target = todayReviewNavigationTarget(block.activity);
    if (!target) {
      router.push("/review");
      return;
    }
    if (target.kind === "canonical_entry") return;
    router.push({ pathname: target.pathname, params: target.params } as never);
  }, [onOpenEntry]);
  return <TodayRibbon model={model} onOpenBlock={onOpenBlock} theme={theme} />;
}

function patternId(block: RibbonBlock) {
  return `hatch-${block.key.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, paddingBottom: 10, paddingHorizontal: CARD_PADDING, paddingTop: 14 },
  head: { alignItems: "baseline", flexDirection: "row", gap: 12, justifyContent: "space-between", marginBottom: 12 - BLEED },
  heading: { flexShrink: 1, fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  caption: { fontSize: 13 },
  track: { height: TRACK_HEIGHT + BLEED * 2 },
  svg: { overflow: "visible" },
  hours: { height: 16, marginTop: 6 - BLEED },
  hour: { fontSize: 10.5, fontVariant: ["tabular-nums"], position: "absolute", top: 0 },
  hourMid: { transform: [{ translateX: -14 }] },
  hourLast: { transform: [{ translateX: -28 }] },
  tip: { borderRadius: 12, gap: 1, paddingHorizontal: 11, paddingVertical: 8, position: "absolute", top: 4, width: TIP_WIDTH, zIndex: 5 },
  tipTitle: { fontSize: 12, fontWeight: "700" },
  tipDetail: { fontSize: 12, fontVariant: ["tabular-nums"], opacity: 0.72 },
});
