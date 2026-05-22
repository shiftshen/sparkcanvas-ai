import type { TypographyTokens } from "../types.js";

/**
 * Typography tokens for interface chrome, prompt editing, and generated asset
 * compositions. Sizes are tuned for a modern product UI with bilingual use.
 */
export const typography = {
  fontFamily: {
    sans: 'Inter, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
    display: '"Sora", Inter, "SF Pro Display", sans-serif',
    mono: '"SFMono-Regular", "SF Mono", Consolas, monospace'
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700
  },
  scale: {
    display: {
      fontSize: "3.5rem",
      lineHeight: "1.1",
      fontWeight: 700,
      letterSpacing: "-0.04em"
    },
    headingLg: {
      fontSize: "2rem",
      lineHeight: "1.2",
      fontWeight: 700,
      letterSpacing: "-0.03em"
    },
    headingMd: {
      fontSize: "1.5rem",
      lineHeight: "1.25",
      fontWeight: 600,
      letterSpacing: "-0.02em"
    },
    headingSm: {
      fontSize: "1.25rem",
      lineHeight: "1.35",
      fontWeight: 600,
      letterSpacing: "-0.015em"
    },
    bodyLg: {
      fontSize: "1.125rem",
      lineHeight: "1.6",
      fontWeight: 400,
      letterSpacing: "-0.01em"
    },
    bodyMd: {
      fontSize: "1rem",
      lineHeight: "1.6",
      fontWeight: 400,
      letterSpacing: "-0.01em"
    },
    bodySm: {
      fontSize: "0.875rem",
      lineHeight: "1.5",
      fontWeight: 400,
      letterSpacing: "0"
    },
    caption: {
      fontSize: "0.75rem",
      lineHeight: "1.4",
      fontWeight: 500,
      letterSpacing: "0.01em"
    },
    overline: {
      fontSize: "0.6875rem",
      lineHeight: "1.35",
      fontWeight: 600,
      letterSpacing: "0.12em"
    }
  }
} as const satisfies TypographyTokens;

/** Typography token object type. */
export type Typography = typeof typography;
/** Typography style scale type. */
export type TypographyScale = Typography["scale"];
/** Typography style token name type. */
export type TypographyTokenName = keyof TypographyScale;
