import { InsetDivider } from "../InsetDivider";
import { useEffect, useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { DATE_SHEET_HEAD_MIN_HEIGHT, DateSheet } from "@/components/DateSheet";
import { BottomSheetShell } from "@/components/sheets/BottomSheetShell";
import { CalendarGlyph } from "@/components/calendar/DatePickerCalendar";
import type { MobileTheme } from "@/lib/mobileTheme";
import {
  openReportDateDraft,
  reportDraftHighlight,
  reportDraftResult,
  selectReportDraftDay,
} from "@/lib/reportDateDraft";
import {
  formatLocalDateKey,
  parseLocalDate,
  type ReportRangeChoice,
  type ReportPreset,
} from "@/lib/reportsRanges";
import {
  reportSelectionIncludes,
  toggleReportFilterDraftKey,
  type ReportCategoryOption,
  type ReportFilterDraft,
} from "@/lib/reportsSelection";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";
import { MOBILE_DISPLAY_FONT } from "../../lib/mobileTypography";
import {
  DAYFRAME_BLOCKS, REPORT_DESCRIPTION_MAX, REPORT_FACET_MAX, contrastRatio,
} from "@dayframe/shared";
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { localPresenceExiting, MOBILE_MOTION } from "@/lib/motion";
import { reportFacetChips, type MobileReportFacets, type ReportFacetOption, type ReportFacetOptions } from "../../lib/reportsFacets";
import { ActivityIcon, DayframeIcon } from "../icons/DayframeIcon";
import { playHaptic } from "../../lib/haptics";
import { reportFilterApplyLabel, reportFilterSections } from "../../lib/reportsBlocks";
import { formatLocaleDate } from "../../lib/localeDateFormat";

export function ReportFiltersSheet({
  rootHosted = false,
  presentationId,
  draft,
  options,
  facets,
  facetOptions,
  onChangeFacets,
  theme,
  reduceMotion,
  onChange,
  onApply,
  onDismissed,
}: {
  rootHosted?: boolean;
  presentationId: number;
  draft: ReportFilterDraft;
  options: ReportCategoryOption[];
  facets: MobileReportFacets;
  facetOptions: ReportFacetOptions;
  onChangeFacets: (facets: MobileReportFacets) => void;
  theme: MobileTheme;
  reduceMotion: boolean;
  onChange: (draft: ReportFilterDraft) => void;
  onApply: () => boolean | void;
  onDismissed: (presentationId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [moreFilters, setMoreFilters] = useState(Boolean(facets.places?.length || facets.description));
  const [hasAdvancedHeight, setHasAdvancedHeight] = useState(!moreFilters);
  const advancedHeight = useSharedValue(0);
  const naturalAdvancedHeight = reduceMotion || (!hasAdvancedHeight && moreFilters);
  const revealStyle = useAnimatedStyle(() => ({ height: naturalAdvancedHeight ? undefined : advancedHeight.value }));
  useEffect(() => {
    if (!moreFilters) advancedHeight.value = reduceMotion ? 0
      : withTiming(0, { duration: MOBILE_MOTION.sheet, easing: Easing.out(Easing.cubic) });
  }, [advancedHeight, moreFilters, reduceMotion]);
  const chips = reportFacetChips(facets, facetOptions);
  const sections = reportFilterSections(options, search);
  const link = (label: "All" | "None") => (
    <Pressable
      accessibilityLabel={label === "All" ? "Select all activities" : "Select no activities"}
      accessibilityRole="button"
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={() => {
        playHaptic("tick");
        onChange({ mode: label === "All" ? "all" : "none", universe: draft.universe });
      }}
      style={s.headLink}
      testID={`report-filter-${label.toLowerCase()}`}
    >
      <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.control} style={[s.headLinkText, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <BottomSheetShell
      testID="report-filter-sheet"
      rootHosted={rootHosted}
      title="Filters"
      presentationId={presentationId}
      theme={theme}
      reduceMotion={reduceMotion}
      action={chips.length ? "Apply filters" : reportFilterApplyLabel(draft)}
      onApply={onApply}
      onDismissStart={Keyboard.dismiss}
      secondaryAction={chips.length || draft.mode !== "all" ? {
        label: "Clear",
        testID: "report-filter-clear",
        onPress: () => {
          onChange({ mode: "all", universe: draft.universe });
          onChangeFacets({});
        },
      } : undefined}
      onDismissed={onDismissed}
      fixedHeader={
        <View style={s.filterHead}>
          <View style={s.filterTitleRow}>
            <View style={s.filterTitles}>
              <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.small} style={[s.eyebrow, { color: theme.textSecondary }]}>
                REPORTS
              </Text>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
                style={[s.filterTitle, { color: theme.textPrimary }]}
              >
                Filters
              </Text>
            </View>
            {link("All")}
            <Text style={{ color: theme.textMuted }}>·</Text>
            {link("None")}
          </View>
          <TextInput
            testID="report-filter-search"
            maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
            accessibilityLabel="Search activities"
            value={search}
            onChangeText={setSearch}
            placeholder="Search activities"
            placeholderTextColor={theme.textMuted}
            style={[
              s.search,
              { backgroundColor: theme.surfaceInset, color: theme.textPrimary },
            ]}
          />
        </View>
      }
    >
      <View style={s.facets}>
        {facetOptions.tags.length ? (
          <View style={s.filterSection}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
              style={[s.eyebrow, { color: theme.textSecondary }]}>TAGS</Text>
            {facetOptions.tags.length > 12 ? (
              <TextInput accessibilityLabel="Search tags" placeholder="Search tags"
                value={tagSearch} onChangeText={setTagSearch} placeholderTextColor={theme.textMuted}
                maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
                style={[s.search, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]} />
            ) : null}
            <FacetChoices
              kind="tags"
              options={facetOptions.tags.filter(({ label }) => label.toLowerCase().includes(tagSearch.trim().toLowerCase()))}
              selected={facets.tags ?? []} theme={theme}
              onToggle={(id) => onChangeFacets({ ...facets, tags: toggleFacet(facets.tags, id) })}
            />
          </View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreFilters }}
          onPress={() => setMoreFilters((value) => !value)}
          style={[s.disclosure, { backgroundColor: theme.surfaceInset }]} testID="report-filter-more">
          <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.control} style={[s.optionText, { color: theme.textPrimary }]}>More filters</Text>
          <View style={{ transform: [{ rotate: moreFilters ? "-90deg" : "90deg" }] }}>
            <DayframeIcon color={theme.textSecondary} glyph="chevron-right" size={16} />
          </View>
        </Pressable>
        <Reanimated.View style={[s.advancedClip, revealStyle]}>
        {moreFilters ? (
          <Reanimated.View
            collapsable={false}
            exiting={localPresenceExiting(reduceMotion)}
            style={[s.facets, naturalAdvancedHeight ? null : s.advancedMeasure]}
            onLayout={({ nativeEvent }) => {
              const measured = nativeEvent.layout.height;
              advancedHeight.value = naturalAdvancedHeight ? measured
                : withTiming(measured, { duration: MOBILE_MOTION.sheet, easing: Easing.out(Easing.cubic) });
              if (!hasAdvancedHeight) setHasAdvancedHeight(true);
            }}>

            <Text accessibilityRole="header" maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
              style={[s.eyebrow, { color: theme.textSecondary }]}>PLACES</Text>
            <FacetChoices kind="places" options={facetOptions.places} selected={facets.places ?? []}
              theme={theme} onToggle={(id) => onChangeFacets({ ...facets, places: toggleFacet(facets.places, id) })} />
            <TextInput accessibilityLabel="Description contains" testID="report-filter-description"
              maxLength={REPORT_DESCRIPTION_MAX} maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              onChangeText={(description) => onChangeFacets({ ...facets, description })}
              placeholder="Description contains" placeholderTextColor={theme.textMuted} value={facets.description ?? ""}
              style={[s.search, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]} />
          </Reanimated.View>
        ) : null}
        </Reanimated.View>
      </View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
        style={[s.eyebrow, { color: theme.textSecondary }]}>ACTIVITIES</Text>
      {sections.map((section) => (
        <View key={section.key} style={s.filterSection}>
          {section.title ? (
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
              style={[s.eyebrow, { color: theme.textSecondary }]}
            >
              {section.title.toUpperCase()}
            </Text>
          ) : null}
          {/* Each section's rows sit in one rounded card (UIA-010). */}
          {section.rows.length ? (
          <View style={[s.optionCard, { backgroundColor: theme.surfaceInset }]}>
          {section.rows.map((option, index) => (
            <Option
              divider={index > 0}
              key={option.key}
              label={
                option.isUnavailable
                  ? `${option.name} (not currently available)`
                  : option.name
              }
              checked={reportSelectionIncludes(draft, option.key)}
              theme={theme}
              option={option}
              onPress={() => {
                playHaptic("tick");
                onChange(toggleReportFilterDraftKey(draft, option.key));
              }}
            />
          ))}
          </View>
          ) : null}
        </View>
      ))}
      {sections.every((section) => section.rows.length === 0) ? (
        <Text style={{ color: theme.textSecondary }}>No activity called “{search.trim()}”.</Text>
      ) : null}
    </BottomSheetShell>
  );
}

function toggleFacet<Id extends string>(values: readonly Id[] = [], id: Id) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function FacetChoices<Id extends string>({ kind, options, selected, onToggle, theme }: {
  kind: string;
  options: Array<ReportFacetOption & { id: Id }>;
  selected: readonly Id[];
  onToggle: (id: Id) => void;
  theme: MobileTheme;
}) {
  return (
    <View style={s.facetChips}>
      {options.map(({ id, label }) => {
        const checked = selected.includes(id);
        const disabled = !checked && selected.length >= REPORT_FACET_MAX;
        return (
          <Pressable key={id} accessibilityRole="checkbox" accessibilityLabel={label}
            accessibilityState={{ checked, disabled }} disabled={disabled}
            testID={`report-filter-${kind}-${id}`}
            onPress={() => { playHaptic("tick"); onToggle(id); }}
            style={[s.facetChip, { backgroundColor: checked ? theme.textPrimary : theme.surfaceInset, opacity: disabled ? 0.5 : 1 }]}>
            {checked ? <DayframeIcon color={theme.background} glyph="check" size={14} /> : null}
            <Text numberOfLines={2} maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              style={[s.headLinkText, { color: checked ? theme.background : theme.textPrimary }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The measured on-block colour (white or deep ink) for a solid activity block, theme text otherwise. */
function onBlockColor(fill: string, fallback: string) {
  try {
    const { white, ink } = DAYFRAME_BLOCKS.onBlock;
    return contrastRatio(fill, white) >= contrastRatio(fill, ink) ? white : ink;
  } catch {
    return fallback;
  }
}

function Option({
  divider = false,
  label,
  checked,
  theme,
  option,
  onPress,
}: {
  divider?: boolean;
  label: string;
  checked: boolean;
  theme: MobileTheme;
  option: ReportCategoryOption;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={s.option}
    >
      <View style={[s.optionBlock, { backgroundColor: option.color }]}>
        {option.isUncategorized || option.isUnavailable ? null : (
          <ActivityIcon color={onBlockColor(option.color, theme.textPrimary)} icon={option.icon} name={option.name} size={16} />
        )}
      </View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={REPORT_TEXT_CAP.name}
        style={[s.optionText, { color: theme.textPrimary }]}
      >
        {label}
      </Text>
      <View
        style={[
          s.check,
          // A neutral check (UIA-010): coral marks live time and the one primary action.
          checked
            ? { backgroundColor: theme.textPrimary, borderColor: theme.textPrimary }
            : { borderColor: theme.borderStrong },
        ]}
      >
        {checked ? <CalendarGlyph kind="tick" color={theme.background} /> : null}
      </View>
      {divider ? <InsetDivider color={theme.border} edge="top" paddedBy="src/components/reports/ReportSheets.tsx:optionCard" start={46} /> : null}
    </Pressable>
  );
}

export const REPORT_DATE_HEAD_MIN_HEIGHT = DATE_SHEET_HEAD_MIN_HEIGHT;

/** Reports' range picker: the shared `DateSheet` in range mode with the Today · Week · Month · Year presets. */
export function ReportDateSheet({
  rootHosted = false,
  presentationId,
  initial,
  nowMs,
  theme,
  reduceMotion,
  onApply,
  onDismissed,
}: {
  rootHosted?: boolean;
  presentationId: number;
  initial: ReportRangeChoice;
  nowMs: number;
  theme: MobileTheme;
  /** The device zone its "today" and labels are read in: a change re-renders the open picker. */
  timeZoneId?: string;
  reduceMotion: boolean;
  onApply: (range: ReportRangeChoice) => boolean | void;
  onDismissed: (presentationId: number) => void;
}) {
  const [draft, setDraft] = useState(() => openReportDateDraft(initial, nowMs));
  const result = reportDraftResult(draft, nowMs);
  const highlight = reportDraftHighlight(draft, nowMs);
  const readable = (key: string) =>
    formatLocaleDate(parseLocalDate(key)!, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const rangeCaption =
    draft.choice && highlight.start && highlight.end
      ? `${readable(highlight.start)} – ${readable(highlight.end)}`
      : "Choose the end date";
  const todayKey = formatLocalDateKey(new Date(nowMs));
  return (
    <DateSheet
      rootHosted={rootHosted}
      presentationId={presentationId}
      theme={theme}
      reduceMotion={reduceMotion}
      eyebrow="REPORTS"
      title="Choose dates"
      accessibilityTitle="Choose report dates"
      segments={(["today", "week", "month", "year"] as ReportPreset[]).map((preset) => ({
        key: preset,
        label: preset[0].toUpperCase() + preset.slice(1),
        selected: draft.choice === preset,
        onPress: () => setDraft(openReportDateDraft(preset, nowMs)),
      }))}
      caption={rangeCaption}
      month={draft.displayedMonth}
      onMonthChange={(displayedMonth) => setDraft((current) => ({ ...current, displayedMonth }))}
      start={highlight.start}
      end={highlight.end}
      today={todayKey}
      maxDate={todayKey}
      onSelectDay={(date) => setDraft((current) => selectReportDraftDay(current, formatLocalDateKey(date), nowMs))}
      notice={draft.choice ? result.error : null}
      doneDisabled={!result.value}
      onDone={() => {
        const current = reportDraftResult(draft, nowMs);
        if (!current.value) return false;
        if (onApply(current.value) === false) return false;
        return true;
      }}
      onDismissed={onDismissed}
      testID="report-date-sheet"
    />
  );
}

const s = StyleSheet.create({
  search: { minHeight: 44, padding: 10, borderRadius: 12, fontSize: 15 },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  optionText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "600" },
  optionBlock: { width: 34, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  filterHead: { gap: 12 },
  filterTitleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  filterTitles: { flex: 1, minWidth: 0, gap: 2 },
  filterTitle: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 20 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  headLink: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  headLinkText: { fontSize: 15, fontWeight: "700" },
  filterSection: { gap: 6, paddingTop: 6 },
  optionCard: { borderRadius: 16, paddingHorizontal: 12 },
  facets: { gap: 10, paddingBottom: 10 },
  advancedClip: { overflow: "hidden" },
  advancedMeasure: { position: "absolute", top: 0, left: 0, right: 0 },
  facetChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  facetChip: {
    minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12,
    borderRadius: DAYFRAME_BLOCKS.radius.pill, maxWidth: "100%",
  },
  disclosure: { flexDirection: "row", minHeight: 44, alignItems: "center", borderRadius: 12, paddingHorizontal: 12, gap: 6 },
});
