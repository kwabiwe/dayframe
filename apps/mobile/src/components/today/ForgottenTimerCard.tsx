import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import Reanimated from "react-native-reanimated";
import { TimeWheelPanel } from "@/components/TimeWheelPanel";
import { forgottenTimerAvailable, respondToForgottenTimer } from "@/lib/forgottenTimer";
import { formatLocaleDate } from "@/lib/localeDateFormat";
import type { MobileAccountOwner } from "@/lib/mobileAccount";
import type { MobileTheme } from "@/lib/mobileTheme";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "@/lib/motion";

export function ForgottenTimerCard({ entryId, startedAt, owner, refresh, visible, reduceMotion, theme, clockFormat }: {
  entryId: string;
  startedAt: string;
  owner: MobileAccountOwner;
  refresh: () => void;
  visible: boolean;
  reduceMotion: boolean;
  theme: MobileTheme;
  clockFormat: "12h" | "24h";
}) {
  const [available, setAvailable] = useState(false);
  const [draft, setDraft] = useState<{ value: number; revision: number; maximum: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const command = useRef<{ action: string; id: string } | null>(null);
  const startMs = Date.parse(startedAt);
  const { workspaceId, userId } = owner;

  useEffect(() => {
    const request = new AbortController();
    if (visible) {
      void forgottenTimerAvailable({ workspaceId, userId }, entryId, request.signal)
        .then((value) => { if (!request.signal.aborted) setAvailable(value); })
        .catch(() => undefined);
    }
    return () => request.abort();
  }, [entryId, startedAt, workspaceId, userId, visible]);

  async function respond(action: "keep" | "end" | "stop") {
    if (inFlight.current || (action === "end" && !draft)) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const actionKey = action === "end" ? `end:${draft!.value}` : action;
    if (command.current?.action !== actionKey) command.current = { action: actionKey, id: randomUUID() };
    try {
      const result = await respondToForgottenTimer(owner, entryId, action === "keep" ? { action } :
        action === "stop" ? { action, commandId: command.current.id } :
          { action, commandId: command.current.id, stoppedAt: new Date(draft!.value).toISOString() });
      setAvailable(false);
      if (action !== "keep" || result === "changed") refresh();
    } catch {
      setNotice("Couldn’t save this response. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!visible || !available) return null;

  const actionButton = (title: string, press: () => void, disabled = busy) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={press}
      style={[styles.button, { backgroundColor: theme.surfaceMuted, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ color: theme.textPrimary, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
  const moveDay = (days: number) => {
    if (!draft) return;
    const shifted = new Date(draft.value);
    shifted.setDate(shifted.getDate() + days);
    setDraft({ ...draft, value: Math.min(draft.maximum, Math.max(startMs + 60_000, shifted.getTime())), revision: draft.revision + 1 });
  };

  return (
    <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}
      layout={localLayoutTransition(reduceMotion)} style={[styles.card, { backgroundColor: theme.surface }]} testID="forgotten-timer">
      <Text accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>Running for eight hours</Text>
      <View style={styles.actions}>
        {actionButton("Set end time", () => {
          const maximum = Date.now();
          setDraft({ value: maximum, maximum, revision: 0 });
        })}
        {actionButton("Stop now", () => void respond("stop"))}
        {actionButton("Keep running", () => void respond("keep"))}
      </View>
      {draft ? (
        <View style={styles.picker}>
          <View style={styles.actions}>
            {actionButton("Previous day", () => moveDay(-1), busy || new Date(draft.value).toDateString() === new Date(startMs).toDateString())}
            <Text style={{ color: theme.textPrimary }}>{formatLocaleDate(new Date(draft.value), { day: "numeric", month: "short", year: "numeric" })}</Text>
            {actionButton("Next day", () => moveDay(1), busy || new Date(draft.value).toDateString() === new Date(draft.maximum).toDateString())}
          </View>
          <TimeWheelPanel
            model={{ modelVersion: 1, presentationId: 1, revision: draft.revision, minuteInterval: 1,
              valueMs: draft.value, minimumMs: startMs + 60_000, maximumMs: draft.maximum,
              clockFormat, colorScheme: theme.mode === "dark" ? "dark" : "light" }}
            notch={null} onTimeChange={(change) => {
              if (!busy && change.revision === draft.revision) setDraft({ ...draft, value: change.valueMs });
            }} reduceMotion={reduceMotion} testIDPrefix="forgotten-end-time" theme={theme} wheelHeight={150}
          />
          <View style={styles.actions}>
            {actionButton("Cancel", () => setDraft(null))}
            {actionButton("Save end time", () => void respond("end"))}
          </View>
        </View>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>{notice}</Text> : null}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, gap: 10 },
  title: { fontSize: 18, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  picker: { gap: 8 },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 22 }
});
