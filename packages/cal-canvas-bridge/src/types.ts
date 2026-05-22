export type WorkflowCanvasNodeType = "agent" | "command" | "resource" | "output";

export type WorkflowCanvasNode = {
  id: string;
  type: WorkflowCanvasNodeType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  body: string;
};

export type WorkflowCanvasEdge = {
  id: string;
  from: string;
  to: string;
};

export type WorkflowCanvasLayoutResult = {
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
};
