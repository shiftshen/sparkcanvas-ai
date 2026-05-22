import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ThemeMode } from "@sparkcanvas/ai-design-language";
import { applyThemeMode, getInitialThemeMode, persistThemeMode, resolveCssVariable } from "./cssVariables";

type TokenCategory = "color" | "spacing" | "border-radius" | "border-width" | "font-family" | "font-weight" | "font-size" | "line-height" | "letter-spacing" | "font-weight-scale" | "motion-duration" | "motion-easing";

type ThemeContextValue = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
  getTokenVar: (category: TokenCategory, name: string) => string;
  getTokenValue: (category: TokenCategory, name: string) => string;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getInitialThemeMode());

  useEffect(() => {
    applyThemeMode(themeMode);
    persistThemeMode(themeMode);
  }, [themeMode]);

  const value = useMemo<ThemeContextValue>(() => ({
    themeMode,
    setThemeMode: setThemeModeState,
    toggleThemeMode: () => setThemeModeState((current) => current === "dark" ? "light" : "dark"),
    getTokenVar: (category, name) => resolveCssVariable(category, name),
    getTokenValue: (category, name) => {
      if (typeof window === "undefined") return "";
      const tokenVar = resolveCssVariable(category, name);
      const match = /var\((--[^)]+)\)/.exec(tokenVar);
      if (!match) return "";
      return window.getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
    }
  }), [themeMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemeContext must be used within ThemeProvider");
  return context;
}

export function useTokens() {
  return useThemeContext();
}
