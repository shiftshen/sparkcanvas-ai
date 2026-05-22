import type { BorderTokens } from "../types.js";

/**
 * Border tokens covering radius and stroke widths for cards, inputs, chips,
 * and floating canvases.
 */
export const borders = {
  radius: {
    none: "0px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    pill: "999px",
    round: "9999px"
  },
  width: {
    none: "0px",
    hairline: "1px",
    thin: "2px",
    medium: "3px",
    thick: "4px"
  }
} as const satisfies BorderTokens;

/** Border token object type. */
export type Borders = typeof borders;
/** Border radius token name type. */
export type BorderRadiusTokenName = keyof Borders["radius"];
/** Border width token name type. */
export type BorderWidthTokenName = keyof Borders["width"];
