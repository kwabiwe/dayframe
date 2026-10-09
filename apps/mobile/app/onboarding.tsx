// First sign-in setup in Blocks (parity step 8-1a; prototype design/blocks/onboarding.html).
// Welcome, Location (While Using, then the Always explainer), Motion & Fitness and the summary.
// Each permission explains itself before iOS asks, every step can wait ("Not now" / "Later"),
// and nothing here starts a timer or logs time. The screen owns permissions and the step state;
// `src/lib/onboarding.ts` holds the order and the words.
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from "react-native";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS, blockColorsFor, type DayframeGlyph, type DayframePaletteKey } from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { AuthRequiredError, ensureAutomaticLoggingCategories, fetchBootstrap } from "@/lib/api";
import { getLocationVisitDiagnostics, setLocationLearningEnabled } from "@/lib/geofence";
import { playHaptic } from "@/lib/haptics";
import { readMotionFitnessStatus, requestMotionFitness } from "@/lib/location/motionPermission";
import { mobileAccountOwnersEqual, readActiveMobileAccount, type MobileAccountOwner } from "@/lib/mobileAccount";
import { subscribeMobileSignedOut } from "@/lib/mobileSessionTransition";
import { subscribeAuthenticatedSession } from "@/lib/secure-session";
import { useMobileTheme, type MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import { BLOCKS_SPRING } from "@/lib/blocksMotion";
import { localLayoutTransition, localPresenceEntering, useReduceMotionPreference } from "@/lib/motion";
import {
  EMPTY_ONBOARDING_ANSWERS,
  ONBOARDING_PROGRESS,
  locationChoiceFromPermissions,
  locationResultText,
  motionResultText,
  suggestionsStateFrom,
  nextOnboardingStep,
  onboardingChrome,
  onboardingProgressDone,
  onboardingSummary,
  previousOnboardingStep,
  type MotionChoice,
  type OnboardingAnswers,
  type OnboardingStep
} from "@/lib/onboarding";

const STEP_SLIDE = 36;

export default function OnboardingScreen() {
  const { theme } = useMobileTheme();
  const reduceMotion = useReduceMotionPreference();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ONBOARDING_ANSWERS);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  // The progress block a forward move just finished; it lands once.
  const [landed, setLanded] = useState<OnboardingStep | null>(null);
  const mounted = useRef(true);
  const owner = useRef<MobileAccountOwner | null>(null);
  // Bumped whenever the session changes or ends: an answer from before that never applies (an
  // A → B → A switch passes an owner comparison alone).
  const sessionEpoch = useRef(0);
  // The welcome's sample day drops in once per visit, not again after Back.
  const welcomePlayed = useRef(false);
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    const bump = () => {
      sessionEpoch.current += 1;
    };
    const unsubscribeSession = subscribeAuthenticatedSession(bump);
    const unsubscribeSignedOut = subscribeMobileSignedOut(bump);
    return () => {
      mounted.current = false;
      unsubscribeSession();
      unsubscribeSignedOut();
    };
  }, []);

  // Covered by another page (or left): an answer still in flight no longer applies.
  useFocusEffect(useCallback(() => () => {
    sessionEpoch.current += 1;
  }, []));

  // A new step starts at its top (the scroll view is keyed by step) and VoiceOver moves to its heading.
  useEffect(() => {
    const handle = findNodeHandle(titleRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [step, answers.locationStage]);

  // Setup opened again from Settings shows what is already answered rather than asking twice.
  useEffect(() => {
    void (async () => {
      const epoch = sessionEpoch.current;
      owner.current = await readActiveMobileAccount();
      const [foreground, background, motion, diagnostics] = await Promise.all([
        Location.getForegroundPermissionsAsync().catch(() => null),
        Location.getBackgroundPermissionsAsync().catch(() => null),
        readMotionFitnessStatus(),
        getLocationVisitDiagnostics().catch(() => null)
      ]);
      if (!(await stillHere(epoch))) return;
      const location = foreground && !foreground.granted && !foreground.canAskAgain
        ? "off"
        : locationChoiceFromPermissions(Boolean(foreground?.granted), Boolean(background?.granted));
      setAnswers((current) => ({
        ...current,
        location: current.location ?? (location === "while" ? null : location),
        // This account's own choice: Always on the phone doesn't mean this account turned suggestions on.
        suggestions: diagnostics ? suggestionsStateFrom(diagnostics) : current.suggestions,
        // While Using is already given: the Location step opens at the Always explainer.
        locationStage: location === "while" ? "upgrade" : current.locationStage,
        motion: current.motion ?? motionChoiceFrom(motion, false)
      }));
    })();
  }, []);

  /** True while this screen is still open in the same session, for the account it opened with. */
  const stillHere = useCallback(async (epoch: number) => {
    if (!mounted.current || epoch !== sessionEpoch.current) return false;
    const active = await readActiveMobileAccount();
    return mounted.current && epoch === sessionEpoch.current && mobileAccountOwnersEqual(owner.current, active);
  }, []);

  function go(next: OnboardingStep, dir: 1 | -1) {
    setDirection(dir);
    setLanded(dir === 1 && ONBOARDING_PROGRESS.some((item) => item.step === step) ? step : null);
    setStep(next);
    playHaptic("tick");
  }

  async function run(work: (epoch: number) => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await work(sessionEpoch.current);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  // Location, first ask: While Using. iOS shows its own prompt; ours explains first.
  function allowLocation() {
    void run(async (epoch) => {
      const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!(await stillHere(epoch))) return;
      if (!foreground?.granted) {
        setAnswers((current) => ({ ...current, location: "off" }));
        announce("Location is off.");
        return;
      }
      const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (!(await stillHere(epoch))) return;
      if (background?.granted) {
        await finishAlways(epoch);
        return;
      }
      setAnswers((current) => ({ ...current, locationStage: "upgrade" }));
    });
  }

  // Location, second ask: Always, so trips aren't missed with the phone locked.
  function askAlways() {
    void run(async (epoch) => {
      const background = await Location.requestBackgroundPermissionsAsync().catch(() => null);
      if (!(await stillHere(epoch))) return;
      if (background?.granted) await finishAlways(epoch);
      else keepWhileUsing();
    });
  }

  // Always was already allowed (on this phone, perhaps for another account): this account opts in.
  function turnOnSuggestions() {
    void run((epoch) => finishAlways(epoch));
  }

  function keepWhileUsing() {
    setAnswers((current) => ({ ...current, location: "while", locationStage: "explain" }));
    announce("Location works while Dayframe is open.");
  }

  /** Always is allowed: switch on visit and journey suggestions, as Settings › Location does. */
  async function finishAlways(epoch: number) {
    setAnswers((current) => ({ ...current, location: "always", locationStage: "explain" }));
    let enabled = false;
    try {
      const data = await fetchBootstrap();
      if (!(await stillHere(epoch))) return;
      await ensureAutomaticLoggingCategories(["commute"]);
      if (!(await stillHere(epoch))) return;
      await setLocationLearningEnabled(true, data.places, { userId: data.user.id, workspaceId: data.workspace.id });
      if (!(await stillHere(epoch))) return;
      // The account's own consent and a running capture decide, not the call's wording.
      enabled = suggestionsStateFrom(await getLocationVisitDiagnostics()) === "on";
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        if (mounted.current && epoch === sessionEpoch.current) router.replace("/");
        return;
      }
    }
    if (!(await stillHere(epoch))) return;
    setAnswers((current) => ({ ...current, suggestions: enabled ? "on" : "failed" }));
    announce(enabled ? "Location is on. Suggestions are on." : "Suggestions couldn't be switched on.");
  }

  function allowMotion() {
    void run(async (epoch) => {
      const status = await requestMotionFitness();
      if (!(await stillHere(epoch))) return;
      const choice = motionChoiceFrom(status, true) ?? "off";
      setAnswers((current) => ({ ...current, motion: choice }));
      announce(choice === "on" ? "Motion & Fitness is on." : "Motion & Fitness is off.");
    });
  }

  function notNow() {
    if (step === "location") setAnswers((current) => ({ ...current, location: current.location ?? "off" }));
    if (step === "motion") setAnswers((current) => ({ ...current, motion: current.motion ?? "off" }));
    go(nextOnboardingStep(step), 1);
  }

  function finish() {
    // Today, whichever page setup was opened from.
    router.dismissTo("/(tabs)/today");
  }

  const chrome = onboardingChrome(step);
  const content = stepContent(step, answers);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.top}>
        <View style={styles.topSide}>
          {chrome.back ? (
            <Pressable
              accessibilityLabel="Previous step"
              accessibilityRole="button"
              disabled={busy}
              onPress={() => go(previousOnboardingStep(step), -1)}
              style={({ pressed }) => [styles.back, { backgroundColor: theme.surface }, pressed ? styles.pressed : null]}
              testID="onboarding-back"
            >
              <BackArrow color={theme.textPrimary} />
            </Pressable>
          ) : null}
        </View>
        <ProgressBlocks done={onboardingProgressDone(step)} landed={landed} reduceMotion={reduceMotion} theme={theme} />
        <View style={[styles.topSide, styles.topRight]}>
          {chrome.later ? (
            <Pressable
              accessibilityHint="Skips the remaining steps. Everything is in Settings."
              accessibilityRole="button"
              disabled={busy}
              onPress={() => go("done", 1)}
              style={({ pressed }) => [styles.later, pressed ? styles.pressed : null]}
              testID="onboarding-later"
            >
              <Text {...mobileTextProps("control")} style={[styles.laterText, { color: theme.textSecondary }]}>Later</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.bodyContent} key={step} style={styles.body}>
        {/* One owner for step movement: each step (and the Always explainer) enters from the side
            it comes from with the sheet spring; Reduce Motion fades. The old step leaves at once. */}
        <Reanimated.View
          entering={reduceMotion ? localPresenceEntering(true) : stepEntering(direction)}
          key={`${step}:${answers.locationStage}`}
          style={styles.step}
        >
          {step === "welcome" ? <WelcomeDay played={welcomePlayed} reduceMotion={reduceMotion} theme={theme} /> : null}
          {content.glyph ? <StepGlyph color={content.glyph.color} glyph={content.glyph.name} theme={theme} /> : null}
          <Text {...mobileTextProps("screenHeading")} accessibilityRole="header" ref={titleRef} style={[styles.title, { color: theme.textPrimary }]}>
            {content.title}
          </Text>
          {content.lede ? (
            <Text {...mobileTextProps("body")} style={[styles.lede, { color: theme.textSecondary }]}>{content.lede}</Text>
          ) : null}
          {step === "location" && answers.locationStage === "explain" && !answers.location ? <ReviewPreview theme={theme} /> : null}
          {step === "motion" && !answers.motion ? <MotionPreview theme={theme} /> : null}
          {content.bullets.map((bullet) => (
            <View key={bullet.text} style={styles.bullet}>
              <DayframeIcon color={theme.textSecondary} glyph={bullet.glyph} size={18} />
              <Text {...mobileTextProps("body")} style={[styles.bulletText, { color: theme.textPrimary }]}>{bullet.text}</Text>
            </View>
          ))}
          {content.privacy ? (
            <View style={[styles.privacy, { backgroundColor: theme.surfaceInset }]}>
              <DayframeIcon color={theme.textMuted} glyph="shield" size={16} />
              <Text {...mobileTextProps("metadata")} style={[styles.privacyText, { color: theme.textSecondary }]}>{content.privacy}</Text>
            </View>
          ) : null}
          {step === "done" ? <DoneSummary answers={answers} theme={theme} /> : null}
          {content.result ? (
            <Reanimated.View
              entering={localPresenceEntering(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
              style={[styles.result, { backgroundColor: theme.surface }]}
              testID="onboarding-result"
            >
              <DayframeIcon color={content.result.on ? theme.success : theme.textMuted} glyph={content.result.on ? "check" : "timer"} size={18} />
              <Text {...mobileTextProps("body")} accessibilityLiveRegion="polite" style={[styles.resultText, { color: theme.textPrimary }]}>
                {content.result.text}
              </Text>
            </Reanimated.View>
          ) : null}
        </Reanimated.View>
      </ScrollView>

      <View style={styles.actions}>
        <StepActions
          answers={answers}
          busy={busy}
          onAllowLocation={allowLocation}
          onAllowMotion={allowMotion}
          onAskAlways={askAlways}
          onContinue={() => go(nextOnboardingStep(step), 1)}
          onTurnOnSuggestions={turnOnSuggestions}
          onFinish={finish}
          onKeepWhileUsing={keepWhileUsing}
          onNotNow={notNow}
          step={step}
          theme={theme}
        />
      </View>
    </SafeAreaView>
  );
}

function announce(text: string) {
  AccessibilityInfo.announceForAccessibility(text);
}

function motionChoiceFrom(status: string, asked: boolean): MotionChoice | null {
  if (status === "authorized") return "on";
  if (status === "unavailable") return "unavailable";
  if (status === "denied" || status === "restricted") return "off";
  return asked ? "off" : null;
}

type StepContent = {
  glyph: { name: DayframeGlyph; color: DayframePaletteKey } | null;
  title: string;
  lede: string | null;
  bullets: { glyph: DayframeGlyph; text: string }[];
  privacy: string | null;
  result: { on: boolean; text: string } | null;
};

function stepContent(step: OnboardingStep, answers: OnboardingAnswers): StepContent {
  switch (step) {
    case "welcome":
      return {
        glyph: null,
        title: "Your day, built from blocks.",
        lede: "Dayframe turns what you do, where you go and how you move into a day you can see. Suggestions wait for you in Review, and nothing is logged until you say so.",
        bullets: [],
        privacy: null,
        result: null
      };
    case "location": {
      const upgrade = answers.locationStage === "upgrade" && !answers.location;
      return {
        glyph: { name: DAYFRAME_APP_ICONS.places, color: "red" },
        title: upgrade ? "One more step for drives" : "Suggest visits and journeys",
        lede: upgrade
          ? "iOS will now ask whether Dayframe can use location when it isn't open. Choose Change to Always Allow so trips aren't missed while your phone is in your pocket."
          : "Dayframe notices when you arrive, leave and travel, and suggests them as blocks for you to confirm.",
        bullets: upgrade || answers.location ? [] : [
          { glyph: "check", text: "You stay in charge. Suggestions go to Review. Only places you trust can log on their own, and only if you turn that on." },
          { glyph: "route", text: "Always works best. iOS asks twice: first while using the app, then for Always." }
        ],
        privacy: upgrade ? null : "Precise location stays private to your account. It is never used for ads or analytics, and you can export or delete it any time.",
        result: answers.location
          ? {
              on: answers.location === "always" && answers.suggestions === "on",
              text: locationResultText(answers.location, answers.suggestions)
            }
          : null
      };
    }
    case "motion":
      return {
        glyph: { name: "footprints", color: "amber" },
        title: "Tell walking from driving",
        lede: "Your iPhone's motion chip knows when you're still, walking or in a car. Dayframe uses it to catch short trips that GPS alone can miss.",
        bullets: answers.motion ? [] : [
          { glyph: "car", text: "Sharper start and end times for drives and walks." },
          { glyph: "zap", text: "Light on battery. Motion runs on a low-power chip, so GPS can rest more." }
        ],
        privacy: "Motion activity is used only to understand your trips. It stays on your account and is never used for ads or analytics.",
        result: answers.motion ? { on: answers.motion === "on", text: motionResultText(answers.motion) } : null
      };
    case "done":
      return {
        glyph: null,
        title: "You're set.",
        lede: "Anything marked Later is one tap away in Settings › Automatic tracking.",
        bullets: [],
        privacy: null,
        result: null
      };
  }
}

function StepActions({
  answers,
  busy,
  onAllowLocation,
  onAllowMotion,
  onAskAlways,
  onContinue,
  onFinish,
  onKeepWhileUsing,
  onNotNow,
  onTurnOnSuggestions,
  step,
  theme
}: {
  answers: OnboardingAnswers;
  busy: boolean;
  onAllowLocation: () => void;
  onAllowMotion: () => void;
  onAskAlways: () => void;
  onContinue: () => void;
  onFinish: () => void;
  onKeepWhileUsing: () => void;
  onNotNow: () => void;
  onTurnOnSuggestions: () => void;
  step: OnboardingStep;
  theme: MobileTheme;
}) {
  if (step === "welcome") {
    return (
      <>
        <PrimaryButton label="Set up Dayframe" onPress={onContinue} testID="onboarding-start" theme={theme} />
        <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textMuted }]}>About a minute. Every step can wait.</Text>
      </>
    );
  }
  if (step === "done") return <PrimaryButton label="Open Today" onPress={onFinish} testID="onboarding-finish" theme={theme} />;
  if (step === "location" && !answers.location) {
    return answers.locationStage === "upgrade" ? (
      <>
        <PrimaryButton busy={busy} label="Continue to iOS prompt" onPress={onAskAlways} testID="onboarding-location-always" theme={theme} />
        <SecondaryButton disabled={busy} label="Keep while using only" onPress={onKeepWhileUsing} testID="onboarding-location-while" theme={theme} />
      </>
    ) : (
      <>
        <PrimaryButton busy={busy} label="Allow location" onPress={onAllowLocation} testID="onboarding-location-allow" theme={theme} />
        <SecondaryButton disabled={busy} label="Not now" onPress={onNotNow} testID="onboarding-not-now" theme={theme} />
      </>
    );
  }
  if (step === "location" && answers.location === "always" && answers.suggestions !== "on") {
    return (
      <>
        <PrimaryButton
          busy={busy}
          label={answers.suggestions === "failed" ? "Try again" : answers.suggestions === "paused" ? "Retry capture" : "Turn on suggestions"}
          onPress={onTurnOnSuggestions}
          testID="onboarding-suggestions-on"
          theme={theme}
        />
        <SecondaryButton disabled={busy} label="Not now" onPress={onNotNow} testID="onboarding-not-now" theme={theme} />
      </>
    );
  }
  if (step === "motion" && !answers.motion) {
    return (
      <>
        <PrimaryButton busy={busy} label="Allow Motion & Fitness" onPress={onAllowMotion} testID="onboarding-motion-allow" theme={theme} />
        <SecondaryButton disabled={busy} label="Not now" onPress={onNotNow} testID="onboarding-not-now" theme={theme} />
      </>
    );
  }
  return <PrimaryButton busy={busy} label="Continue" onPress={onContinue} testID="onboarding-continue" theme={theme} />;
}

