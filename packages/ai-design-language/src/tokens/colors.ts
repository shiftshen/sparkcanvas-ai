import type { SemanticColorTokens } from "../types.js";

/**
 * Semantic color tokens for SparkCanvas surfaces, content, feedback states,
 * and action emphasis across light and dark themes.
 */
export const colors = {
  light: {
    primary: "#4F46E5",
    primaryHover: "#4338CA",
    primaryActive: "#3730A3",
    accent: "#EC4899",
    accentHover: "#DB2777",
    accentActive: "#BE185D",
    surface: "#F8FAFC",
    surfaceElevated: "#FFFFFF",
    surfaceOverlay: "rgba(15, 23, 42, 0.72)",
    surfaceMuted: "#E2E8F0",
    border: "#CBD5E1",
    borderStrong: "#94A3B8",
    text: "#0F172A",
    textMuted: "#475569",
    textInverse: "#F8FAFC",
    success: "#16A34A",
    warning: "#D97706",
    error: "#DC2626",
    info: "#0284C7",
    focusRing: "#818CF8"
  },
  dark: {
    primary: "#818CF8",
    primaryHover: "#6366F1",
    primaryActive: "#4F46E5",
    accent: "#F472B6",
    accentHover: "#EC4899",
    accentActive: "#DB2777",
    surface: "#020617",
    surfaceElevated: "#0F172A",
    surfaceOverlay: "rgba(2, 6, 23, 0.82)",
    surfaceMuted: "#1E293B",
    border: "#334155",
    borderStrong: "#475569",
    text: "#F8FAFC",
    textMuted: "#CBD5E1",
    textInverse: "#0F172A",
    success: "#4ADE80",
    warning: "#FBBF24",
    error: "#F87171",
    info: "#38BDF8",
    focusRing: "#A5B4FC"
  }
} as const satisfies SemanticColorTokens;

/** Semantic color token object type. */
export type Colors = typeof colors;
/** Single theme semantic color palette type. */
export type ColorPalette = Colors[keyof Colors];
/** Single semantic color token key type. */
export type ColorTokenName = keyof ColorPalette;
