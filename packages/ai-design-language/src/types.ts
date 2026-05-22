/** Generic token scale map. */
export type TokenScale<T> = Readonly<Record<string, T>>;

/** Supported design language themes. */
export type ThemeMode = "light" | "dark";

/** Semantic color token slots shared across themes. */
export type SemanticColorSlot =
  | "primary"
  | "primaryHover"
  | "primaryActive"
  | "accent"
  | "accentHover"
  | "accentActive"
  | "surface"
  | "surfaceElevated"
  | "surfaceOverlay"
  | "surfaceMuted"
  | "border"
  | "borderStrong"
  | "text"
  | "textMuted"
  | "textInverse"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "focusRing";

/** A semantic color palette for a single theme mode. */
export type SemanticColorPalette = Readonly<Record<SemanticColorSlot, string>>;

/** Light and dark semantic color tokens. */
export type SemanticColorTokens = Readonly<Record<ThemeMode, SemanticColorPalette>>;

/** Typography style token definition. */
export type TypographyStyleToken = Readonly<{
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing: string;
}>;

/** Named typography scale used by the app shell and generated assets. */
export type TypographyTokens = Readonly<{
  fontFamily: Readonly<{
    sans: string;
    display: string;
    mono: string;
  }>;
  weight: Readonly<{
    regular: number;
    medium: number;
    semibold: number;
    bold: number;
  }>;
  scale: Readonly<{
    display: TypographyStyleToken;
    headingLg: TypographyStyleToken;
    headingMd: TypographyStyleToken;
    headingSm: TypographyStyleToken;
    bodyLg: TypographyStyleToken;
    bodyMd: TypographyStyleToken;
    bodySm: TypographyStyleToken;
    caption: TypographyStyleToken;
    overline: TypographyStyleToken;
  }>;
}>;

/** Spacing scale tokens based on a 4px grid. */
export type SpacingTokens = Readonly<{
  px: string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  '3xl': string;
}>;

/** Border radius tokens. */
export type RadiusTokens = Readonly<{
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  pill: string;
  round: string;
}>;

/** Border width tokens. */
export type BorderWidthTokens = Readonly<{
  none: string;
  hairline: string;
  thin: string;
  medium: string;
  thick: string;
}>;

/** Border token group. */
export type BorderTokens = Readonly<{
  radius: RadiusTokens;
  width: BorderWidthTokens;
}>;

/** Motion duration tokens. */
export type MotionDurationTokens = Readonly<{
  instant: string;
  fast: string;
  moderate: string;
  slow: string;
  slower: string;
}>;

/** Motion easing tokens inspired by Material Motion curves. */
export type MotionEasingTokens = Readonly<{
  standard: string;
  emphasized: string;
  decelerate: string;
  accelerate: string;
}>;

/** Motion token group. */
export type MotionTokens = Readonly<{
  duration: MotionDurationTokens;
  easing: MotionEasingTokens;
}>;
