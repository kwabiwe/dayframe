import type { CSSProperties } from "react";
import { blockColorsFor } from "@dayframe/shared";

/**
 * A solid activity block's fill and measured on-block text for both themes, as CSS custom
 * properties. `light-dark()` follows the page's `color-scheme`, which the theme sets, so a block
 * repaints with the theme without JavaScript. Use with the `.df-block` class.
 */
export function blockStyle(color: unknown, name = ""): CSSProperties {
  const light = blockColorsFor(color, "light", name);
  const dark = blockColorsFor(color, "dark", name);
  return {
    "--block": `light-dark(${light.fill}, ${dark.fill})`,
    "--on-block": `light-dark(${light.text}, ${dark.text})`
  } as CSSProperties;
}
