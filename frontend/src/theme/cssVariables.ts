import { borders, colors, motion, spacing, typography, type ThemeMode } from "@sparkcanvas/ai-design-language";

const STYLE_ELEMENT_ID = "sparkcanvas-ai-design-language-vars";
const STORAGE_KEY = "sparkcanvas.theme-mode";

function toKebabCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\s+/g, "-").toLowerCase();
}

function cssVarName(category: string, name: string) {
  return `--sc-${category}-${toKebabCase(name)}`;
}

function serializeDeclaration(name: string, value: string | number) {
  return `  ${name}: ${String(value)};`;
}

function serializeBlock(selector: string, declarations: string[]) {
  return `${selector} {\n${declarations.join("\n")}\n}`;
}

function themeColorDeclarations(mode: ThemeMode) {
  return Object.entries(colors[mode]).map(([name, value]) => serializeDeclaration(cssVarName("color", name), value));
}

function sharedDeclarations() {
  const declarations: string[] = [];

  Object.entries(spacing).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("spacing", name), value));
  });

  Object.entries(borders.radius).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("border-radius", name), value));
  });

  Object.entries(borders.width).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("border-width", name), value));
  });

  Object.entries(typography.fontFamily).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("font-family", name), value));
  });

  Object.entries(typography.weight).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("font-weight", name), value));
  });

  Object.entries(typography.scale).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("font-size", name), value.fontSize));
    declarations.push(serializeDeclaration(cssVarName("line-height", name), value.lineHeight));
    declarations.push(serializeDeclaration(cssVarName("letter-spacing", name), value.letterSpacing));
    declarations.push(serializeDeclaration(cssVarName("font-weight-scale", name), value.fontWeight));
  });

  Object.entries(motion.duration).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("motion-duration", name), value));
  });

  Object.entries(motion.easing).forEach(([name, value]) => {
    declarations.push(serializeDeclaration(cssVarName("motion-easing", name), value));
  });

  return declarations;
}

export function buildThemeCssVariables() {
  return [
    serializeBlock(":root", [...sharedDeclarations(), ...themeColorDeclarations("light")]),
    serializeBlock('[data-theme="dark"]', themeColorDeclarations("dark"))
  ].join("\n\n");
}

export function initializeThemeVariables() {
  if (typeof document === "undefined") return;
  let styleElement = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = buildThemeCssVariables();
}

export function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

export function persistThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function resolveCssVariable(category: string, name: string) {
  return `var(${cssVarName(category, name)})`;
}
