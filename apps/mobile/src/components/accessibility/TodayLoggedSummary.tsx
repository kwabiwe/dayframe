import { useState } from "react";
import { Text, View } from "react-native";
import { summaryLayout } from "../../lib/mobileAccessibilityLayout";
import type { MobileStyles } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { useIntrinsicTextMeasure } from "./IntrinsicTextMeasure";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "./diagnostics";

export function TodayLoggedSummary({
  value,
  coveredValue,
  styles,
  diagnostic,
  diagnosticPrefix = "logged",
}: {
  value: string;
  coveredValue?: string | null;
  styles: MobileStyles;
  diagnostic?: MobileAccessibilityDiagnostic;
  diagnosticPrefix?: string;
}) {
  const numericSample = value.replace(/[0-9]/g, "8");
  const valueMeasure = useIntrinsicTextMeasure([numericSample], styles.todayTrackedValue, 1.2);
  const labelMeasure = useIntrinsicTextMeasure(["Logged"], styles.todayTrackedLabel, 1.3);
  const [availableWidth, setAvailableWidth] = useState(0);
  const valueWidth = valueMeasure.widths[numericSample] ?? 0;
  const labelWidth = labelMeasure.widths.Logged ?? 0;
  const stacked = !valueWidth || !labelWidth || summaryLayout({
    availableWidth,
    labelWidth,
    valueWidth,
    gap: 12,
  }) === "stacked";
  const id = (name: string) => `${diagnosticPrefix}.${name}`;

  return (
    <View
      style={[styles.todayTrackedRow, stacked ? styles.todayTrackedRowStacked : null]}
      onLayout={(event) => {
        recordMobileLayout(diagnostic, id("row"), event);
        const width = event?.nativeEvent?.layout?.width;
        if (width === undefined) return;
        const nextWidth = Math.max(0, width - 28);
        setAvailableWidth((current) => current === nextWidth ? current : nextWidth);
      }}
    >
      {valueMeasure.probe}
      {labelMeasure.probe}
      <Text
        {...mobileTextProps("metadata")}
        style={styles.todayTrackedLabel}
        onLayout={(event) => recordMobileLayout(diagnostic, id("label.frame"), event)}
        onTextLayout={(event) => recordMobileTextLayout(diagnostic, id("label"), event, "metadata", styles.todayTrackedLabel)}
      >
        Logged
      </Text>
      <View>
        <Text
          {...mobileTextProps("numeric")}
          style={styles.todayTrackedValue}
          onLayout={(event) => recordMobileLayout(diagnostic, id("value.frame"), event)}
          onTextLayout={(event) => recordMobileTextLayout(diagnostic, id("value"), event, "numeric", styles.todayTrackedValue)}
        >
          {value}
        </Text>
        {coveredValue ? (
          <Text
            {...mobileTextProps("numeric")}
            style={[styles.reviewMetaLine, { textAlign: stacked ? "left" : "right" }]}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, id("covered"), event, "numeric", styles.reviewMetaLine)}
          >
            {coveredValue}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
