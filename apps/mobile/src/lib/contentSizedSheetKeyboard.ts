import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from "react-native";
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import {
  contentSizedSheetKeyboardLayout,
  keyboardInsetFromScreenY,
  keyboardLiftAnimationDuration
} from "./editSheetKeyboard";

/** The iOS keyboard curve, as the other keyboard-following surfaces approximate it. */
const KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.77);

/**
 * The keyboard for a content-sized `SwipeDismissSheet` (Settings › Apple Health type sheet; Codex
 * r1–r2 on #355). The keyboard is the sheet's bottom occlusion boundary: a keyboard-high space at
 * the sheet's foot (`keyboardSpaceStyle`) grows and shrinks on the keyboard's own duration (Reduce
 * Motion or an interactive frame: at once), so the rows ride above the keyboard inside the sheet's
 * 85 % cap. The sheet's translation stays with `SwipeDismissSheet`, which gets `keyboardInset` for
 * its keyboard hand-off: a drag that starts with the keyboard up waits until that inset is zero.
 *
 * - `keyboardInset` rises as soon as a keyboard frame arrives, and drops to zero only once the
 *   keyboard has gone (`keyboardDidHide`) and the space has finished shrinking, so a drag never
 *   resumes while keyboard-driven layout is still moving.
 * - Each "did" event completes only the transition the latest "will" event started (Codex r3–r4 on
 *   #355): a `keyboardDidHide` while the latest will-event was a show, or a `keyboardDidShow` while
 *   it was a hide, is stale and ignored, also after the newer transition has settled. A
 *   `keyboardDidShow` before any will-event (a restored keyboard) still counts.
 * - `onReveal` runs once the sheet's layout has settled with the keyboard up: when the animated
 *   space finishes, or — for an immediate update — on the scroll view's next layout
 *   (`onScrollLayout`) and two frames later, whichever lands; also after `keyboardDidShow` and
 *   `revealWhenSettled` (a field focused with the keyboard already up).
 */
export function useContentSizedSheetKeyboard({
  bottomInset,
  onReveal,
  reduceMotion,
  windowHeight
}: {
  bottomInset: number;
  onReveal: () => void;
  reduceMotion: boolean;
  windowHeight: number;
}) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const layout = contentSizedSheetKeyboardLayout({ bottomInset, keyboardInset: 0, windowHeight });
  const keyboardSpace = useSharedValue(0);
  const keyboardSpaceStyle = useAnimatedStyle(() => ({ height: keyboardSpace.value }));
  const target = useRef(0);
  // While the keyboard is leaving: whether it has gone, and whether the space has settled.
  const leaving = useRef({ keyboardGone: true, spaceSettled: true });
  const pendingReveal = useRef(false);
  // The direction of the latest "will" event (null before any); "did" events only complete it.
  const latestWill = useRef<"show" | "hide" | null>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  const reveal = useCallback(() => {
    if (target.current > 0) onRevealRef.current();
  }, []);

  const revealWhenSettled = useCallback(() => {
    if (target.current <= 0) return;
    pendingReveal.current = true;
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }, [reveal]);

  const onScrollLayout = useCallback(() => {
    if (!pendingReveal.current) return;
    pendingReveal.current = false;
    reveal();
  }, [reveal]);

  const releaseIfGone = useCallback(() => {
    if (target.current === 0 && leaving.current.keyboardGone && leaving.current.spaceSettled) {
      setKeyboardInset(0);
    }
  }, []);

  const spaceSettled = useCallback((settledInset: number) => {
    if (settledInset !== target.current) return;
    if (settledInset > 0) {
      reveal();
      return;
    }
    leaving.current.spaceSettled = true;
    releaseIfGone();
  }, [releaseIfGone, reveal]);

  useEffect(() => {
    const follow = (event: KeyboardEvent, nextInset: number, phase: "will" | "didShow" | "didHide") => {
      if (phase === "didHide") {
        // The completion of a hide that a newer show has replaced.
        if (latestWill.current === "show") return;
        leaving.current.keyboardGone = true;
      } else if (phase === "didShow") {
        // The completion of a show that a newer hide has replaced.
        if (latestWill.current === "hide") return;
      } else {
        latestWill.current = nextInset > 0 ? "show" : "hide";
      }
      if (nextInset > 0) {
        // The hand-off holds a drag from the first keyboard frame.
        leaving.current = { keyboardGone: false, spaceSettled: false };
        setKeyboardInset(nextInset);
      }
      if (nextInset === target.current) {
        if (nextInset > 0 && phase === "didShow") revealWhenSettled();
        if (nextInset === 0) releaseIfGone();
        return;
      }
      target.current = nextInset;
      if (nextInset === 0) {
        pendingReveal.current = false;
        leaving.current.spaceSettled = false;
      }
      const space = contentSizedSheetKeyboardLayout({ bottomInset, keyboardInset: nextInset, windowHeight }).keyboardSpace;
      cancelAnimation(keyboardSpace);
      const duration = keyboardLiftAnimationDuration({ eventDuration: event.duration, platform: Platform.OS });
      if (reduceMotion || duration === null) {
        keyboardSpace.value = space;
        if (nextInset > 0) revealWhenSettled();
        else spaceSettled(0);
        return;
      }
      keyboardSpace.value = withTiming(space, { duration, easing: KEYBOARD_EASING }, (finished) => {
        if (finished) runOnJS(spaceSettled)(nextInset);
      });
    };
    const frame = (phase: "will" | "didShow") => (event: KeyboardEvent) => follow(event, keyboardInsetFromScreenY({
      keyboardScreenY: event.endCoordinates.screenY,
      screenHeight: Dimensions.get("screen").height,
      windowHeight: Dimensions.get("window").height
    }), phase);
    const subscriptions = [
      Keyboard.addListener("keyboardWillChangeFrame", frame("will")),
      Keyboard.addListener("keyboardWillShow", frame("will")),
      // Some restored keyboards skip the frame change; didShow also marks the keyboard settled.
      Keyboard.addListener("keyboardDidShow", frame("didShow")),
      Keyboard.addListener("keyboardWillHide", (event) => follow(event, 0, "will")),
      Keyboard.addListener("keyboardDidHide", (event) => follow(event, 0, "didHide"))
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [bottomInset, keyboardSpace, reduceMotion, releaseIfGone, revealWhenSettled, spaceSettled, windowHeight]);

  return {
    contentPaddingBottom: layout.contentPaddingBottom,
    keyboardInset,
    keyboardSpaceStyle,
    onScrollLayout,
    revealWhenSettled,
    sheetMaxHeight: layout.sheetMaxHeight
  };
}
