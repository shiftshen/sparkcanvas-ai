import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Command, Download, Plus, Save, Trash2, UserRound } from "lucide-react";
import { parseCalPrompt, summarizeCal } from "@sparkcanvas/ai-design-language";
import "./workflow-canvas.css";

type WorkflowCanvasNodeType = "agent" | "command";

type WorkflowCanvasNode = {
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

type WorkflowCanvasEdge = {
  id: string;
  from: string;
  to: string;
};

type SavedCanvasState = {
  prompt: string;
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  selectedNodeId: string | null;
  nextX: number;
  nextY: number;
};

const STORAGE_KEY = "sparkcanvas.workflow-canvas.v1";
const NODE_WIDTH = 220;
const NODE_HEIGHT = 112;
const NODE_GAP_X = 260;
const NODE_GAP_Y = 160;

const defaultState = (): SavedCanvasState => ({
  prompt: "@imgen /generate-poster 使用 $logo $product -> JPG",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nextX: 80,
  nextY: 72
});

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNodeSequence(prompt: string) {
  const normalized = prompt.replace(/\r\n?/g, "\n").trim();
  const tokens = Array.from(normalized.matchAll(/(^|\s)(@([\p{L}\p{N}_-]+)|\/([\p{L}\p{N}_-]+))/gu));
  return tokens.map((match, index) => {
    const agent = match[3];
    const command = match[4];
    return agent
      ? { id: `agent_${index}`, type: "agent" as const, label: `@${agent}`, title: `Agent ${agent}`, body: agent }
      : { id: `command_${index}`, type: "command" as const, label: `/${command}`, title: `Command ${command}`, body: command ?? "" };
  });
}

function buildNodesFromPrompt(prompt: string, baseX = 80, baseY = 72) {
  const parsed = parseCalPrompt(prompt);
  const sequence = parseNodeSequence(prompt);
  const nodes: WorkflowCanvasNode[] = sequence.length
    ? sequence.map((item, index) => ({
        id: uid(item.type),
        type: item.type,
        label: item.label,
        title: item.title,
        body: item.body,
        x: baseX + index * NODE_GAP_X,
        y: baseY + (index % 2) * 22,
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      }))
    : [
        {
          id: uid("command"),
          type: "command",
          label: "/prompt",
          title: "Command prompt",
          body: parsed.normalizedPrompt,
          x: baseX,
          y: baseY,
          width: NODE_WIDTH,
          height: NODE_HEIGHT
        }
      ];

  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ id: uid("edge"), from: nodes[index]?.id ?? nodes[0].id, to: node.id })),
    parsed
  };
}

function loadState(): SavedCanvasState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<SavedCanvasState>;
    return {
      ...defaultState(),
      ...parsed,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch {
    return defaultState();
  }
}

