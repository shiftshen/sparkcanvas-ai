import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Command, Download, Save, Trash2, UserRound, Database, FileOutput } from "lucide-react";
import { parseCalPrompt, summarizeCal } from "../../../packages/ai-design-language/src/index";
import {
  layoutCalAst,
  type WorkflowCanvasEdge,
  type WorkflowCanvasNode,
  type WorkflowCanvasNodeType
} from "../../../packages/cal-canvas-bridge/src/index";
import "./workflow-canvas.css";

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

function buildNodesFromPrompt(prompt: string, baseX = 80, baseY = 72) {
  const parsed = parseCalPrompt(prompt);
  const { nodes, edges } = layoutCalAst(parsed, {
    startX: baseX,
    startY: baseY,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    gapX: NODE_GAP_X,
    gapY: NODE_GAP_Y
  });

  return { nodes, edges, parsed };
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

type CanvasMode = "select" | "connect";

export function WorkflowCanvas() {
  const [state, setState] = useState<SavedCanvasState>(() => loadState());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(state.selectedNodeId ?? null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [mode, setMode] = useState<CanvasMode>("select");
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const selectedNode = useMemo(() => state.nodes.find((node) => node.id === selectedNodeId) ?? null, [state.nodes, selectedNodeId]);
  const parsedPrompt = useMemo(() => parseCalPrompt(state.prompt), [state.prompt]);
  const summary = useMemo(() => summarizeCal(parsedPrompt), [parsedPrompt]);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMode("select");
        setConnectFromId(null);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedNodeId) {
        event.preventDefault();
        setState((current) => {
          const nextNodes = current.nodes.filter((node) => node.id !== selectedNodeId);
          const nextEdges = current.edges.filter((edge) => edge.from !== selectedNodeId && edge.to !== selectedNodeId);
          const nextSelectedNodeId = nextNodes[0]?.id ?? null;
          setSelectedNodeId(nextSelectedNodeId);
          if (!nextSelectedNodeId) {
            setMode("select");
            setConnectFromId(null);
          }
          return {
            ...current,
            nodes: nextNodes,
            edges: nextEdges,
            selectedNodeId: nextSelectedNodeId,
            nextX: nextNodes.length ? Math.max(80, ...nextNodes.map((node: WorkflowCanvasNode) => node.x + node.width)) + NODE_GAP_X : 80,
            nextY: nextNodes.length ? Math.max(72, ...nextNodes.map((node: WorkflowCanvasNode) => node.y + node.height)) : 72
          };
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNodeId, state.nodes]);

  function applyPrompt(prompt: string) {
    const { nodes, edges } = buildNodesFromPrompt(prompt, 80, 72);
    const nextX = Math.max(80, ...nodes.map((node: WorkflowCanvasNode) => node.x + node.width)) + NODE_GAP_X;
    const nextY = Math.max(72, ...nodes.map((node: WorkflowCanvasNode) => node.y + node.height));
    setState((current) => ({
      ...current,
      prompt,
      nodes,
      edges,
      selectedNodeId: nodes[0]?.id ?? null,
      nextX,
      nextY
    }));
    setSelectedNodeId(nodes[0]?.id ?? null);
  }

  function addNode(type: WorkflowCanvasNodeType) {
    const presets: Record<WorkflowCanvasNodeType, Pick<WorkflowCanvasNode, "label" | "title" | "body">> = {
      agent: { label: "@agent", title: "Agent node", body: "agentName" },
      command: { label: "/command", title: "Command node", body: "commandName" },
      resource: { label: "$brand.logo", title: "Resource node", body: "brand · logo" },
      output: { label: "-> jpg", title: "Output target", body: "jpg" }
    };
    const node: WorkflowCanvasNode = {
      id: uid(type),
      type,
      ...presets[type],
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
    setMode("select");
    setConnectFromId(null);
    setSelectedNodeId(node.id);
  }

  function updateSelectedNode(patch: Partial<WorkflowCanvasNode>) {
    if (!selectedNodeId) return;
    setState((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } : node)
    }));
  }

  function connectNodes(fromId: string, toId: string) {
    if (fromId === toId) return;
    setState((current) => {
      if (current.edges.some((edge) => edge.from === fromId && edge.to === toId)) return current;
      return {
        ...current,
        edges: [...current.edges, { id: uid("edge"), from: fromId, to: toId }]
      };
    });
  }

  function beginConnect(nodeId: string) {
    setMode("connect");
    setConnectFromId(nodeId);
    setSelectedNodeId(nodeId);
  }

  function finishConnect(nodeId: string) {
    if (!connectFromId || connectFromId === nodeId) return;
    connectNodes(connectFromId, nodeId);
    setMode("select");
    setConnectFromId(null);
  }

  function cancelConnect() {
    setMode("select");
    setConnectFromId(null);
  }

  function saveToLocalStorage() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, selectedNodeId }));
  }

  function resetCanvas() {
    const next = defaultState();
    setState(next);
    setSelectedNodeId(null);
    setMode("select");
    setConnectFromId(null);
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
    <section className={`sc-workflow-canvas ${mode === "connect" ? "connect-mode" : ""}`}>
      <header className="sc-workflow-header">
        <div>
          <strong>Workflow Canvas</strong>
          <small>{summary || "CAL workflow editor"}</small>
        </div>
        <div className="sc-workflow-actions">
          <button type="button" onClick={() => addNode("agent")}><UserRound /> Agent</button>
          <button type="button" onClick={() => addNode("command")}><Command /> Command</button>
          <button type="button" onClick={() => addNode("resource")}><Database /> Resource</button>
          <button type="button" onClick={() => addNode("output")}><FileOutput /> Output</button>
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
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  applyPrompt(state.prompt);
                }
              }}
              placeholder="Write a CAL prompt like @agent /command -> output"
            />
            <div className="sc-workflow-composer-actions">
              <button type="button" onClick={() => applyPrompt(state.prompt)}><Check /> Auto-Layout</button>
              <button type="button" onClick={() => (mode === "connect" ? cancelConnect() : setMode("connect"))}>{mode === "connect" ? "Cancel Connect" : "Connect Mode"}</button>
              <span>{summary || "No CAL tokens yet"}</span>
            </div>
          </div>

          <div ref={stageRef} className="sc-workflow-stage" onPointerDown={() => { if (mode === "connect") cancelConnect(); }}>
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
              {mode === "connect" && connectFromId && (() => {
                const from = state.nodes.find((node) => node.id === connectFromId);
                if (!from) return null;
                const x1 = from.x + from.width;
                const y1 = from.y + from.height / 2;
                return <path d={`M ${x1} ${y1} C ${x1 + 90} ${y1}, ${x1 + 120} ${y1}, ${x1 + 160} ${y1}`} markerEnd="url(#sc-workflow-arrow)" className="connect-preview" />;
              })()}
            </svg>

            {state.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`sc-workflow-node ${node.type} ${node.id === selectedNodeId ? "selected" : ""}`}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                onClick={() => {
                  if (mode === "connect" && connectFromId) {
                    finishConnect(node.id);
                  } else {
                    setSelectedNodeId(node.id);
                  }
                }}
                onDoubleClick={() => beginConnect(node.id)}
                onPointerDown={(event) => {
                  setSelectedNodeId(node.id);
                  if (mode === "connect") {
                    setConnectFromId((current) => current ?? node.id);
                    event.preventDefault();
                    return;
                  }
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setDragging({ id: node.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top });
                  event.preventDefault();
                }}
              >
                <span className="sc-workflow-node-type">{node.type === "agent" ? "@" : node.type === "command" ? "/" : node.type === "resource" ? "$" : "->"}</span>
                <strong>{node.label}</strong>
                <small>{node.title}</small>
                <p>{node.body}</p>
              </button>
            ))}
          </div>
        </div>

        <aside className="sc-workflow-sidebar">
          <strong>Properties</strong>
          <small>{mode === "connect" ? `Connect from ${connectFromId ?? "..."} then click a target` : "Select a node to edit its properties."}</small>
          <div className="sc-workflow-sidebar-meta">
            <span>{parsedPrompt.resources.length} resources</span>
            <span>{parsedPrompt.outputs.length} outputs</span>
            <span>{parsedPrompt.warnings.length} warnings</span>
          </div>
          {selectedNode ? (
            <>
              <div className="sc-workflow-sidebar-section">
                <button type="button" onClick={() => beginConnect(selectedNode.id)}>Start Connect</button>
                <button type="button" onClick={() => setState((current) => ({
                  ...current,
                  edges: current.edges.filter((edge) => edge.from !== selectedNode.id && edge.to !== selectedNode.id)
                }))}>Clear Links</button>
              </div>
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

          <div className="sc-workflow-sidebar-section">
            <strong>CAL diagnostics</strong>
            <button type="button" onClick={() => cancelConnect()} disabled={mode !== "connect"}>Exit connect mode</button>
            {parsedPrompt.warnings.length ? (
              <ul>
                {parsedPrompt.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : (
              <p>No parser warnings.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default WorkflowCanvas;
