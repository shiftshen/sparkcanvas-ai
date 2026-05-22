import { describe, expect, it } from "vitest";
import { parseCalPrompt } from "@sparkcanvas/ai-design-language";
import { transformCalAst } from "../transformer.js";

describe("transformCalAst", () => {
  it("builds css custom properties from a basic AST", () => {
    const ast = parseCalPrompt('@design /compose -> output');
    const output = transformCalAst(ast);

    expect(output.cssCustomProperties["--sc-primary"]).toBeDefined();
    expect(output.cssCustomProperties["--sc-font-sans"]).toContain("Inter");
    expect(output.componentTokens["--sc-button-bg"]).toBe(output.semanticColors.primary);
  });

  it("applies theme overrides from params", () => {
    const ast = parseCalPrompt('@design /compose color: accent radius: lg -> output');
    const output = transformCalAst(ast);

    expect(output.componentTokens["--sc-button-bg"]).toBe(output.semanticColors.accent);
    expect(output.componentTokens["--sc-accent-color"]).toBe(output.semanticColors.accent);
    expect(output.componentTokens["--sc-radius"]).toBe("12px");
  });

  it("switches to dark mode via tag", () => {
    const ast = parseCalPrompt('@design %dark /compose -> output');
    const output = transformCalAst(ast);

    expect(output.semanticColors.surface).toBe("#020617");
    expect(output.componentTokens["--sc-surface"]).toBe("#020617");
  });
});
