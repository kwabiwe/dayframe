import { StyleSheet, type StyleProp, type TextLayoutEvent, type TextStyle } from "react-native";
import { MOBILE_TEXT_CAP, type MobileTextRole } from "../../lib/mobileTypography";

export type MobileAccessibilityFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MobileAccessibilityTextLine = {
  width: number;
  height: number;
  ascender?: number;
  descender?: number;
};

export type MobileAccessibilityTextMetrics = {
  role: MobileTextRole;
  fontSize?: number;
  lineHeight?: number;
  maxFontSizeMultiplier: number;
};

/** Optional, local-only instrumentation for the synthetic accessibility probe. */
export type MobileAccessibilityDiagnostic = {
  onLayout?: (id: string, frame: MobileAccessibilityFrame) => void;
  onTextLayout?: (
    id: string,
    lines: MobileAccessibilityTextLine[],
    metrics?: MobileAccessibilityTextMetrics,
  ) => void;
  onRemove?: (id: string) => void;
};

export function recordMobileTextLayout(
  diagnostic: MobileAccessibilityDiagnostic | undefined,
  id: string,
  event: TextLayoutEvent,
  role: MobileTextRole,
  style: StyleProp<TextStyle>,
) {
  if (!diagnostic?.onTextLayout) return;
  const flattened = StyleSheet.flatten(style);
  diagnostic.onTextLayout(
    id,
    event.nativeEvent.lines.map(({ width, height, ascender, descender }) => ({
      width,
      height,
      ascender,
      descender,
    })),
    {
      role,
      fontSize: flattened?.fontSize,
      lineHeight: flattened?.lineHeight,
      maxFontSizeMultiplier: MOBILE_TEXT_CAP[role],
    },
  );
}

export function recordMobileLayout(
  diagnostic: MobileAccessibilityDiagnostic | undefined,
  id: string,
  event: { nativeEvent: { layout: MobileAccessibilityFrame } },
) {
  const frame = event?.nativeEvent?.layout;
  if (!frame) return;
  diagnostic?.onLayout?.(id, frame);
}
