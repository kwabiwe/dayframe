import { Text, View } from "react-native";
import type { MobileStyles } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "./diagnostics";

export function TodayDateHeading({
  dateLabel,
  styles,
  diagnostic,
}: {
  dateLabel: string;
  styles: MobileStyles;
  diagnostic?: MobileAccessibilityDiagnostic;
}) {
  return (
    <View
      style={styles.todayHeading}
      onLayout={(event) => recordMobileLayout(diagnostic, "today.heading", event)}
    >
      <Text
        {...mobileTextProps("screenHeading")}
        style={styles.todayTitle}
        onLayout={(event) => recordMobileLayout(diagnostic, "today.heading.title.frame", event)}
        onTextLayout={(event) => recordMobileTextLayout(diagnostic, "today.heading.title", event, "screenHeading", styles.todayTitle)}
      >
        Today
      </Text>
      <Text
        {...mobileTextProps("metadata")}
        style={styles.todaySubtitle}
        onLayout={(event) => recordMobileLayout(diagnostic, "today.heading.date.frame", event)}
        onTextLayout={(event) => recordMobileTextLayout(diagnostic, "today.heading.date", event, "metadata", styles.todaySubtitle)}
      >
        {dateLabel}
      </Text>
    </View>
  );
}