function PrimaryButton({ busy = false, label, onPress, testID, theme }: { busy?: boolean; label: string; onPress: () => void; testID: string; theme: MobileTheme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent }, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Text {...mobileTextProps("control")} style={[styles.primaryText, { color: theme.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ disabled, label, onPress, testID, theme }: { disabled: boolean; label: string; onPress: () => void; testID: string; theme: MobileTheme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, { opacity: disabled ? 0.45 : 1 }, pressed ? { backgroundColor: theme.surface } : null]}
      testID={testID}
    >
      <Text {...mobileTextProps("control")} style={[styles.secondaryText, { color: theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

/** Five (for now two) small blocks; finished steps fill in the logo's colours, the newest landing. */
function ProgressBlocks({ done, landed, reduceMotion, theme }: { done: number; landed: OnboardingStep | null; reduceMotion: boolean; theme: MobileTheme }) {
  return (
    <View
      accessibilityLabel={`Setup progress: ${done} of ${ONBOARDING_PROGRESS.length} steps done`}
      accessible
      style={styles.progress}
      testID="onboarding-progress"
    >
      {ONBOARDING_PROGRESS.map((item, index) => (
        <ProgressBlock
          color={blockColorsFor(item.color, theme.mode).fill}
          filled={index < done}
          key={item.step}
          land={landed === item.step && index < done}
          reduceMotion={reduceMotion}
          theme={theme}
        />
      ))}
    </View>
  );
}

function ProgressBlock({ color, filled, land, reduceMotion, theme }: { color: string; filled: boolean; land: boolean; reduceMotion: boolean; theme: MobileTheme }) {
  const offset = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!land) return;
    if (reduceMotion) {
      opacity.value = 0.2;
      opacity.value = withTiming(1, { duration: 160, reduceMotion: ReduceMotion.Never });
      return;
    }
    // The prototype's landing: from 14 points above at 60 %, one small overshoot.
    const spring = { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never };
    offset.value = -14;
    scale.value = 0.6;
    opacity.value = 0.2;
    offset.value = withSpring(0, spring);
    scale.value = withSpring(1, spring);
    opacity.value = withTiming(1, { duration: 160, reduceMotion: ReduceMotion.Never });
  }, [land, offset, opacity, reduceMotion, scale]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: offset.value }, { scale: scale.value }] }));
  return <Reanimated.View style={[styles.progressBlock, { backgroundColor: filled ? color : theme.surfaceMuted }, animated]} />;
}

