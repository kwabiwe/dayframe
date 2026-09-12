import type { TextProps } from "react-native";

export const MOBILE_TEXT_CAP = {
  screenHeading: 1.5,
  sectionHeading: 1.5,
  itemTitle: 1.35,
  control: 1.3,
  metadata: 1.3,
  numeric: 1.2,
  counter: 1.2,
  input: 1.35,
  body: 0,
} as const;

export type MobileTextRole = keyof typeof MOBILE_TEXT_CAP;
export type MobileTextProps = Pick<
  TextProps,
  "allowFontScaling" | "maxFontSizeMultiplier"
>;

export function mobileTextProps(role: MobileTextRole): MobileTextProps {
  return {
    allowFontScaling: true,
    maxFontSizeMultiplier: MOBILE_TEXT_CAP[role],
  };
}
