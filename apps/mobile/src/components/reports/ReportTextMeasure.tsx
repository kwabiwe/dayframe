import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from "react-native";

/** Intrinsic native measurements, independent of the constrained visible column.
 * Samples must contain presentation formats only, never user/category names.
 */
export function useReportTextMeasure(
  samples: string[],
  style: TextStyle,
  cap: number,
) {
  const { fontScale, width } = useWindowDimensions();
  const [bold, setBold] = useState(false);
  useEffect(() => {
    let current = true;
    AccessibilityInfo.isBoldTextEnabled?.().then((value) => {
      if (current) setBold(value);
    });
    const subscription = AccessibilityInfo.addEventListener?.(
      "boldTextChanged",
      setBold,
    );
    return () => {
      current = false;
      subscription?.remove();
    };
  }, []);
  const key = JSON.stringify([samples, style, cap, fontScale, width, bold]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [measurement, setMeasurement] = useState<{
    key: string;
    widths: Record<string, number>;
  }>({ key: "", widths: {} });
  const widths = measurement.key === key ? measurement.widths : {};
  const probe = (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        overflow: "hidden",
        opacity: 0,
      }}
    >
      <View style={{ width: 10000 }}>
        {samples.map((sample) => (
          <Text
            key={`${key}:${sample}`}
            testID={`report-measure-${sample}`}
            accessible={false}
            numberOfLines={1}
            maxFontSizeMultiplier={cap}
            style={style}
            onTextLayout={(event) => {
              if (currentKey.current !== key) return;
              const measured =
                Math.ceil(
                  Math.max(
                    0,
                    ...event.nativeEvent.lines.map((line) => line.width),
                  ),
                ) + 2;
              if (!Number.isFinite(measured) || measured <= 2) return;
              setMeasurement((previous) => {
                const values = previous.key === key ? previous.widths : {};
                return values[sample] === measured
                  ? previous
                  : { key, widths: { ...values, [sample]: measured } };
              });
            }}
          >
            {sample}
          </Text>
        ))}
      </View>
    </View>
  );
  return { widths, probe };
}