function StepGlyph({ color, glyph, theme }: { color: DayframePaletteKey; glyph: DayframeGlyph; theme: MobileTheme }) {
  const block = blockColorsFor(color, theme.mode);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.glyph, { backgroundColor: block.fill }]}>
      <DayframeIcon color={block.text} glyph={glyph} size={28} />
    </View>
  );
}

const WELCOME_COLUMNS: { blocks: [DayframePaletteKey, number, string][] }[] = [
  { blocks: [["blue", 2, "Work"], ["red", 1.2, "Gym"], ["sky", 1.4, "Personal"]] },
  { blocks: [["amber", 1.1, "Learning"], ["blue", 2.4, "Work"], ["graphite", 0.8, "Commute"]] },
  { blocks: [["lime", 1.3, "Walk"], ["violet", 1.6, "Client"], ["blue-bold", 1.4, "Sleep"]] }
];

/** The welcome's sample day: the logo's blocks fall into three columns (first paint only). */
function WelcomeDay({ played, reduceMotion, theme }: { played: { current: boolean }; reduceMotion: boolean; theme: MobileTheme }) {
  // Decided once per mount from the screen's flag, so Back to the welcome shows it at rest.
  const [play] = useState(() => !reduceMotion && !played.current);
  useEffect(() => {
    played.current = true;
  }, [played]);
  let index = 0;
  return (
    <View accessibilityLabel="A sample day made of activity blocks" accessible style={styles.day}>
      {WELCOME_COLUMNS.map((column, columnIndex) => (
        <View key={columnIndex} style={styles.dayColumn}>
          {column.blocks.map(([color, weight, name]) => {
            const order = index++;
            return <WelcomeBlock color={color} index={order} key={`${columnIndex}:${name}`} name={name} play={play} theme={theme} weight={weight} />;
          })}
        </View>
      ))}
    </View>
  );
}

