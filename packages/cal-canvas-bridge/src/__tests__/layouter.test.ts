import { describe, expect, it, vi } from "vitest";
import { parseCalPrompt, type CalAst } from "@sparkcanvas/ai-design-language";
import { computeLayout } from "../layouter.js";

function mockRandomSequence(values: number[]) {
  let index = 0;
  return vi.spyOn(Math, "random").mockImplementation(() => values[index++] ?? values[values.length - 1] ?? 0.123456789);
}

describe("computeLayout", () => {
  it("lays out a full CAL prompt in layered columns", () => {
    const random = mockRandomSequence([0.1111111, 0.2222222, 0.3333333, 0.4444444, 0.5555555, 0.6666666, 0.7777777]);
    const ast = parseCalPrompt("@art /generate $brand.logo -> jpg");

    const result = computeLayout(ast);
    const agentNode = result.nodes.find((node) => node.type === "agent");
    const commandNode = result.nodes.find((node) => node.type === "command");
    const resourceNode = result.nodes.find((node) => node.type === "resource");
    const outputNode = result.nodes.find((node) => node.type === "output");

    expect(result.nodes.map((node) => node.type)).toEqual(["agent", "command", "resource", "output"]);
    expect(agentNode).toMatchObject({ label: "@art", title: "Agent art", body: "art", x: 80, y: 72 });
    expect(commandNode).toMatchObject({ label: "/generate", title: "Command generate", body: "generate", x: 340, y: 88 });
    expect(resourceNode).toMatchObject({ label: "$brand.logo", title: "Image resource", body: "brand · logo", x: -180, y: 72 });
    expect(outputNode).toMatchObject({ label: "-> jpg", title: "Output target", body: "jpg", x: 600, y: 72 });
    expect(result.edges).toHaveLength(3);
    expect(result.edges).toEqual([
      expect.objectContaining({ from: agentNode?.id, to: commandNode?.id }),
      expect.objectContaining({ from: resourceNode?.id, to: agentNode?.id }),
      expect.objectContaining({ from: commandNode?.id, to: outputNode?.id })
    ]);
    random.mockRestore();
  });

  it("falls back to a single command node when AST is empty", () => {
    const ast: CalAst = {
      version: "cal/1.0",
      originalPrompt: "  ",
      normalizedPrompt: "write the prompt",
      agents: [],
      commands: [],
      resources: [],
      lockedTexts: [],
      tags: [],
      params: {},
      outputs: [],
      pipelineSteps: 0,
      warnings: []
    };

    const result = computeLayout(ast);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.type).toBe("command");
    expect(result.nodes[0]?.label).toBe("/prompt");
    expect(result.nodes[0]?.body).toBe("write the prompt");
    expect(result.edges).toEqual([]);
  });

  it("handles agents only", () => {
    const ast = parseCalPrompt("@one @two");
    const result = computeLayout(ast);

    expect(result.nodes.map((node) => node.type)).toEqual(["agent", "agent"]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: result.nodes[0]?.id, to: result.nodes[1]?.id });
  });

  it("handles resources only", () => {
    const ast = parseCalPrompt("$brand.logo $docs.terms");
    const result = computeLayout(ast);

    expect(result.nodes.map((node) => node.type)).toEqual(["resource", "resource"]);
    expect(result.nodes[0]?.label).toBe("$brand.logo");
    expect(result.nodes[0]?.body).toBe("brand · logo");
    expect(result.nodes[1]?.body).toBe("docs · terms");
    expect(result.edges).toHaveLength(1);
  });

  it("accepts custom layout options", () => {
    const ast = parseCalPrompt("@art /generate -> jpg");
    const result = computeLayout(ast, {
      startX: 10,
      startY: 20,
      nodeWidth: 300,
      nodeHeight: 140,
      gapX: 400,
      gapY: 220
    });

    const agentNode = result.nodes.find((node) => node.type === "agent");
    const commandNode = result.nodes.find((node) => node.type === "command");
    const outputNode = result.nodes.find((node) => node.type === "output");

    expect(agentNode).toMatchObject({ x: 10, y: 20, width: 300, height: 140 });
    expect(commandNode).toMatchObject({ x: 410, y: 36, width: 300, height: 140 });
    expect(outputNode).toMatchObject({ x: 810, y: 20, width: 300, height: 140 });
  });
});
