import { memo, useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming
} from "react-native-reanimated";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS, type DayframeGlyph } from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { recordMobileLayout, type MobileAccessibilityDiagnostic } from "@/components/accessibility/diagnostics";
import { BLOCKS_SPRING } from "@/lib/blocksMotion";
import { playHaptic } from "@/lib/haptics";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import type { MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import {
  REVIEW_DECK_DEPTH_OFFSET,
  REVIEW_DECK_DEPTH_SCALE,
  REVIEW_DECK_FLING,
  REVIEW_DECK_RETURN_FROM,
  REVIEW_DECK_THROW_THRESHOLD,
  reviewDeckArmDirection,
  REVIEW_DECK_TILT_DIVISOR,
  REVIEW_DECK_VERTICAL_FOLLOW,
  REVIEW_DECK_VISIBLE_CARDS,
  type ReviewDeckPicture,
  type ReviewDeckSourceIcon
} from "@/lib/reviewDeck";

/** Height kept free under the last control for the Undo toast (52-point toast, 12 gap, slack for large text). */
export const REVIEW_DECK_TOAST_RESERVE = 84;

export type ReviewDeckDirection = 1 | -1;
/** A Log it / Skip button press asks the top card to fly out as if thrown. */
export type ReviewDeckThrowRequest = { key: string; direction: ReviewDeckDirection; token: number };
/** Undo asks the returning card to fly back in from the side it left. */
export type ReviewDeckReturn = { key: string; direction: ReviewDeckDirection; token: number };

const flingEasing = Easing.bezier(...REVIEW_DECK_FLING.easing);
const landSpring = { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never };

function playArmTick() {
  playHaptic("tick");
}

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
  /** Step 5c-1: the name and activity can be changed on the card before logging. */
  logAsEditable: boolean;
  activityName: string;
  reason: string | null;
  /** A durable Review change for this card is waiting or needs attention. */
  syncBadge: string | null;
  syncDetail: string | null;
  controlsDisabled: boolean;
  /** The card's More menu (Edit details, Dismiss suggestion). */
  moreLabel: string | null;
  menuOpen: boolean;
  /** Swiping right logs; swiping left skips (or, for a card that cannot be skipped, defers). */
  canLog: boolean;
  canSkip: boolean;
  /** Skip only moves the card behind the rest for this visit ("Skip for now"). */
  skipDefers: boolean;
  /** React key: changes when a deferred card comes back, so it returns as a fresh card. */
  renderKey?: string;
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
  onLogAsActivity,
  onLogAsName,
  onMore,
  onThrow,
  onThrowStart,
  pictureHeight,
  reduceMotion,
  returnFrom,
  theme,
  throwRequest,
  flying = false,
  locked = false
}: {
  card: ReviewDeckCardModel;
  depth: number;
  /** Already thrown and on its way out: drawn above the rest, never touched or read. */
  flying?: boolean;
  /** Moving up under a card still flying out: in place at once, interactive once the flight ends. */
  locked?: boolean;
  /** Synthetic accessibility probe only: the top card reports its frames. */
  diagnostic?: MobileAccessibilityDiagnostic;
  onBodyHeight: (height: number) => void;
  onEdit: () => void;
  onLogAsActivity: () => void;
  onLogAsName: (name: string) => void;
  onMore: () => void;
  /** Called as the card is thrown: the decision is taken here. */
  onThrowStart: (direction: ReviewDeckDirection) => void;
  /** Called once the card has left (after the fling, or at once with Reduce Motion). */
  onThrow: (direction: ReviewDeckDirection) => void;
  pictureHeight: number;
  reduceMotion: boolean;
  returnFrom: ReviewDeckReturn | null;
  theme: MobileTheme;
  throwRequest: ReviewDeckThrowRequest | null;
}) {
  // One owner per card: its depth in the stack. A card moving up after the top one is decided lands
  // with the Blocks `land` spring; Reduce Motion moves it at once.
  const animatedDepth = useSharedValue(depth);
  useEffect(() => {
    animatedDepth.value = reduceMotion
      ? depth
      : withSpring(depth, { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never });
  }, [animatedDepth, depth, reduceMotion]);
  const top = depth === 0 && !flying && !locked;

  // The top card's drag (Blocks parity step 5b): one Pan owner on the UI thread. It follows the
  // finger (40 % vertically, tilting dx/18°), arms past ±110 with one tick, and on release either
  // flies out (340 ms) and reports the throw, or springs home with `land`.
  const returning = returnFrom && !reduceMotion ? returnFrom.direction * REVIEW_DECK_RETURN_FROM : 0;
  const dragX = useSharedValue(returning);
  const dragY = useSharedValue(0);
  // A card unmounted mid-flight (Undo re-mounts it) stops its fling, so the dead instance never
  // reports a throw end that would cut the next flight short.
  useEffect(() => () => {
    cancelAnimation(dragX);
    cancelAnimation(dragY);
  }, [dragX, dragY]);
  const armed = useSharedValue(0);
  const thrown = useSharedValue(false);
  useEffect(() => {
    // The `sheet` spring settles without overshoot, so the opposite stamp never flashes on the way in.
    if (returning) dragX.value = withSpring(0, { ...BLOCKS_SPRING.sheet, reduceMotion: ReduceMotion.Never });
    // Plays once, when Undo brings this card back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A request already present when this card mounts (e.g. it returns by Undo) is never replayed.
  const lastThrowToken = useSharedValue(throwRequest?.token ?? 0);
  const { canLog, canSkip } = card;
  function flyOut(direction: ReviewDeckDirection) {
    "worklet";
    if (thrown.value) return;
    thrown.value = true;
    // The decision is reported as the throw starts, so leaving Review mid-flight still saves it;
    // the flight is only visual, and its end lets the next card land.
    runOnJS(onThrowStart)(direction);
    if (reduceMotion) {
      runOnJS(onThrow)(direction);
      return;
    }
    dragY.value = withTiming(dragY.value - REVIEW_DECK_FLING.lift, { duration: REVIEW_DECK_FLING.durationMs, easing: flingEasing });
    dragX.value = withTiming(
      direction * REVIEW_DECK_FLING.distance,
      { duration: REVIEW_DECK_FLING.durationMs, easing: flingEasing },
      (finished) => {
        if (finished) runOnJS(onThrow)(direction);
      }
    );
  }
  useEffect(() => {
    if (!top || !throwRequest || throwRequest.key !== card.key || lastThrowToken.value === throwRequest.token) return;
    lastThrowToken.value = throwRequest.token;
    // A button press for a direction the card can no longer take (its sync state changed in the
    // same moment) does nothing rather than throw a card nobody will catch.
    if (throwRequest.direction === 1 ? !canLog : !canSkip) return;
    flyOut(throwRequest.direction);
    // flyOut reads only shared values and the latest props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throwRequest, top, card.key, canLog, canSkip]);
  // Touches that start in the name field belong to the field (cursor and selection drags), never
  // to the card's throw.
  const logAsFieldGesture = Gesture.Native();
  const dragStartX = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const pan = Gesture.Pan()
    .enabled(top)
    .requireExternalGestureToFail(logAsFieldGesture)
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onStart(() => {
      if (thrown.value) return;
      // Catching a card that is still springing home (or flying back after Undo) continues from
      // where it is instead of snapping.
      cancelAnimation(dragX);
      cancelAnimation(dragY);
      dragStartX.value = dragX.value;
      dragStartY.value = dragY.value;
    })
    .onUpdate((event) => {
      if (thrown.value) return;
      const x = dragStartX.value + event.translationX;
      // A direction the card cannot take resists instead of arming.
      const blocked = (x > 0 && !canLog) || (x < 0 && !canSkip);
      dragX.value = blocked ? x * 0.2 : x;
      dragY.value = dragStartY.value + event.translationY;
      const next = reviewDeckArmDirection(dragX.value, event.translationX);
      if (next !== armed.value) {
        armed.value = next;
        if (next !== 0) runOnJS(playArmTick)();
      }
    })
    .onEnd((_event, success) => {
      if (thrown.value) return;
      const direction = armed.value as -1 | 0 | 1;
      armed.value = 0;
      // A cancelled gesture (interrupted, app backgrounded) never decides: the card goes home.
      // A direction the card can no longer take (its sync state changed mid-drag) goes home too.
      const allowed = direction === 1 ? canLog : canSkip;
      if (direction !== 0 && success && allowed) {
        flyOut(direction);
        return;
      }
      dragX.value = reduceMotion ? 0 : withSpring(0, landSpring);
      dragY.value = reduceMotion ? 0 : withSpring(0, landSpring);
    });
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value },
      { translateY: animatedDepth.value * REVIEW_DECK_DEPTH_OFFSET + dragY.value * REVIEW_DECK_VERTICAL_FOLLOW },
      // Reduce Motion: the card follows the finger without tilting.
      { rotate: reduceMotion ? "0deg" : `${dragX.value / REVIEW_DECK_TILT_DIVISOR}deg` },
      { scale: 1 - animatedDepth.value * REVIEW_DECK_DEPTH_SCALE }
    ]
  }));
  const logStampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, dragX.value / REVIEW_DECK_THROW_THRESHOLD))
  }));
  const skipStampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -dragX.value / REVIEW_DECK_THROW_THRESHOLD))
  }));

  return (
    <GestureDetector gesture={pan}>
    <Reanimated.View
      accessibilityElementsHidden={!top}
      // A card brought back by Undo flies in instead of fading in.
      entering={returnFrom && !reduceMotion ? undefined : localPresenceEntering(reduceMotion)}
      exiting={localPresenceExiting(reduceMotion)}
      importantForAccessibility={top ? "auto" : "no-hide-descendants"}
      pointerEvents={top ? "box-none" : "none"}
      style={[
        deckStyles.card,
        {
          backgroundColor: theme.surfaceRaised,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          zIndex: flying ? REVIEW_DECK_VISIBLE_CARDS + 1 : REVIEW_DECK_VISIBLE_CARDS - depth
        },
        cardStyle
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
          {top || flying ? (
            <>
              <Reanimated.View
                pointerEvents="none"
                style={[deckStyles.stamp, deckStyles.stampLog, { backgroundColor: theme.success }, logStampStyle]}
              >
                <Text accessible={false} style={[deckStyles.stampText, { color: "#04130D" }]}>LOG IT</Text>
              </Reanimated.View>
              <Reanimated.View
                pointerEvents="none"
                style={[deckStyles.stamp, deckStyles.stampSkip, { backgroundColor: theme.surfaceMuted }, skipStampStyle]}
              >
                <Text accessible={false} style={[deckStyles.stampText, { color: theme.textPrimary }]}>
                  {card.skipDefers ? "LATER" : "SKIP"}
                </Text>
              </Reanimated.View>
            </>
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
          {card.logAsEditable && top ? (
            <View style={[deckStyles.logAs, { backgroundColor: theme.surfaceInset }]} testID="review-deck-log-as">
              <GestureDetector gesture={logAsFieldGesture}>
              <TextInput
                {...mobileTextProps("input")}
                accessibilityLabel="Log as"
                accessibilityHint="The name the moment is logged with"
                maxLength={500}
                onChangeText={onLogAsName}
                placeholder="Name this moment"
                placeholderTextColor={theme.textMuted}
                returnKeyType="done"
                style={[deckStyles.logAsName, deckStyles.logAsInput, { color: theme.textPrimary }]}
                testID="review-deck-log-as-name"
                // Uncontrolled: typing never re-renders the deck. The card remounts on Undo.
                defaultValue={card.logAsName}
              />
              </GestureDetector>
              <Pressable
                accessibilityHint="Opens all activities"
                accessibilityLabel={`Activity, ${card.activityName}`}
                accessibilityRole="button"
                onPress={onLogAsActivity}
                style={({ pressed }) => [deckStyles.activityChip, deckStyles.activityChipButton, { backgroundColor: card.color }, pressed ? deckStyles.pressed : null]}
                testID="review-deck-log-as-activity"
              >
                <Text {...mobileTextProps("counter")} numberOfLines={1} style={[deckStyles.activityChipText, { color: card.onColor }]}>
                  {card.activityName}
                </Text>
              </Pressable>
            </View>
          ) : (
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
          )}
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
    </GestureDetector>
  );
}

/** The stacked cards: the top one is live, up to two sit beneath it. */
export function ReviewDeckStack({
  cards,
  diagnostic,
  onEdit,
  onLogAsActivity,
  onLogAsName,
  onMore,
  onThrow,
  onThrowStart,
  reduceMotion,
  returnRequest = null,
  theme,
  throwRequest = null,
  flyingKey = null
}: {
  /** The thrown card still flying out: the cards beneath start moving up at once. */
  flyingKey?: string | null;
  cards: readonly ReviewDeckCardModel[];
  diagnostic?: MobileAccessibilityDiagnostic;
  onEdit: (key: string) => void;
  onLogAsActivity?: (key: string) => void;
  onLogAsName?: (key: string, name: string) => void;
  onMore: (key: string) => void;
  onThrow: (key: string, direction: ReviewDeckDirection) => void;
  onThrowStart: (key: string, direction: ReviewDeckDirection) => void;
  reduceMotion: boolean;
  returnRequest?: ReviewDeckReturn | null;
  theme: MobileTheme;
  throwRequest?: ReviewDeckThrowRequest | null;
}) {
  // While the top card flies out, the next ones already take its place (one more card shows at the
  // back), so the deck never waits for the flight to end.
  const topFlying = Boolean(flyingKey) && cards[0]?.key === flyingKey;
  const visible = cards.slice(0, REVIEW_DECK_VISIBLE_CARDS + (topFlying ? 1 : 0));
  // The card fills the deck: its body keeps its natural height and the picture takes what is
  // left (230 points at most, 96 at least), so the reason line is never cut off.
  const [deckHeight, setDeckHeight] = useState(0);
  // Each card reports its own body; the top card's decides. A card promoted from beneath does not
  // lay out again, so its height must already be known.
  const [bodyHeights, setBodyHeights] = useState<Record<string, number>>({});
  // Sized for the card taking the top, not the one flying out.
  const sizingCard = visible[topFlying ? 1 : 0] ?? visible[0];
  const bodyHeight = sizingCard ? bodyHeights[sizingCard.key] ?? 0 : 0;
  const pictureHeight = deckHeight && bodyHeight
    ? Math.max(PICTURE_MIN_HEIGHT, Math.min(PICTURE_HEIGHT, Math.floor(deckHeight - bodyHeight)))
    : PICTURE_HEIGHT;
  return (
    <View
      onLayout={(event) => setDeckHeight(event.nativeEvent.layout.height)}
      style={[deckStyles.deck, bodyHeight ? { minHeight: Math.max(360, bodyHeight + PICTURE_MIN_HEIGHT) } : null]}
      testID="review-deck"
    >
      {visible.map((card, index) => {
        const flying = topFlying && index === 0;
        const depth = topFlying && index > 0 ? index - 1 : index;
        return (
        <ReviewDeckCardView
          card={card}
          depth={depth}
          diagnostic={depth === 0 && !flying ? diagnostic : undefined}
          flying={flying}
          locked={topFlying && !flying}
          key={card.renderKey ?? card.key}
          onBodyHeight={(height) => {
            const rounded = Math.ceil(height);
            setBodyHeights((current) => (current[card.key] === rounded ? current : { ...current, [card.key]: rounded }));
          }}
          onEdit={() => onEdit(card.key)}
          onLogAsActivity={() => onLogAsActivity?.(card.key)}
          onLogAsName={(name) => onLogAsName?.(card.key, name)}
          onMore={() => onMore(card.key)}
          onThrow={(direction) => onThrow(card.key, direction)}
          onThrowStart={(direction) => onThrowStart(card.key, direction)}
          pictureHeight={pictureHeight}
          reduceMotion={reduceMotion}
          returnFrom={returnRequest?.key === card.key ? returnRequest : null}
          theme={theme}
          throwRequest={depth === 0 && !flying ? throwRequest : null}
        />
        );
      })}
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

const popSpring = { ...BLOCKS_SPRING.pop, reduceMotion: ReduceMotion.Never };

/** One finished block dropping in (prototype: from -260 points, tilted -12°, `land`, 80 + i×90 ms). */
function FinishedBlock({ color, index, reduceMotion }: { color: string; index: number; reduceMotion: boolean }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(80 + index * 90, withSpring(1, landSpring));
    // Plays once when "All framed" appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 2),
    transform: [{ translateY: (1 - progress.value) * -260 }, { rotate: `${(1 - progress.value) * -12}deg` }]
  }));
  return (
    <Reanimated.View
      style={[deckStyles.finishedBlock, { backgroundColor: color, height: 36 + ((index * 37) % 70) }, style]}
    />
  );
}

/** The finished deck: "All framed" with this visit's logged moments as blocks. */
export function ReviewDeckFinished({
  blocks,
  celebrate,
  copy,
  footer,
  onBack,
  reduceMotion,
  theme
}: {
  blocks: readonly string[];
  /** Only a finish reached by this visit's own decision drops in and plays the haptic. */
  celebrate: boolean;
  copy: string;
  footer?: ReactNode;
  onBack: () => void;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const colors = blocks.length ? blocks : [theme.borderStrong];
  const animate = celebrate && !reduceMotion;
  const titleScale = useSharedValue(animate ? 0.8 : 1);
  useEffect(() => {
    if (animate) titleScale.value = withDelay(200, withSpring(1, popSpring));
    // One success tick once the blocks have landed, only after this visit logged something.
    const haptic = celebrate && blocks.length ? setTimeout(() => playHaptic("reviewLog"), 300) : null;
    return () => {
      if (haptic) clearTimeout(haptic);
    };
    // Plays once when "All framed" appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const titleStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, (titleScale.value - 0.8) * 5),
    transform: [{ scale: titleScale.value }]
  }));
  return (
    <View style={deckStyles.finished} testID="review-deck-finished">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={deckStyles.finishedBlocks}>
        {colors.slice(0, 9).map((color, index) => (
          <FinishedBlock color={color} index={index} key={index} reduceMotion={!animate} />
        ))}
      </View>
      <Reanimated.View style={titleStyle}>
        <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" style={[deckStyles.finishedTitle, { color: theme.textPrimary }]}>
          All framed
        </Text>
      </Reanimated.View>
      <Text {...mobileTextProps("body")} style={[deckStyles.finishedCopy, { color: theme.textSecondary }]}>
        {copy}
      </Text>
      {/* The Undo toast hangs from this wrapper, out of flow, so its exit never moves the button. */}
      <View style={deckStyles.finishedActions}>
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
      {footer}
      </View>
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
  finishedActions: {
    alignItems: "center",
    alignSelf: "stretch",
    // Room for the Undo toast that hangs below, always reserved so it stays inside the scroll
    // area and its exit moves nothing.
    paddingBottom: REVIEW_DECK_TOAST_RESERVE,
    position: "relative"
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
  logAsInput: {
    minHeight: 44,
    paddingVertical: 0
  },
  activityChipButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44
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
  stamp: {
    borderRadius: 12,
    opacity: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: "absolute",
    top: 26
  },
  stampLog: {
    right: 18,
    transform: [{ rotate: "10deg" }]
  },
  stampSkip: {
    left: 18,
    transform: [{ rotate: "-10deg" }]
  },
  stampText: {
    fontFamily: MOBILE_DISPLAY_FONT.extraBold,
    fontSize: 24,
    letterSpacing: 0.5
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