function WelcomeBlock({ color, index, name, play, theme, weight }: { color: DayframePaletteKey; index: number; name: string; play: boolean; theme: MobileTheme; weight: number }) {
  const block = blockColorsFor(color, theme.mode);
  const offset = useSharedValue(play ? -260 : 0);
  useEffect(() => {
    if (!play) return;
    offset.value = withDelay(120 + index * 70, withSpring(0, { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never }));
    // Plays once when the welcome first shows.
  }, []);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  return (
    <Reanimated.View style={[styles.dayBlock, { backgroundColor: block.fill, flexGrow: weight }, animated]}>
      <Text {...mobileTextProps("counter")} numberOfLines={1} style={[styles.dayBlockText, { color: block.text }]}>{name}</Text>
    </Reanimated.View>
  );
}

/** What Location suggestions look like in Review (sample). */
function ReviewPreview({ theme }: { theme: MobileTheme }) {
  const rows: [DayframePaletteKey, string, string, string][] = [
    ["graphite", "08:36", "Drive to School", "2 min · 0.8 km"],
    ["amber", "08:38", "School", "9 min"]
  ];
  return (
    <View accessibilityLabel="Example: what you'll see in Review" accessible style={[styles.preview, { backgroundColor: theme.surface }]}>
      <Text {...mobileTextProps("counter")} style={[styles.previewEyebrow, { color: theme.textMuted }]}>WHAT YOU&apos;LL SEE IN REVIEW</Text>
      {rows.map(([color, time, title, meta]) => (
        <View key={title} style={styles.previewRow}>
          <View style={[styles.previewSwatch, { backgroundColor: blockColorsFor(color, theme.mode).fill }]} />
          <Text {...mobileTextProps("metadata")} style={[styles.previewTime, { color: theme.textMuted }]}>{time}</Text>
          <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.previewTitle, { color: theme.textPrimary }]}>{title}</Text>
          <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>{meta}</Text>
        </View>
      ))}
    </View>
  );
}

