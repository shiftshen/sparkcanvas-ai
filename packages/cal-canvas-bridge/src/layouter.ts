import type {
  WorkflowCanvasEdge,
  WorkflowCanvasLayoutResult,
  WorkflowCanvasNode,
  WorkflowCanvasNodeType
} from "./types.js";

type CalResourceRef = Readonly<{
  raw: string;
  type: "image" | "text";
  brandKey: string;
  path: string;
  explicitBrand: boolean;
}>;

type CalAst = Readonly<{
  normalizedPrompt: string;
  agents: string[];
  commands: string[];
  resources: CalResourceRef[];
  outputs: string[];
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

const DEFAULTS = {
  startX: 80,
  startY: 72,
  nodeWidth: 220,
  nodeHeight: 112,
  gapX: 260,
  gapY: 160,
  verticalGap: 16
} as const;

function randomId(prefix: WorkflowCanvasNodeType | "edge") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function buildNode(
  type: WorkflowCanvasNodeType,
  x: number,
  y: number,
  label: string,
  title: string,
  body: string,
  options: Required<Pick<LayoutOptions, "nodeWidth" | "nodeHeight">>
): WorkflowCanvasNode {
  return {
    id: randomId(type),
    type,
    label,
    title,
    body,
    x,
    y,
    width: options.nodeWidth,
    height: options.nodeHeight
  };
}

export function computeLayout(ast: CalAst, options: LayoutOptions = {}): WorkflowCanvasLayoutResult {
  const resolved = {
    startX: options.startX ?? DEFAULTS.startX,
    startY: options.startY ?? DEFAULTS.startY,
    nodeWidth: options.nodeWidth ?? DEFAULTS.nodeWidth,
    nodeHeight: options.nodeHeight ?? DEFAULTS.nodeHeight,
    gapX: options.gapX ?? DEFAULTS.gapX,
    gapY: options.gapY ?? DEFAULTS.gapY,
    verticalGap: options.verticalGap ?? DEFAULTS.verticalGap
  } as const;

  const nodes: WorkflowCanvasNode[] = [];
  const edges: WorkflowCanvasEdge[] = [];

  const hasAny = ast.agents.length || ast.commands.length || ast.resources.length || ast.outputs.length;

  if (!hasAny) {
    return {
      nodes: [
        buildNode(
          "command",
          resolved.startX,
          resolved.startY,
          "/prompt",
          "Command prompt",
          ast.normalizedPrompt,
          resolved
        )
      ],
      edges: []
    };
  }

  const agentNodes = ast.agents.map((name: string, index: number) =>
    buildNode(
      "agent",
      resolved.startX,
      resolved.startY + index * resolved.gapY,
      `@${name}`,
      `Agent ${name}`,
      name,
      resolved
    )
  );

  const commandNodes = ast.commands.map((name: string, index: number) =>
    buildNode(
      "command",
      resolved.startX + resolved.gapX,
      resolved.startY + index * resolved.gapY + resolved.verticalGap,
      `/${name}`,
      `Command ${name}`,
      name,
      resolved
    )
  );

  const resourceNodes = ast.resources.map((resource: CalResourceRef, index: number) =>
    buildNode(
      "resource",
      resolved.startX - resolved.gapX,
      resolved.startY + index * resolved.gapY,
      resource.raw,
      resource.type === "text" ? "Text resource" : "Image resource",
      resource.explicitBrand ? `${resource.brandKey} · ${resource.path}` : resource.path,
      resolved
    )
  );

  const outputNodes = ast.outputs.map((output: string, index: number) =>
    buildNode(
      "output",
      resolved.startX + resolved.gapX * 2,
      resolved.startY + index * resolved.gapY,
      `-> ${output}`,
      "Output target",
      output,
      resolved
    )
  );

  nodes.push(...agentNodes, ...commandNodes, ...resourceNodes, ...outputNodes);

  if (agentNodes.length && commandNodes.length) {
    const pairCount = Math.max(agentNodes.length, commandNodes.length);
    for (let index = 0; index < pairCount; index += 1) {
      const from = agentNodes[Math.min(index, agentNodes.length - 1)]!;
      const to = commandNodes[Math.min(index, commandNodes.length - 1)]!;
      if (!edges.some((edge) => edge.from === from.id && edge.to === to.id)) {
        edges.push({ id: randomId("edge"), from: from.id, to: to.id });
      }
    }
  } else {
    for (let index = 0; index < agentNodes.length - 1; index += 1) {
      edges.push({ id: randomId("edge"), from: agentNodes[index]!.id, to: agentNodes[index + 1]!.id });
    }
  }

  if (resourceNodes.length) {
    if (agentNodes.length) {
      resourceNodes.forEach((resourceNode: WorkflowCanvasNode, index: number) => {
        const target = agentNodes[Math.min(index, agentNodes.length - 1)]!;
        edges.push({ id: randomId("edge"), from: resourceNode.id, to: target.id });
      });
    } else {
      for (let index = 0; index < resourceNodes.length - 1; index += 1) {
        edges.push({ id: randomId("edge"), from: resourceNodes[index]!.id, to: resourceNodes[index + 1]!.id });
      }
    }
  }

  if (commandNodes.length && outputNodes.length) {
    outputNodes.forEach((outputNode: WorkflowCanvasNode, index: number) => {
      const source = commandNodes[Math.min(index, commandNodes.length - 1)]!;
      edges.push({ id: randomId("edge"), from: source.id, to: outputNode.id });
    });
  }

  return { nodes, edges };
}

export const layOutCalAst = computeLayout;
export const layoutCalAst = computeLayout;
