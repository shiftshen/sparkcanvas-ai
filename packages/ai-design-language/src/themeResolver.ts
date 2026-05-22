import type {
  SemanticColorPalette,
  SemanticColorTokens,
  ThemeMode,
} from "./types.js";

export interface BrandPaletteInput {
  primary: string;
  accent?: string;
  surfaceLight?: string;
  surfaceDark?: string;
  textLight?: string;
  textDark?: string;
  success?: string;
  warning?: string;
  error?: string;
}

export type SemanticColorOverrides = Partial<
  Record<ThemeMode, Partial<SemanticColorPalette>>
>;

export interface CreateBrandThemeOptions {
  darkFromLight?: boolean;
}

const DEFAULT_LIGHT_SURFACE = "#F8FAFC";
const DEFAULT_DARK_SURFACE = "#020617";
const DEFAULT_LIGHT_TEXT = "#0F172A";
const DEFAULT_DARK_TEXT = "#F8FAFC";
const DEFAULT_LIGHT_ACCENT = "#EC4899";
const DEFAULT_DARK_ACCENT = "#F472B6";
const DEFAULT_INFO_LIGHT = "#0284C7";
const DEFAULT_INFO_DARK = "#38BDF8";

export function createBrandTheme(
  input: BrandPaletteInput,
  overrides: SemanticColorOverrides = {},
  options: CreateBrandThemeOptions = {},
): SemanticColorTokens {
  const light = buildPalette("light", input);
  const dark = options.darkFromLight
    ? deriveDarkPalette(light, input)
    : buildPalette("dark", input);

  return freezeTheme({
    light: applyOverrides(light, overrides.light),
    dark: applyOverrides(dark, overrides.dark),
  });
}

function buildPalette(
  mode: ThemeMode,
  input: BrandPaletteInput,
): SemanticColorPalette {
  const surface =
    mode === "light"
      ? (input.surfaceLight ?? DEFAULT_LIGHT_SURFACE)
      : (input.surfaceDark ?? DEFAULT_DARK_SURFACE);
  const text =
    mode === "light"
      ? (input.textLight ?? DEFAULT_LIGHT_TEXT)
      : (input.textDark ?? DEFAULT_DARK_TEXT);
  const primary = input.primary;
  const accent =
    input.accent ??
    (mode === "light" ? DEFAULT_LIGHT_ACCENT : DEFAULT_DARK_ACCENT);
  const success = input.success ?? (mode === "light" ? "#16A34A" : "#4ADE80");
  const warning = input.warning ?? (mode === "light" ? "#D97706" : "#FBBF24");
  const error = input.error ?? (mode === "light" ? "#DC2626" : "#F87171");
  const info = mode === "light" ? DEFAULT_INFO_LIGHT : DEFAULT_INFO_DARK;

  const primaryHover = adjust(primary, mode === "light" ? -0.1 : 0.1);
  const primaryActive = adjust(primary, mode === "light" ? -0.2 : 0.2);

  const accentHover = adjust(accent, mode === "light" ? -0.1 : 0.1);
  const accentActive = adjust(accent, mode === "light" ? -0.2 : 0.2);

  const textMuted = mixWithBase(text, surface, mode === "light" ? 0.28 : 0.22);
  const textInverse = contrastText(surface) === "black" ? "#F8FAFC" : "#0F172A";
  const border = mixWithBase(surface, text, mode === "light" ? 0.18 : 0.24);
  const borderStrong = mixWithBase(
    surface,
    text,
    mode === "light" ? 0.34 : 0.42,
  );
  const surfaceElevated =
    mode === "light" ? lighten(surface, 0.04) : darken(surface, 0.08);
  const surfaceOverlay = alpha(text, mode === "light" ? 0.72 : 0.82);
  const surfaceMuted = interpolate(surface, border, 0.5);
  const focusRing = alpha(primary, 0.4);

  return freezePalette({
    primary,
    primaryHover,
    primaryActive,
    accent,
    accentHover,
    accentActive,
    surface,
    surfaceElevated,
    surfaceOverlay,
    surfaceMuted,
    border,
    borderStrong,
    text,
    textMuted,
    textInverse,
    success,
    warning,
    error,
    info,
    focusRing,
  });
}

function deriveDarkPalette(
  light: SemanticColorPalette,
  input: BrandPaletteInput,
): SemanticColorPalette {
  const surface = input.surfaceDark ?? DEFAULT_DARK_SURFACE;
  const text = input.textDark ?? DEFAULT_DARK_TEXT;
  const accent = input.accent ?? DEFAULT_DARK_ACCENT;
  const darkPrimary =
    contrastText(input.primary) === "black"
      ? darken(input.primary, 0.25)
      : lighten(input.primary, 0.2);

  return freezePalette({
    primary: darkPrimary,
    primaryHover: lighten(darkPrimary, 0.1),
    primaryActive: lighten(darkPrimary, 0.2),
    accent,
    accentHover: lighten(accent, 0.1),
    accentActive: lighten(accent, 0.2),
    surface,
    surfaceElevated: darken(surface, 0.08),
    surfaceOverlay: alpha(surface, 0.82),
    surfaceMuted: interpolate(surface, text, 0.12),
    border: interpolate(surface, text, 0.24),
    borderStrong: interpolate(surface, text, 0.42),
    text,
    textMuted: interpolate(text, surface, 0.22),
    textInverse: light.text,
    success: input.success ?? "#4ADE80",
    warning: input.warning ?? "#FBBF24",
    error: input.error ?? "#F87171",
    info: DEFAULT_INFO_DARK,
    focusRing: alpha(darkPrimary, 0.4),
  });
}

function applyOverrides(
  palette: SemanticColorPalette,
  overrides?: Partial<SemanticColorPalette>,
): SemanticColorPalette {
  if (!overrides) return palette;
  return freezePalette({
    ...palette,
    ...overrides,
  });
}

function freezeTheme(theme: SemanticColorTokens): SemanticColorTokens {
  return Object.freeze({
    light: freezePalette(theme.light),
    dark: freezePalette(theme.dark),
  });
}

function freezePalette(palette: SemanticColorPalette): SemanticColorPalette {
  return Object.freeze({ ...palette });
}

function adjust(hex: string, amount: number): string {
  return amount >= 0 ? lighten(hex, amount) : darken(hex, Math.abs(amount));
}

function mixWithBase(fg: string, bg: string, amount: number): string {
  return interpolate(fg, bg, amount);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeHex(hex: string): string {
  const trimmed = hex.trim();
  if (!trimmed.startsWith("#")) return trimmed;
  if (trimmed.length === 4) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex);
  const match = /^#([0-9A-F]{6})$/i.exec(normalized);
  if (!match) throw new Error(`Invalid hex color: ${hex}`);
  const value = match[1] ?? "000000";
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) =>
    Math.round(clamp255(value)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = clamp01(amount);
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = clamp01(amount);
  return rgbToHex(r * (1 - t), g * (1 - t), b * (1 - t));
}

export function alpha(hex: string, opacity: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(opacity)})`;
}

export function interpolate(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  const x = clamp01(t);
  return rgbToHex(r1 + (r2 - r1) * x, g1 + (g2 - g1) * x, b1 + (b2 - b1) * x);
}

export function contrastText(bg: string): "black" | "white" {
  const [r, g, b] = hexToRgb(bg);
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.5 ? "black" : "white";
}

function srgb(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function clamp255(value: number): number {
  return Math.min(255, Math.max(0, value));
}