/** A morning as motion sees it (sample): still, walk, still, drive, still. */
function MotionPreview({ theme }: { theme: MobileTheme }) {
  const segments: [DayframePaletteKey, number, string][] = [["steel", 3, "Still"], ["lime", 2, "Walk"], ["steel", 2, ""], ["graphite", 2.2, "Drive"], ["steel", 2.4, "Still"]];
  return (
    <View accessibilityLabel="Example: a morning as motion sees it, still, walking, still, driving, still" accessible style={[styles.preview, { backgroundColor: theme.surface }]}>
      <Text {...mobileTextProps("counter")} style={[styles.previewEyebrow, { color: theme.textMuted }]}>THIS MORNING, AS MOTION SEES IT</Text>
      <View style={styles.motionBar}>
        {segments.map(([color, weight, label], index) => {
          const block = blockColorsFor(color, theme.mode);
          return (
            <View key={index} style={[styles.motionSegment, { backgroundColor: block.fill, flexGrow: weight }]}>
              {label ? <Text {...mobileTextProps("counter")} numberOfLines={1} style={[styles.motionLabel, { color: block.text }]}>{label}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DoneSummary({ answers, theme }: { answers: OnboardingAnswers; theme: MobileTheme }) {
  const glyphs: Record<string, [DayframeGlyph, DayframePaletteKey]> = {
    location: [DAYFRAME_APP_ICONS.places, "red"],
    motion: ["footprints", "amber"]
  };
  return (
    <View style={[styles.summary, { backgroundColor: theme.surface }]} testID="onboarding-summary">
      {onboardingSummary(answers).map((row, index) => {
        const [glyph, color] = glyphs[row.key];
        const block = blockColorsFor(color, theme.mode);
        return (
          <View
            accessibilityLabel={[row.title, row.state === "on" ? "on" : row.state === "later" ? "later" : null, row.detail].filter(Boolean).join(", ")}
            accessible
            key={row.key}
            style={[styles.summaryRow, index > 0 ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null]}
          >
            <View style={[styles.summaryGlyph, { backgroundColor: block.fill }]}>
              <DayframeIcon color={block.text} glyph={glyph} size={18} />
            </View>
            <View style={styles.summaryText}>
              <Text {...mobileTextProps("itemTitle")} style={[styles.summaryTitle, { color: theme.textPrimary }]}>{row.title}</Text>
              <Text {...mobileTextProps("metadata")} style={{ color: theme.textMuted }}>{row.detail}</Text>
            </View>
            {row.state === "none" ? null : (
              <Text {...mobileTextProps("control")} style={[styles.summaryState, { color: row.state === "on" ? theme.success : theme.textMuted }]}>
                {row.state === "on" ? "On" : "Later"}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function BackArrow({ color }: { color: string }) {
  // The app's "next" chevron, turned around.
  return (
    <View style={{ transform: [{ rotate: "180deg" }] }}>
      <DayframeIcon color={color} glyph={DAYFRAME_APP_ICONS.next} size={20} />
    </View>
  );
}

function stepEntering(direction: 1 | -1) {
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ translateX: direction * STEP_SLIDE }] },
      animations: {
        opacity: withTiming(1, { duration: 180 }),
        transform: [{ translateX: withSpring(0, BLOCKS_SPRING.sheet) }]
      }
    };
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: { alignItems: "center", flexDirection: "row", minHeight: 56, paddingHorizontal: 16 },
  topSide: { minWidth: 72 },
  topRight: { alignItems: "flex-end" },
  back: { alignItems: "center", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  later: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 64, paddingHorizontal: 6 },
  laterText: { fontSize: 15, fontWeight: "600" },
  progress: { alignItems: "center", flex: 1, flexDirection: "row", gap: 6, justifyContent: "center" },
  progressBlock: { borderRadius: 5, height: 14, width: 22 },
  body: { flex: 1 },
  bodyContent: { paddingBottom: 24, paddingHorizontal: 20, paddingTop: 8 },
  step: { gap: 16 },
  glyph: { alignItems: "center", borderRadius: 18, height: 64, justifyContent: "center", marginTop: 8, width: 64 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 30, lineHeight: 34 },
  lede: { fontSize: 17, lineHeight: 24 },
  bullet: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 21 },
  privacy: { alignItems: "flex-start", borderRadius: 14, flexDirection: "row", gap: 10, padding: 12 },
  privacyText: { flex: 1, lineHeight: 18 },
  result: { alignItems: "flex-start", borderRadius: 16, flexDirection: "row", gap: 10, padding: 14 },
  resultText: { flex: 1, fontSize: 15, lineHeight: 21 },
  actions: { gap: 8, paddingBottom: 12, paddingHorizontal: 20, paddingTop: 8 },
  primary: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 54, paddingHorizontal: 20 },
  primaryText: { fontSize: 17, fontWeight: "700" },
  secondary: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, justifyContent: "center", minHeight: 48 },
  secondaryText: { fontSize: 16, fontWeight: "600" },
  note: { textAlign: "center" },
  pressed: { opacity: 0.7 },
  day: { flexDirection: "row", gap: 8, height: 240, marginBottom: 8, marginTop: 4, overflow: "hidden" },
  dayColumn: { flex: 1, gap: 8 },
  dayBlock: { borderRadius: 14, justifyContent: "flex-end", padding: 10 },
  dayBlockText: { fontSize: 12, fontWeight: "700" },
  preview: { borderRadius: 18, gap: 10, padding: 14 },
  previewEyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9 },
  previewRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  previewSwatch: { borderRadius: 6, height: 24, width: 24 },
  previewTime: { fontVariant: ["tabular-nums"], width: 44 },
  previewTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  motionBar: { borderRadius: 10, flexDirection: "row", gap: 3, height: 36, overflow: "hidden" },
  motionSegment: { borderRadius: 6, justifyContent: "center", paddingHorizontal: 6 },
  motionLabel: { fontSize: 11, fontWeight: "700" },
  summary: { borderRadius: 18, overflow: "hidden" },
  summaryRow: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  summaryGlyph: { alignItems: "center", borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
  summaryText: { flex: 1, minWidth: 0 },
  summaryTitle: { fontSize: 15, fontWeight: "600" },
  summaryState: { fontSize: 15, fontWeight: "700" }
});
