import type { SpacingTokens } from "../types.js";

/**
 * Spacing scale based on a 4px grid to keep layouts, panels, and canvas chrome
 * visually aligned.
 */
export const spacing = {
  px: "4px",
  xs: "8px",
  sm: "12px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  '2xl': "48px",
  '3xl': "64px"
} as const satisfies SpacingTokens;

/** Spacing token object type. */
export type Spacing = typeof spacing;
/** Spacing token name type. */
export type SpacingTokenName = keyof Spacing;