export function WorkflowCanvas() {
  const [state, setState] = useState<SavedCanvasState>(() => loadState());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(state.selectedNodeId ?? null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const selectedNode = useMemo(() => state.nodes.find((node) => node.id === selectedNodeId) ?? null, [state.nodes, selectedNodeId]);
  const summary = useMemo(() => summarizeCal(parseCalPrompt(state.prompt)), [state.prompt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, selectedNodeId }));
  }, [state, selectedNodeId]);

  useEffect(() => {
    if (!dragging) return;
    const currentDragging = dragging;
    function onMove(event: PointerEvent) {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp(event.clientX - rect.left - currentDragging.offsetX, 0, Math.max(0, rect.width - NODE_WIDTH));
      const y = clamp(event.clientY - rect.top - currentDragging.offsetY, 0, Math.max(0, rect.height - NODE_HEIGHT));
      setState((current) => ({
        ...current,
        nodes: current.nodes.map((node) => node.id === currentDragging.id ? { ...node, x, y } : node)
      }));
    }
    function onUp() {
      setDragging(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  function applyPrompt(prompt: string) {
    const { nodes, edges } = buildNodesFromPrompt(prompt, 80, 72);
    setState((current) => ({
      ...current,
      prompt,
      nodes,
      edges,
      selectedNodeId: nodes[0]?.id ?? null,
      nextX: 80,
      nextY: 72
    }));
    setSelectedNodeId(nodes[0]?.id ?? null);
  }

  function addNode(type: WorkflowCanvasNodeType) {
    const node: WorkflowCanvasNode = {
      id: uid(type),
      type,
      label: type === "agent" ? "@agent" : "/command",
      title: type === "agent" ? "Agent node" : "Command node",
      body: type === "agent" ? "agentName" : "commandName",
      x: state.nextX,
      y: state.nextY,
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    };
    const nextNodes = [...state.nodes, node];
    const nextEdges = state.nodes.length ? [...state.edges, { id: uid("edge"), from: state.nodes[state.nodes.length - 1].id, to: node.id }] : state.edges;
    setState((current) => ({
      ...current,
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeId: node.id,
      nextX: current.nextX + NODE_GAP_X,
      nextY: current.nextY
    }));
    setSelectedNodeId(node.id);
  }

  function updateSelectedNode(patch: Partial<WorkflowCanvasNode>) {
    if (!selectedNodeId) return;
    setState((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } : node)
    }));
  }

  function saveToLocalStorage() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, selectedNodeId }));
  }

  function resetCanvas() {
    const next = defaultState();
    setState(next);
    setSelectedNodeId(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ ...state, selectedNodeId }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "sparkcanvas-workflow.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="sc-workflow-canvas">
      <header className="sc-workflow-header">
        <div>
          <strong>Workflow Canvas</strong>
          <small>{summary || "CAL workflow editor"}</small>
        </div>
        <div className="sc-workflow-actions">
          <button type="button" onClick={() => addNode("agent")}><UserRound /> Agent</button>
          <button type="button" onClick={() => addNode("command")}><Command /> Command</button>
          <button type="button" onClick={saveToLocalStorage}><Save /> Save</button>
          <button type="button" onClick={exportJson}><Download /> Export</button>
          <button type="button" onClick={resetCanvas}><Trash2 /> Reset</button>
        </div>
      </header>

      <div className="sc-workflow-body">
        <div className="sc-workflow-main">
          <div className="sc-workflow-composer">
            <textarea
              value={state.prompt}
              onChange={(event) => setState((current) => ({ ...current, prompt: event.target.value }))}
              placeholder="Write a CAL prompt like @agent /command -> output"
            />
            <div className="sc-workflow-composer-actions">
              <button type="button" onClick={() => applyPrompt(state.prompt)}><Check /> Parse CAL</button>
              <span>{summary || "No CAL tokens yet"}</span>
            </div>
          </div>

          <div ref={stageRef} className="sc-workflow-stage">
            <svg className="sc-workflow-lines" viewBox={`0 0 ${Math.max(1200, state.nextX + 400)} ${Math.max(800, state.nextY + 400)}`} aria-hidden="true">
              <defs>
                <marker id="sc-workflow-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L10,5 L0,10 z" />
                </marker>
              </defs>
              {state.edges.map((edge) => {
                const from = state.nodes.find((node) => node.id === edge.from);
                const to = state.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                const x1 = from.x + from.width;
                const y1 = from.y + from.height / 2;
                const x2 = to.x;
                const y2 = to.y + to.height / 2;
                const mid = x1 + Math.max(70, (x2 - x1) / 2);
                return <path key={edge.id} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} markerEnd="url(#sc-workflow-arrow)" />;
              })}
            </svg>

            {state.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`sc-workflow-node ${node.type} ${node.id === selectedNodeId ? "selected" : ""}`}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                onClick={() => setSelectedNodeId(node.id)}
                onPointerDown={(event) => {
                  setSelectedNodeId(node.id);
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setDragging({ id: node.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top });
                  event.preventDefault();
                }}
              >
                <span className="sc-workflow-node-type">{node.type === "agent" ? "@" : "/"}</span>
                <strong>{node.label}</strong>
                <small>{node.title}</small>
                <p>{node.body}</p>
              </button>
            ))}
          </div>
        </div>

        <aside className="sc-workflow-sidebar">
          <strong>Properties</strong>
          {selectedNode ? (
            <>
              <label>
                Label
                <input value={selectedNode.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} />
              </label>
              <label>
                Title
                <input value={selectedNode.title} onChange={(event) => updateSelectedNode({ title: event.target.value })} />
              </label>
              <label>
                Body
                <textarea value={selectedNode.body} onChange={(event) => updateSelectedNode({ body: event.target.value })} />
              </label>
              <label>
                X
                <input type="number" value={Math.round(selectedNode.x)} onChange={(event) => updateSelectedNode({ x: Number(event.target.value) })} />
              </label>
              <label>
                Y
                <input type="number" value={Math.round(selectedNode.y)} onChange={(event) => updateSelectedNode({ y: Number(event.target.value) })} />
              </label>
            </>
          ) : (
            <p>Select a node to edit its properties.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

export default WorkflowCanvas;
