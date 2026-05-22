declare module "@sparkcanvas/ai-design-language" {
  export type ThemeMode = "light" | "dark";
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

  export type SemanticColorPalette = Readonly<Record<SemanticColorSlot, string>>;
  export type TypographyStyleToken = Readonly<{
    fontSize: string;
    lineHeight: string;
    fontWeight: number;
    letterSpacing: string;
  }>;
  export type CalAst = Readonly<{
    tags: string[];
    params: Readonly<Record<string, string>>;
  }>;

  export const borders: {
    radius: Record<string, string>;
  };
  export const colors: Record<ThemeMode, SemanticColorPalette>;
  export const spacing: Record<string, string>;
  export const typography: {
    fontFamily: Readonly<{
      sans: string;
      display: string;
      mono: string;
    }>;
    scale: Record<string, TypographyStyleToken>;
  };
}
