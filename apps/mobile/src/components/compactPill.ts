import { StyleSheet } from "react-native";
import { DAYFRAME_BLOCKS } from "@dayframe/shared";

/**
 * The compact pill (owner rule, 28 Oct 2026): the Calendar row's Yes pill is the size for every
 * question and sheet answer (Yes / Edit / Not now): 32 points tall, 16 of side padding, 14-point bold,
 * full pill radius. Its hit slop makes the target 44 points tall (6 + 32 + 6); a pill is always wider
 * than 44 with its padding, so 4 a side only softens the edge.
 */
export const COMPACT_PILL_HEIGHT = 32;
export const COMPACT_PILL_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

export const compactPillStyles = StyleSheet.create({
  pill: { alignSelf: "flex-start", minHeight: COMPACT_PILL_HEIGHT, justifyContent: "center", paddingHorizontal: 16, borderRadius: DAYFRAME_BLOCKS.radius.pill },
  text: { fontSize: 14, fontWeight: "700" },
  // Rows of pills sit 12 apart, so a wrapped row's 44-point targets never overlap (32 + 6 + 6 = 44).
  answers: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 12 }
});
