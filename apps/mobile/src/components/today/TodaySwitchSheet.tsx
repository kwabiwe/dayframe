import { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS, searchHistoricalSuggestionCandidates, type RecentActivitySuggestionCandidate } from "@dayframe/shared";
import type { MobileStyles, MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_TEXT_CAP, mobileTextProps } from "../../lib/mobileTypography";
import { switchRecentMeta, type SwitchRecent } from "../../lib/todaySwitch";
import { DayframeIcon } from "../icons/DayframeIcon";
import { DIVIDER_INSET_PAST_BLOCK, InsetDivider } from "../InsetDivider";
import { BlocksSheetHead } from "../blocks/BlocksSheetHead";
import { BottomSheetShell } from "../sheets/BottomSheetShell";
import { ActivityBlockMark } from "./ActivityBlockMark";

type SwitchChoice = {
  id: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  tagNames: string[];
  meta: string;
};

const BLOCK_MARK_SIZE = 34;
const ROW_MIN_HEIGHT = 56;

function choiceIdentity(description: string, categoryId: string | null, tags: string[]) {
  return JSON.stringify([
    description.trim().replace(/\s+/g, " ").toLocaleLowerCase(),
    categoryId,
    tags.map((tag) => tag.toLocaleLowerCase()).sort()
  ]);
}

