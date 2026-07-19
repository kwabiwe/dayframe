import { requireNativeViewManager } from "expo-modules-core";
import { useMemo, type ComponentType } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import type { NativeCalendarPresentation } from "../../../src/lib/nativeCalendarPresentation";

export type DayframeCalendarSelectDayEvent = { dayKey: string };
export type DayframeCalendarChangeDayEvent = { days: number };
export type DayframeCalendarChangeWeekEvent = { weeks: number };
export type DayframeCalendarEntryEvent = { entryId: string };
export type DayframeCalendarReviewEvent = { reviewItemId: string };

export type DayframeCalendarViewProps = ViewProps & {
  model: NativeCalendarPresentation;
  onChangeDay?: (event: NativeSyntheticEvent<DayframeCalendarChangeDayEvent>) => void;
  onChangeWeek?: (event: NativeSyntheticEvent<DayframeCalendarChangeWeekEvent>) => void;
  onOpenActiveTimer?: (event: NativeSyntheticEvent<DayframeCalendarEntryEvent>) => void;
  onOpenCompletedEntry?: (event: NativeSyntheticEvent<DayframeCalendarEntryEvent>) => void;
  onOpenReviewItem?: (event: NativeSyntheticEvent<DayframeCalendarReviewEvent>) => void;
  onRequestRefresh?: () => void;
  onSelectDay?: (event: NativeSyntheticEvent<DayframeCalendarSelectDayEvent>) => void;
};

type NativeDayframeCalendarViewProps = Omit<DayframeCalendarViewProps, "model"> & {
  modelJSON: string;
};

const NativeDayframeCalendarView: ComponentType<NativeDayframeCalendarViewProps> =
  requireNativeViewManager("DayframeCalendar");

export function DayframeCalendarView({ model, ...props }: DayframeCalendarViewProps) {
  const modelJSON = useMemo(() => JSON.stringify(model), [model]);
  return <NativeDayframeCalendarView {...props} modelJSON={modelJSON} />;
}
