/** Standalone, synthetic native layout probe. Never imported by expo-router.
 * Bundle explicitly with expo export:embed --entry-file scripts/reports-layout-qa-entry.tsx.
 * No authentication, backend calls or personal capture; caches geometry only.
 */
import React, {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  AppRegistry,
  AccessibilityInfo,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { File, Paths } from "expo-file-system";
import { DatePickerCalendar } from "../src/components/calendar/DatePickerCalendar";
import { MobileThemeProvider, useMobileTheme } from "../src/lib/mobileTheme";
import { useReportTextMeasure } from "../src/components/reports/ReportTextMeasure";

const frames: Record<string, unknown> = {};
function instrument(node: ReactNode, path = "calendar"): ReactNode {
  if (!isValidElement<Record<string, any>>(node)) return node;
  const id = node.props.testID ?? path;
  const children = React.Children.map(node.props.children, (child, index) =>
    instrument(child, `${path}.${index}`),
  );
  const props: Record<string, unknown> = { children };
  if ([View, Text, Pressable].includes(node.type as never)) {
    props.onLayout = (event: any) => {
      frames[id] = event.nativeEvent.layout;
      node.props.onLayout?.(event);
    };
    if (node.type === Text) {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      frames[`${id}.props`] = {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        maxFontSizeMultiplier: node.props.maxFontSizeMultiplier,
        numberOfLines: node.props.numberOfLines,
      };
      props.onTextLayout = (event: any) => {
        frames[`${id}.lines`] = event.nativeEvent.lines.map(
          ({ text: _text, ...geometry }: any) => geometry,
        );
        node.props.onTextLayout?.(event);
      };
    }
  }
  return cloneElement(node, props);
}
function Probe() {
  const { styles, theme } = useMobileTheme();
  const [month, setMonth] = useState("2026-09-01");
  const [selected, setSelected] = useState("none");
  const [evidence, setEvidence] = useState("");
  const [screen, setScreen] = useState("calendar");
  const [gridWidth, setGridWidth] = useState(390);
  const { fontScale } = useWindowDimensions();
  const [bold, setBold] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isBoldTextEnabled().then(setBold);
    const subscription = AccessibilityInfo.addEventListener(
      "boldTextChanged",
      setBold,
    );
    return () => subscription.remove();
  }, []);
  const measured = useReportTextMeasure(
    ["100%", "<1%", "88:88:88", "888:88:88", "8888:88:88", "888888:88:88"],
    { fontSize: 14, fontVariant: ["tabular-nums"] },
    1.2,
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      const result = JSON.stringify({
        scale: PixelRatio.getFontScale(),
        gridWidth,
        bold,
        appearance: theme.mode,
        frames,
        numericWidths: measured.widths,
      });
      new File(Paths.cache, "reports-layout-qa.json").write(result);
    }, 4000);
    return () => clearTimeout(timer);
  }, [
    screen,
    gridWidth,
    month,
    fontScale,
    bold,
    theme.mode,
    JSON.stringify(measured.widths),
  ]);
  // Direct invocation lets this diagnostic entry instrument the returned host
  // tree without altering production props or logging personal strings.
  const calendar = DatePickerCalendar({
    month,
    onMonthChange: setMonth,
    start: "2026-09-07",
    end: "2026-09-13",
    today: "2026-09-10",
    maxDate: "2026-09-10",
    onSelect: (date) =>
      setSelected(
        `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      ),
    theme,
    reduceMotion: true,
  });
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.background, paddingTop: 30 }}
    >
      <View style={{ flexDirection: "row", gap: 16, padding: 6 }}>
        <Pressable onPress={() => setScreen("calendar")}>
          <Text
            maxFontSizeMultiplier={1}
            style={{ fontSize: 12, color: theme.textPrimary }}
          >
            Calendar QA
          </Text>
        </Pressable>
        <Pressable onPress={() => setScreen("text")}>
          <Text
            maxFontSizeMultiplier={1}
            style={{ fontSize: 12, color: theme.textPrimary }}
          >
            Text QA
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            setEvidence(
              JSON.stringify({ scale: PixelRatio.getFontScale(), frames }),
            )
          }
        >
          <Text
            maxFontSizeMultiplier={1}
            style={{ fontSize: 12, color: theme.textPrimary }}
          >
            Frames
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            setGridWidth(
              (
                { 308: 363, 363: 378, 378: 390, 390: 418, 418: 308 } as Record<
                  number,
                  number
                >
              )[gridWidth],
            )
          }
        >
          <Text
            maxFontSizeMultiplier={1}
            style={{ fontSize: 12, color: theme.textPrimary }}
          >
            Width {gridWidth}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 6, paddingBottom: 100 }}
      >
        {instrument(measured.probe, "numeric-probe")}
        {screen === "calendar" ? (
          <View style={{ width: gridWidth }}>{instrument(calendar)}</View>
        ) : null}
        {instrument(
          <View style={{ gap: 12, padding: 16 }}>
            <Text
              testID="probe-reports"
              maxFontSizeMultiplier={1.5}
              style={styles.reportScreenTitle}
            >
              Reports
            </Text>
            <Text testID="probe-today" style={styles.todayTitle}>
              Today
            </Text>
            <Text
              testID="probe-activity"
              maxFontSizeMultiplier={1.5}
              style={{
                fontSize: 18,
                fontWeight: "600",
                color: theme.textPrimary,
              }}
            >
              Activity over time
            </Text>
            <Text
              testID="probe-total"
              maxFontSizeMultiplier={1.2}
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: theme.textPrimary,
              }}
            >
              Total
            </Text>
            <Text
              testID="probe-natural"
              style={{ fontSize: 18, color: theme.textPrimary }}
            >
              Natural height reference
            </Text>
          </View>,
          "text",
        )}
        <Text testID="qa-selected" style={{ color: theme.textPrimary }}>
          Selected {selected}
        </Text>
        <Text
          testID="qa-evidence"
          selectable
          style={{ fontSize: 9, color: theme.textSecondary }}
        >
          {evidence}
        </Text>
      </ScrollView>
    </View>
  );
}
AppRegistry.registerComponent(
  "main",
  () =>
    function LayoutQa() {
      return (
        <MobileThemeProvider>
          <Probe />
        </MobileThemeProvider>
      );
    },
);
