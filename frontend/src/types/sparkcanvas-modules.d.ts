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
  export type CalResourceRef = Readonly<{
    raw: string;
    symbol: "$";
    type: "image" | "text";
    brandKey: string;
    path: string;
    fullKey: string;
    explicitBrand: boolean;
  }>;
  export type CalAst = Readonly<{
    version: "cal/1.0";
    originalPrompt: string;
    normalizedPrompt: string;
    agents: string[];
    commands: string[];
    resources: CalResourceRef[];
    lockedTexts: string[];
    tags: string[];
    params: Readonly<Record<string, string>>;
    outputs: string[];
    pipelineSteps: number;
    warnings: string[];
  }>;

  export const borders: {
    radius: Record<string, string>;
    width: Record<string, string>;
  };
  export const colors: Record<ThemeMode, SemanticColorPalette>;
  export const spacing: Record<string, string>;
  export const motion: {
    duration: Record<string, string>;
    easing: Record<string, string>;
  };
  export const typography: {
    fontFamily: Readonly<{
      sans: string;
      display: string;
      mono: string;
    }>;
    weight: Readonly<Record<string, number>>;
    scale: Record<string, TypographyStyleToken>;
  };

  export function parseCalPrompt(prompt: string): CalAst;
  export function summarizeCal(ast: CalAst): string;
}

declare module "@sparkcanvas/cal-canvas-bridge" {
  import type { CalAst } from "@sparkcanvas/ai-design-language";

  export type WorkflowCanvasNodeType = "agent" | "command" | "resource" | "output";
  export type WorkflowCanvasNode = Readonly<{
    id: string;
    type: WorkflowCanvasNodeType;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
    body: string;
  }>;
  export type WorkflowCanvasEdge = Readonly<{
    id: string;
    from: string;
    to: string;
  }>;
  export type WorkflowCanvasLayoutResult = Readonly<{
    nodes: WorkflowCanvasNode[];
    edges: WorkflowCanvasEdge[];
  }>;
  export type LayoutOptions = Readonly<{
    startX?: number;
    startY?: number;
    nodeWidth?: number;
    nodeHeight?: number;
    gapX?: number;
    gapY?: number;
    verticalGap?: number;
  }>;

  export function layoutCalAst(ast: CalAst, options?: LayoutOptions): WorkflowCanvasLayoutResult;
  export function layOutCalAst(ast: CalAst, options?: LayoutOptions): WorkflowCanvasLayoutResult;
  export function computeLayout(ast: CalAst, options?: LayoutOptions): WorkflowCanvasLayoutResult;
}
