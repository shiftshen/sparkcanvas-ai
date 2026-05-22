import { borders, colors, spacing, typography } from "@sparkcanvas/ai-design-language";

type ThemeMode = "light" | "dark";

type SemanticColorPalette = Readonly<Record<string, string>>;

type TypographyStyleToken = Readonly<{
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing: string;
}>;

type CalAst = Readonly<{
  tags: string[];
  params: Readonly<Record<string, string>>;
}>;

export type ThemeOutput = Readonly<{
  cssCustomProperties: Record<string, string>;
  semanticColors: SemanticColorPalette;
  typography: Record<string, TypographyStyleToken>;
  componentTokens: Record<string, string>;
}>;

const knownRadiusKeys = new Set(Object.keys(borders.radius));
const knownColorKeys = new Set(Object.keys(colors.light));

function toCssVarName(name: string) {
  return `--sc-${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

function cloneTypographyScale() {
  return Object.fromEntries(
    Object.entries(typography.scale).map(([key, value]: [string, TypographyStyleToken]) => [key, { ...value }])
  ) as Record<string, TypographyStyleToken>;
}

function parseTagHints(tags: readonly string[]) {
  let theme: ThemeMode | undefined;
  let brand: string | undefined;

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === "dark") theme = "dark";
    if (lower === "light") theme = "light";
    if (lower.startsWith("brand:")) {
      brand = tag.slice(tag.indexOf(":") + 1).trim() || undefined;
    }
  }

  return { theme, brand };
}

function getPalette(mode: ThemeMode, brand?: string): SemanticColorPalette {
  const palette: SemanticColorPalette = { ...colors[mode] };

  if (!brand) return palette;

  if (brand.toLowerCase() === "acme") {
    return {
      ...palette,
      primary: mode === "dark" ? "#22C55E" : "#16A34A",
      primaryHover: mode === "dark" ? "#4ADE80" : "#15803D",
      accent: mode === "dark" ? "#FBBF24" : "#D97706"
    };
  }

  if (brand.toLowerCase() === "client") {
    return {
      ...palette,
      primary: mode === "dark" ? "#38BDF8" : "#0EA5E9"
    };
  }

  return palette;
}

function applyParamOverrides(ast: CalAst, palette: SemanticColorPalette, componentTokens: Record<string, string>) {
  const colorIntent = ast.params.color?.trim();
  if (colorIntent && knownColorKeys.has(colorIntent)) {
    const resolved = palette[colorIntent as keyof SemanticColorPalette];
    componentTokens["--sc-button-bg"] = resolved;
    componentTokens["--sc-accent-color"] = resolved;
  }

  const radiusIntent = ast.params.radius?.trim();
  if (radiusIntent && knownRadiusKeys.has(radiusIntent)) {
    const resolved = borders.radius[radiusIntent as keyof typeof borders.radius];
    componentTokens["--sc-radius"] = resolved;
    componentTokens[`--sc-radius-${radiusIntent}`] = resolved;
  }
}

function buildCssCustomProperties(palette: SemanticColorPalette, componentTokens: Record<string, string>) {
  const css: Record<string, string> = {};

  for (const [key, value] of Object.entries(palette) as [string, string][]) {
    css[toCssVarName(key)] = value;
  }

  css["--sc-font-sans"] = typography.fontFamily.sans;
  css["--sc-font-display"] = typography.fontFamily.display;
  css["--sc-font-mono"] = typography.fontFamily.mono;

  for (const [key, value] of Object.entries(spacing) as [string, string][]) {
    css[`--sc-space-${key}`] = value;
  }

  for (const [key, value] of Object.entries(borders.radius) as [string, string][]) {
    css[`--sc-radius-${key}`] = value;
  }

  for (const [key, value] of Object.entries(typography.scale) as [string, TypographyStyleToken][]) {
    css[`--sc-type-${key}-font-size`] = value.fontSize;
    css[`--sc-type-${key}-line-height`] = value.lineHeight;
    css[`--sc-type-${key}-font-weight`] = String(value.fontWeight);
    css[`--sc-type-${key}-letter-spacing`] = value.letterSpacing;
  }

  return { ...css, ...componentTokens };
}

export function transformCalAst(
  ast: CalAst,
  options?: { theme?: ThemeMode; brand?: string }
): ThemeOutput {
  const { theme: tagTheme, brand: tagBrand } = parseTagHints(ast.tags);
  const mode = tagTheme ?? options?.theme ?? "light";
  const brand = tagBrand ?? options?.brand;
  const semanticColors = getPalette(mode, brand);
  const componentTokens: Record<string, string> = {
    "--sc-button-bg": semanticColors.primary,
    "--sc-button-text": semanticColors.textInverse,
    "--sc-surface": semanticColors.surface,
    "--sc-border": semanticColors.border,
    "--sc-radius": borders.radius.md
  };

  applyParamOverrides(ast, semanticColors, componentTokens);

  componentTokens["--sc-surface"] = semanticColors.surface;
  componentTokens["--sc-border"] = semanticColors.border;
  componentTokens["--sc-button-text"] = semanticColors.textInverse;

  return {
    cssCustomProperties: buildCssCustomProperties(semanticColors, componentTokens),
    semanticColors,
    typography: cloneTypographyScale(),
    componentTokens
  };
}