export function TodaySwitchSheet({
  activityIconFor,
  candidates,
  nowMs,
  onClose,
  onCommit,
  recents,
  reduceMotion,
  running,
  styles: shared,
  theme,
}: {
  activityIconFor: (categoryId: string | null | undefined) => string | null;
  candidates: RecentActivitySuggestionCandidate[];
  nowMs: number;
  onClose: () => void;
  onCommit: (categoryId: string | null, description: string, tagNames?: string[]) => void;
  /** Recents and the candidate pool are snapshots from the moment the sheet opened. */
  recents: readonly SwitchRecent[];
  reduceMotion: boolean;
  running: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const [description, setDescription] = useState("");
  const [selection, setSelection] = useState<SwitchChoice | null>(null);
  const commitRef = useRef<(() => void) | null>(null);
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.max(ROW_MIN_HEIGHT, Math.ceil(
    20 * Math.min(fontScale, MOBILE_TEXT_CAP.itemTitle) +
    18 * Math.min(fontScale, MOBILE_TEXT_CAP.metadata) + 18
  ));
  const query = description.trim();
  const limit = Math.max(3, recents.length);
  const title = running ? "Switch block" : "Start a block";
  const action = running
    ? selection ? "Switch to this block" : "Switch to new block"
    : selection ? "Start this block" : "Start new block";
  const pool = useMemo(() => {
    const existing = new Set(candidates.map((item) => choiceIdentity(item.description, item.categoryId, item.tagNames)));
    const visibleRecents = recents.flatMap(({ entry, title }): RecentActivitySuggestionCandidate[] => {
      const tagNames = entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? [];
      if (existing.has(choiceIdentity(title, entry.categoryId, tagNames))) return [];
      return [{
        key: entry.id,
        categoryId: entry.categoryId,
        categoryName: entry.categoryName ?? null,
        categoryColor: entry.categoryColor ?? null,
        description: title,
        lastSeenAt: entry.stoppedAt ?? entry.startedAt,
        learningTier: 1,
        score: 0,
        section: "recent",
        useCount: 1,
        totalSeconds: entry.durationSeconds ?? 0,
        tagNames,
      }];
    });
    return [...candidates, ...visibleRecents];
  }, [candidates, recents]);
  const suggestions = useMemo(() => searchHistoricalSuggestionCandidates(pool, query, { limit }), [limit, pool, query]);
  const rows: SwitchChoice[] = selection ? [selection] : query ? suggestions.map((suggestion) => ({
    id: suggestion.key,
    description: suggestion.description,
    categoryId: suggestion.categoryId,
    categoryName: suggestion.categoryName,
    categoryColor: suggestion.categoryColor,
    tagNames: suggestion.tagNames,
    meta: [suggestion.categoryName, ...suggestion.tagNames.map((tag) => `#${tag}`)].filter(Boolean).join(" · ")
  })) : recents.map(({ entry, title }) => ({
    id: entry.id,
    description: title,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName ?? null,
    categoryColor: entry.categoryColor ?? null,
    tagNames: entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? [],
    meta: switchRecentMeta(entry, nowMs)
  }));

  return (
    <BottomSheetShell
      action={action}
      actionTone="accent"
      automaticallyAdjustKeyboardInsets={false}
      commitRef={commitRef}
      disabled={!query}
      fixedHeader={(
        <View style={styles.header}>
          <BlocksSheetHead eyebrow="" theme={theme} title={title} />
          <View style={[styles.field, { backgroundColor: theme.surfaceMuted }]}>
            <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.search} size={18} />
            <TextInput
              {...mobileTextProps("input")}
              accessibilityLabel="New block description"
              onChangeText={(text) => {
                setSelection(null);
                setDescription(text);
              }}
              onSubmitEditing={() => commitRef.current?.()}
              placeholder="What are you working on?"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="go"
              style={[shared.activeEditDescriptionInput, styles.description, { color: theme.textPrimary }]}
              testID="today-switch-description"
              value={description}
            />
          </View>
        </View>
      )}
      onApply={() => onCommit(selection?.categoryId ?? null, query, selection?.tagNames)}
      onDismissStart={Keyboard.dismiss}
      onDismissed={onClose}
      presentationId={1}
      reduceMotion={reduceMotion}
      rootHosted={false}
      testID="today-switch-sheet"
      theme={theme}
      title={title}
    >
      <View>
        <Text {...mobileTextProps("metadata")} accessibilityRole="header" style={[styles.resultsTitle, { color: theme.textSecondary }]}>
          {selection ? "Selected block" : query ? "Suggestions" : "Recent blocks"}
        </Text>
        <View style={{ minHeight: limit * rowHeight }} testID="today-switch-results">
          {rows.length ? (
          <View style={[styles.results, { backgroundColor: theme.surface }]} testID="today-switch-card">
            {rows.map((choice, index) => (
              <Pressable
                accessibilityLabel={[choice.description, choice.meta].filter(Boolean).join(", ")}
                accessibilityRole="button"
                accessibilityState={{ selected: selection?.id === choice.id }}
                key={choice.id}
                onPress={() => {
                  setDescription(choice.description);
                  setSelection(choice);
                }}
                style={({ pressed }) => [styles.row, { minHeight: rowHeight }, pressed ? styles.pressed : null]}
                testID={`today-switch-${choice.id}`}
              >
                <ActivityBlockMark
                  categoryColor={choice.categoryColor ?? choice.categoryId}
                  categoryIcon={activityIconFor(choice.categoryId)}
                  categoryName={choice.categoryName}
                  entryId={choice.id}
                  height={BLOCK_MARK_SIZE}
                  landing={null}
                  reduceMotion={reduceMotion}
                  theme={theme}
                  width={BLOCK_MARK_SIZE}
                />
                <View style={styles.text}>
                  <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                    {choice.description}
                  </Text>
                  {choice.meta ? (
                    <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {choice.meta}
                    </Text>
                  ) : null}
                </View>
                <DayframeIcon color={theme.textSecondary} glyph={selection ? DAYFRAME_APP_ICONS.done : DAYFRAME_APP_ICONS.next} size={17} />
                {index > 0 ? <InsetDivider color={theme.border} edge="top" end={14} start={DIVIDER_INSET_PAST_BLOCK} /> : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <Text {...mobileTextProps("body")} style={[styles.empty, { color: theme.textSecondary }]}>
            {query ? "No matching blocks" : "Finished blocks with a description show up here."}
          </Text>
          )}
        </View>
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 6, gap: 6 },
  field: { alignItems: "center", borderRadius: 16, flexDirection: "row", paddingHorizontal: 12, gap: 8 },
  description: { backgroundColor: "transparent", flex: 1, minWidth: 0, paddingHorizontal: 0 },
  resultsTitle: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  results: { borderRadius: DAYFRAME_BLOCKS.radius.phoneCard, overflow: "hidden" },
  row: { alignItems: "center", flexDirection: "row", gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  empty: { fontSize: 15, paddingVertical: 10 },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  rowMeta: { fontSize: 13, lineHeight: 18 },
});
