import { memo, useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS, type DayframeGlyph } from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { recordMobileLayout, type MobileAccessibilityDiagnostic } from "@/components/accessibility/diagnostics";
import { BLOCKS_SPRING } from "@/lib/blocksMotion";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import type { MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import {
  REVIEW_DECK_DEPTH_OFFSET,
  REVIEW_DECK_DEPTH_SCALE,
  REVIEW_DECK_VISIBLE_CARDS,
  type ReviewDeckPicture,
  type ReviewDeckSourceIcon
} from "@/lib/reviewDeck";

export type ReviewDeckCardModel = {
  key: string;
  picture: ReviewDeckPicture;
  /** The activity's display colour (or a neutral when there is none). */
  color: string;
  /** Text on a solid chip of `color`. */
  onColor: string;
  source: { icon: ReviewDeckSourceIcon; label: string };
  confidence: { score: number; label: string } | null;
  title: string;
  when: string | null;
  logAsName: string;
  activityName: string;
  reason: string | null;
  /** A durable Review change for this card is waiting or needs attention. */
  syncBadge: string | null;
  syncDetail: string | null;
  controlsDisabled: boolean;
  /** The card's More menu (Edit details, Dismiss suggestion). */
  moreLabel: string | null;
  menuOpen: boolean;
};

const SOURCE_GLYPH: Record<ReviewDeckSourceIcon, DayframeGlyph> = {
  pin: "map-pin",
  route: "route",
  walk: "footprints",
  moon: "moon",
  spark: "circle-dot"
};

const PICTURE_HEIGHT = 230;
/** The picture gives way first on short decks (small phones, large text, banners above). */
const PICTURE_MIN_HEIGHT = 96;
const SLEEP_BARS = [3, 2, 1, 2, 3, 2, 1, 1, 2, 3, 2, 1, 2, 2, 3, 2, 1, 2, 3, 3];
const SUGGESTION_BLOCKS = [
  { x: 40, width: 70, height: 58 },
  { x: 118, width: 46, height: 92 },
  { x: 172, width: 88, height: 74 },
  { x: 268, width: 52, height: 40 }
];

/** The prototype's per-kind picture (ios.html `visualFor`), drawn in the activity's colour. */
export const ReviewDeckPictureView = memo(function ReviewDeckPictureView({
  color,
  picture,
  theme
}: {
  color: string;
  picture: ReviewDeckPicture;
  theme: MobileTheme;
}) {
  const hole = theme.surfaceRaised;
  return (
    <Svg
      accessibilityElementsHidden
      height="100%"
      importantForAccessibility="no-hide-descendants"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 360 210"
      width="100%"
    >
      <Rect fill={theme.surfaceInset} height={210} width={360} />
      {picture === "place" ? (
        <>
          <G fill="none" stroke={theme.borderStrong} strokeLinecap="round" strokeWidth={10}>
            <Path d="M-10 150 C80 130 120 170 200 140 S320 110 380 130" />
            <Path d="M90 -10 L120 220" />
            <Path d="M250 -10 C240 60 270 120 260 220" />
          </G>
          <G fill="none" stroke={theme.border} strokeWidth={4}>
            <Path d="M-10 60 L380 80" />
            <Path d="M30 -10 L60 220" />
            <Path d="M170 -10 L180 220" />
            <Path d="M320 -10 L310 220" />
          </G>
          <Circle cx={185} cy={102} fill={color} fillOpacity={0.16} r={62} stroke={color} strokeDasharray="5 6" strokeWidth={2} />
          <Path d="M185 68c-15 0-26 11-26 25 0 19 26 41 26 41s26-22 26-41c0-14-11-25-26-25z" fill={color} />
          <Circle cx={185} cy={93} fill={hole} r={8} />
        </>
      ) : picture === "workout" ? (
        <>
          <G fill="none" stroke={theme.border} strokeWidth={5}>
            <Path d="M-10 50 L380 70" />
            <Path d="M60 -10 L80 220" />
            <Path d="M290 -10 L270 220" />
          </G>
          <Path
            d="M70 160 C90 90 140 150 170 100 S230 40 260 80 S300 150 250 170 S120 190 70 160Z"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={6}
          />
          <Circle cx={70} cy={160} fill={color} r={9} />
          <Circle cx={70} cy={160} fill={hole} r={4} />
        </>
      ) : picture === "sleep" ? (
        <>
          {SLEEP_BARS.map((bar, index) => (
            <Rect
              fill={color}
              fillOpacity={0.45 + bar * 0.18}
              height={bar * 34}
              key={index}
              rx={4}
              width={13}
              x={24 + index * 16}
              y={50 + (3 - bar) * 34}
            />
          ))}
        </>
      ) : picture === "suggestion" ? (
        <>
          <G fill="none" stroke={theme.border} strokeWidth={4}>
            <Path d="M24 170 L336 170" />
          </G>
          {SUGGESTION_BLOCKS.map((block, index) => (
            <Rect
              fill={color}
              fillOpacity={index === 2 ? 1 : 0.32}
              height={block.height}
              key={block.x}
              rx={10}
              width={block.width}
              x={block.x}
              y={160 - block.height}
            />
          ))}
        </>
      ) : (
        <>
          <G fill="none" stroke={theme.border} strokeWidth={5}>
            <Path d="M-10 120 L380 100" />
            <Path d="M120 -10 L140 220" />
            <Path d="M240 -10 L230 220" />
          </G>
          <Path d="M60 160 Q160 40 300 70" fill="none" stroke={color} strokeDasharray="2 12" strokeLinecap="round" strokeWidth={5} />
          <Circle cx={60} cy={160} fill={color} r={12} />
          <SvgText fill={hole} fontSize={11} fontWeight="800" textAnchor="middle" x={60} y={164}>A</SvgText>
          <Circle cx={300} cy={70} fill={color} r={12} />
          <SvgText fill={hole} fontSize={11} fontWeight="800" textAnchor="middle" x={300} y={74}>B</SvgText>
        </>
      )}
    </Svg>
  );
});

function Pill({ children, round, theme }: { children: ReactNode; round?: boolean; theme: MobileTheme }) {
  return (
    <View
      style={[
        deckStyles.pill,
        round ? deckStyles.pillRound : null,
        { backgroundColor: theme.mode === "dark" ? "rgba(20, 27, 44, 0.78)" : "rgba(255, 255, 255, 0.86)" }
      ]}
    >
      {children}
    </View>
  );
}

function ReviewDeckCardView({
  card,
  depth,
  diagnostic,
  onBodyHeight,
  onEdit,
  onMore,
  pictureHeight,
  reduceMotion,
  theme
}: {
  card: ReviewDeckCardModel;
  depth: number;
  /** Synthetic accessibility probe only: the top card reports its frames. */
  diagnostic?: MobileAccessibilityDiagnostic;
  onBodyHeight: (height: number) => void;
  onEdit: () => void;
  onMore: () => void;
  pictureHeight: number;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  // One owner per card: its depth in the stack. A card moving up after the top one is decided lands
  // with the Blocks `land` spring; Reduce Motion moves it at once.
  const animatedDepth = useSharedValue(depth);
  useEffect(() => {
    animatedDepth.value = reduceMotion
      ? depth
      : withSpring(depth, { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never });
  }, [animatedDepth, depth, reduceMotion]);
  const depthStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: animatedDepth.value * REVIEW_DECK_DEPTH_OFFSET },
      { scale: 1 - animatedDepth.value * REVIEW_DECK_DEPTH_SCALE }
    ]
  }));
  const top = depth === 0;

  return (
    <Reanimated.View
      accessibilityElementsHidden={!top}
      entering={localPresenceEntering(reduceMotion)}
      exiting={localPresenceExiting(reduceMotion)}
      importantForAccessibility={top ? "auto" : "no-hide-descendants"}
      pointerEvents={top ? "box-none" : "none"}
      style={[
        deckStyles.card,
        {
          backgroundColor: theme.surfaceRaised,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          zIndex: REVIEW_DECK_VISIBLE_CARDS - depth
        },
        depthStyle
      ]}
      onLayout={(event) => recordMobileLayout(diagnostic, "review-deck.card", event)}
      testID={top ? "review-deck-card" : undefined}
    >
      {/* The outer view casts the shadow; this one clips the picture to the card's corners. */}
      <View style={deckStyles.cardClip}>
        <View style={[deckStyles.picture, { height: pictureHeight }]}>
          <ReviewDeckPictureView color={card.color} picture={card.picture} theme={theme} />
          <View style={deckStyles.pillRow}>
            <Pill theme={theme}>
              <DayframeIcon color={theme.textPrimary} glyph={SOURCE_GLYPH[card.source.icon]} size={14} />
              <Text {...mobileTextProps("counter")} style={[deckStyles.pillText, { color: theme.textPrimary }]}>
                {card.syncBadge ?? card.source.label}
              </Text>
            </Pill>
            {card.confidence && !card.syncBadge ? (
              <View
                accessible
                accessibilityLabel={`Confidence: ${card.confidence.label}, ${card.confidence.score} of 5`}
              >
                <Pill theme={theme}>
                  <View style={deckStyles.confidenceDots}>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <View
                        key={score}
                        style={[
                          deckStyles.confidenceDot,
                          { backgroundColor: score <= card.confidence!.score ? theme.textPrimary : theme.borderStrong }
                        ]}
                      />
                    ))}
                  </View>
                </Pill>
              </View>
            ) : null}
          </View>
          {card.moreLabel ? (
            <Pressable
              accessibilityLabel={card.moreLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: card.controlsDisabled, expanded: card.menuOpen }}
              disabled={card.controlsDisabled}
              onPress={onMore}
              style={({ pressed }) => [deckStyles.more, pressed ? deckStyles.pressed : null, card.controlsDisabled ? deckStyles.disabled : null]}
              testID={top ? "review-deck-more" : undefined}
            >
              <Pill round theme={theme}>
                <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.more} size={18} />
              </Pill>
            </Pressable>
          ) : null}
        </View>
        <View
          onLayout={(event) => {
            onBodyHeight(event.nativeEvent.layout.height);
            recordMobileLayout(diagnostic, "review-deck.body", event);
          }}
          style={deckStyles.body}
        >
          <Text
            {...mobileTextProps("screenHeading")}
            numberOfLines={2}
            onLayout={(event) => recordMobileLayout(diagnostic, "review-deck.title.frame", event)}
            style={[deckStyles.title, { color: theme.textPrimary }]}
          >
            {card.title}
          </Text>
          {card.when ? (
            <Text {...mobileTextProps("metadata")} style={[deckStyles.when, { color: theme.textSecondary }]}>
              {card.when}
            </Text>
          ) : null}
          <Pressable
            accessibilityHint="Opens the details to change them before logging"
            accessibilityLabel={`Log as ${card.logAsName}, ${card.activityName}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: card.controlsDisabled }}
            disabled={card.controlsDisabled}
            onPress={onEdit}
            style={({ pressed }) => [
              deckStyles.logAs,
              { backgroundColor: theme.surfaceInset },
              pressed ? deckStyles.pressed : null
            ]}
            testID={top ? "review-deck-log-as" : undefined}
          >
            <Text
              {...mobileTextProps("control")}
              numberOfLines={1}
              style={[deckStyles.logAsName, { color: theme.textPrimary }]}
            >
              {card.logAsName}
            </Text>
            <View style={[deckStyles.activityChip, { backgroundColor: card.color }]}>
              <Text {...mobileTextProps("counter")} numberOfLines={1} style={[deckStyles.activityChipText, { color: card.onColor }]}>
                {card.activityName}
              </Text>
            </View>
          </Pressable>
          {card.syncDetail ? (
            <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[deckStyles.reason, { color: theme.textSecondary }]}>
              {card.syncDetail}
            </Text>
          ) : null}
          {card.reason ? (
            <Text
              {...mobileTextProps("metadata")}
              numberOfLines={3}
              onLayout={(event) => recordMobileLayout(diagnostic, "review-deck.reason.frame", event)}
              style={[deckStyles.reason, { color: theme.textMuted }]}
            >
              {card.reason}
            </Text>
          ) : null}
        </View>
      </View>
    </Reanimated.View>
  );
}

/** The stacked cards: the top one is live, up to two sit beneath it. */
export function ReviewDeckStack({
  cards,
  diagnostic,
  onEdit,
  onMore,
  reduceMotion,
  theme
}: {
  cards: readonly ReviewDeckCardModel[];
  diagnostic?: MobileAccessibilityDiagnostic;
  onEdit: (key: string) => void;
  onMore: (key: string) => void;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const visible = cards.slice(0, REVIEW_DECK_VISIBLE_CARDS);
  // The card fills the deck: its body keeps its natural height and the picture takes what is
  // left (230 points at most, 96 at least), so the reason line is never cut off.
  const [deckHeight, setDeckHeight] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(0);
  const pictureHeight = deckHeight && bodyHeight
    ? Math.max(PICTURE_MIN_HEIGHT, Math.min(PICTURE_HEIGHT, Math.floor(deckHeight - bodyHeight)))
    : PICTURE_HEIGHT;
  return (
    <View
      onLayout={(event) => setDeckHeight(event.nativeEvent.layout.height)}
      style={[deckStyles.deck, bodyHeight ? { minHeight: Math.max(360, bodyHeight + PICTURE_MIN_HEIGHT) } : null]}
      testID="review-deck"
    >
      {visible.map((card, depth) => (
        <ReviewDeckCardView
          card={card}
          depth={depth}
          diagnostic={depth === 0 ? diagnostic : undefined}
          key={card.key}
          onBodyHeight={(height) => {
            if (depth === 0) setBodyHeight(Math.ceil(height));
          }}
          onEdit={() => onEdit(card.key)}
          onMore={() => onMore(card.key)}
          pictureHeight={pictureHeight}
          reduceMotion={reduceMotion}
          theme={theme}
        />
      ))}
    </View>
  );
}

function RoundAction({
  accessibilityLabel,
  disabled,
  glyph,
  onPress,
  size,
  testID,
  theme,
  tone
}: {
  accessibilityLabel: string;
  disabled: boolean;
  glyph: DayframeGlyph;
  onPress: () => void;
  size: 52 | 64 | 72;
  testID: string;
  theme: MobileTheme;
  tone: "plain" | "live";
}) {
  const live = tone === "live";
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        deckStyles.round,
        {
          backgroundColor: live ? theme.accent : theme.surfaceMuted,
          borderRadius: size / 2,
          height: size,
          shadowColor: theme.shadow,
          width: size
        },
        pressed && !disabled ? deckStyles.roundPressed : null,
        disabled ? deckStyles.disabled : null
      ]}
      testID={testID}
    >
      <DayframeIcon
        color={live ? theme.onAccent : theme.textPrimary}
        glyph={glyph}
        size={size === 52 ? 22 : 26}
        strokeWidth={2.4}
      />
    </Pressable>
  );
}

/** Skip, Edit before logging and Log it under the deck (prototype `.review-actions`). */
export function ReviewDeckActions({
  logDisabled,
  logLabel,
  onEdit,
  onLog,
  onSkip,
  skipDisabled,
  skipLabel,
  theme
}: {
  /** Log it and Edit before logging: off while the top card has a change waiting or rejected. */
  logDisabled: boolean;
  skipDisabled: boolean;
  logLabel: string;
  onEdit: () => void;
  onLog: () => void;
  onSkip: () => void;
  skipLabel: string;
  theme: MobileTheme;
}) {
  return (
    <View style={deckStyles.actions}>
      <RoundAction
        accessibilityLabel={skipLabel}
        disabled={skipDisabled}
        glyph={DAYFRAME_APP_ICONS.close}
        onPress={onSkip}
        size={64}
        testID="review-deck-skip"
        theme={theme}
        tone="plain"
      />
      <RoundAction
        accessibilityLabel="Edit before logging"
        disabled={logDisabled}
        glyph={DAYFRAME_APP_ICONS.edit}
        onPress={onEdit}
        size={52}
        testID="review-deck-edit"
        theme={theme}
        tone="plain"
      />
      <RoundAction
        accessibilityLabel={logLabel}
        disabled={logDisabled}
        glyph={DAYFRAME_APP_ICONS.done}
        onPress={onLog}
        size={72}
        testID="review-deck-log"
        theme={theme}
        tone="live"
      />
    </View>
  );
}

/** The finished deck: "All framed" with this visit's logged moments as blocks. */
export function ReviewDeckFinished({
  blocks,
  copy,
  onBack,
  theme
}: {
  blocks: readonly string[];
  copy: string;
  onBack: () => void;
  theme: MobileTheme;
}) {
  const colors = blocks.length ? blocks : [theme.borderStrong];
  return (
    <View style={deckStyles.finished} testID="review-deck-finished">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={deckStyles.finishedBlocks}>
        {colors.slice(0, 9).map((color, index) => (
          <View
            key={index}
            style={[deckStyles.finishedBlock, { backgroundColor: color, height: 36 + ((index * 37) % 70) }]}
          />
        ))}
      </View>
      <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" style={[deckStyles.finishedTitle, { color: theme.textPrimary }]}>
        All framed
      </Text>
      <Text {...mobileTextProps("body")} style={[deckStyles.finishedCopy, { color: theme.textSecondary }]}>
        {copy}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [deckStyles.finishedButton, { backgroundColor: theme.accent }, pressed ? deckStyles.pressed : null]}
        testID="review-deck-back-to-today"
      >
        <Text {...mobileTextProps("control")} style={[deckStyles.finishedButtonText, { color: theme.onAccent }]}>
          Back to Today
        </Text>
      </Pressable>
    </View>
  );
}

const deckStyles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 18,
    justifyContent: "center"
  },
  activityChip: {
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    flexShrink: 1,
    maxWidth: "50%",
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  activityChipText: {
    fontSize: 13,
    fontWeight: "700"
  },
  body: {
    gap: 10,
    paddingBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  card: {
    borderRadius: DAYFRAME_BLOCKS.radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 28,
    top: 0,
    transformOrigin: "50% 100%"
  },
  cardClip: {
    borderRadius: DAYFRAME_BLOCKS.radius.sheet,
    flex: 1,
    overflow: "hidden"
  },
  confidenceDot: {
    borderRadius: 3,
    height: 6,
    width: 6
  },
  confidenceDots: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3
  },
  deck: {
    flex: 1,
    // Below this the screen scrolls rather than squeezing the card.
    minHeight: 360,
    marginBottom: 22 + 2 * REVIEW_DECK_DEPTH_OFFSET,
    marginTop: 8,
    maxHeight: 520
  },
  disabled: {
    opacity: 0.45
  },
  finished: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  finishedBlock: {
    borderRadius: 8,
    width: 30
  },
  finishedBlocks: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 6,
    height: 120
  },
  finishedButton: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 24
  },
  finishedButtonText: {
    fontSize: 16,
    fontWeight: "700"
  },
  finishedCopy: {
    maxWidth: 260,
    textAlign: "center"
  },
  finishedTitle: {
    fontFamily: MOBILE_DISPLAY_FONT.bold,
    fontSize: 40,
    letterSpacing: -1.4
  },
  logAs: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 52,
    padding: 12
  },
  logAsName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    minWidth: 0
  },
  more: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 44
  },
  picture: {
    overflow: "hidden"
  },
  pill: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    flexDirection: "row",
    gap: 5,
    minHeight: 26,
    minWidth: 26,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  pillRound: {
    height: 32,
    paddingHorizontal: 0,
    width: 32
  },
  pillRow: {
    flexDirection: "row",
    gap: 6,
    left: 14,
    position: "absolute",
    top: 14
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700"
  },
  pressed: {
    opacity: 0.72
  },
  reason: {
    fontSize: 12.5
  },
  round: {
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 18
  },
  roundPressed: {
    transform: [{ scale: 0.92 }]
  },
  title: {
    fontFamily: MOBILE_DISPLAY_FONT.bold,
    fontSize: 30,
    letterSpacing: -0.9,
    lineHeight: 31
  },
  when: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "600"
  }
});
