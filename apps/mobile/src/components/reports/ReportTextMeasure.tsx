import type { TextStyle } from "react-native";
import { useIntrinsicTextMeasure } from "../accessibility/IntrinsicTextMeasure";

/** Reports compatibility adapter: keep the established hook and probe IDs. */
export function useReportTextMeasure(
  samples: string[],
  style: TextStyle,
  cap: number,
) {
  return useIntrinsicTextMeasure(samples, style, cap, "report-measure");
}
