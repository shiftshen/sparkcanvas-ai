import { describe, expect, it } from "vitest";
import { parseCalPrompt } from "@sparkcanvas/ai-design-language";
import { validateCalAst } from "../validator.js";

describe("validateCalAst", () => {
  it("passes a valid AST", () => {
    const ast = parseCalPrompt('@design /compose -> output');
    const result = validateCalAst(ast);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("warns when commands have no outputs", () => {
    const ast = parseCalPrompt('@design /compose');
    const result = validateCalAst(ast);

    expect(result.warnings).toContain("No outputs specified for commands, output may be lost");
  });

  it("warns on duplicate tags and unknown brands", () => {
    const parsed = parseCalPrompt('@design $unknown.asset /compose -> output');
    const ast = {
      ...parsed,
      tags: ["dark", "dark"]
    };
    const result = validateCalAst(ast);

    expect(result.warnings.some((warning) => warning.includes("Duplicate system tag"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("Unknown brand resource key"))).toBe(true);
  });
});
