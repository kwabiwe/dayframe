import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "../lib/mobileTypography";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "./accessibility/diagnostics";

export function TagMetadata({
  accessibilityHidden = false,
  active = false,
  diagnostic,
  diagnosticPrefix,
  onPressTag,
  styles,
  tagNames,
  theme
}: {
  accessibilityHidden?: boolean;
  active?: boolean;
  diagnostic?: MobileAccessibilityDiagnostic;
  diagnosticPrefix?: string;
  onPressTag?: (tagName: string) => void;
  styles: MobileStyles;
  tagNames: string[];
  theme: MobileTheme;
}) {
  if (tagNames.length === 0) return null;
  const label = tagNames.join(" · ");
  const color = active ? theme.accentText : theme.textSecondary;

  return (
    <View
      accessible={!onPressTag && !accessibilityHidden}
      accessibilityElementsHidden={accessibilityHidden}
      importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
      accessibilityLabel={onPressTag ? undefined : `Tags: ${label}`}
      style={styles.tagMetadataRow}
      onLayout={(event) => {
        if (diagnosticPrefix) recordMobileLayout(diagnostic, diagnosticPrefix, event);
      }}
    >
      <Svg accessibilityElementsHidden height={14} viewBox="0 0 24 24" width={14}>
        <Path
          clipRule="evenodd"
          d="M3 5.25A2.25 2.25 0 0 1 5.25 3h4.42c.6 0 1.17.24 1.59.66l9.08 9.08a2.25 2.25 0 0 1 0 3.18l-4.42 4.42a2.25 2.25 0 0 1-3.18 0l-9.08-9.08A2.25 2.25 0 0 1 3 9.67V5.25Zm4 3.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z"
          fill={color}
          fillRule="evenodd"
        />
      </Svg>
      {tagNames.map((tagName, index) => (
        <View
          key={`${tagName}:${index}`}
          style={styles.tagMetadataTagGroup}
          onLayout={(event) => {
            if (diagnosticPrefix) recordMobileLayout(diagnostic, `${diagnosticPrefix}.group.${index}`, event);
          }}
        >
          {index > 0 ? (
            <Text {...mobileTextProps("counter")} accessibilityElementsHidden style={[styles.tagMetadataSeparator, active ? { color: theme.accentText } : null]}>·</Text>
          ) : null}
          {onPressTag ? (
            <Pressable
              accessibilityHint="Removes this tag from the draft; save the entry to confirm"
              accessibilityLabel={`Remove tag ${tagName}`}
              accessibilityRole="button"
              onPress={() => onPressTag(tagName)}
              onLayout={(event) => {
                if (diagnosticPrefix) recordMobileLayout(diagnostic, `${diagnosticPrefix}.remove.${index}`, event);
              }}
              style={({ pressed }) => [
                styles.tagMetadataTagButton,
                pressed ? styles.buttonPressed : null
              ]}
            >
              <Text
                {...mobileTextProps("metadata")}
                numberOfLines={1}
                style={[styles.tagMetadataText, active ? { color: theme.accentText } : null]}
                onLayout={(event) => {
                  if (diagnosticPrefix) recordMobileLayout(diagnostic, `${diagnosticPrefix}.text.${index}.frame`, event);
                }}
                onTextLayout={(event) => {
                  if (diagnosticPrefix) recordMobileTextLayout(diagnostic, `${diagnosticPrefix}.text.${index}`, event, "metadata", styles.tagMetadataText);
                }}
              >
                {tagName}
              </Text>
            </Pressable>
          ) : (
            <Text
              {...mobileTextProps("metadata")}
              numberOfLines={1}
              style={[styles.tagMetadataText, active ? { color: theme.accentText } : null]}
              onLayout={(event) => {
                if (diagnosticPrefix) recordMobileLayout(diagnostic, `${diagnosticPrefix}.text.${index}.frame`, event);
              }}
              onTextLayout={(event) => {
                if (diagnosticPrefix) recordMobileTextLayout(diagnostic, `${diagnosticPrefix}.text.${index}`, event, "metadata", styles.tagMetadataText);
              }}
            >
              {tagName}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
