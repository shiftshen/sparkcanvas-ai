import React, { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseCalPrompt, summarizeCal } from "@sparkcanvas/ai-design-language";
import {
  Archive,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileImage,
  Film,
  FolderOpen,
  Layers3,
  Library,
  Loader2,
  Maximize2,
  PanelRight,
  Play,
  Plus,
  RefreshCcw,
  Scissors,
  Search,
  Send,
  Sparkles,
  Upload,
  Wand2,
  Pencil
} from "lucide-react";
import "./styles.css";

type MaterialKind = "image" | "video" | "document" | "audio";
type WorkflowStatus = "ready" | "queued" | "running" | "done";

type Material = {
  id: string;
  title: string;
  kind: MaterialKind;
  token: string;
  previewUrl: string;
  fileName: string;
  size: number;
  createdAt: string;
  tags: string[];
  note: string;
};

type SkillTemplate = {
  id: string;
  title: string;
  command: string;
  output: string;
  description: string;
  icon: "image" | "compose" | "video" | "archive";
  keywords: string[];
  nodeType: WorkflowNode["type"];
  capabilityType: "image_generation" | "composition" | "video_planning" | "archive" | "custom";
  inputs: string[];
  outputs: string[];
  runtime: "pi-skill" | "local-simulated" | "api";
  skillMdPath: string;
  version: string;
  evolution: {
    status: "seed" | "created" | "candidate" | "validated";
    runCount: number;
    successCount: number;
    failureCount: number;
    lastRunAt?: string;
    testPlan: string[];
  };
};

type WorkflowNode = {
  id: string;
  title: string;
  type: "goal" | "brand" | "material" | "skill" | "model" | "compose" | "output" | "video" | "file" | "review";
  body: string;
  x: number;
  y: number;
  materialIds?: string[];
  status: WorkflowStatus;
};

type Job = {
  id: string;
  title: string;
  status: WorkflowStatus;
  output: string;
  materials: string[];
  createdAt: string;
};

type ResultObject = {
  id: string;
  title: string;
  workflowId: string;
  nodeId: string;
  kind: "image" | "video" | "document" | "archive";
  status: "preview" | "accepted" | "rejected" | "archived";
  version: number;
  output: string;
  previewUrl: string;
  sourceJobId: string;
  materialIds: string[];
  canSaveAsMaterial: boolean;
  savedMaterialId?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
};

type BrandMemory = {
  id: string;
  name: string;
  positioning: string;
  colors: string;
  audience: string;
  rules: string[];
};

type ModelOption = {
  id: string;
  name: string;
  kind: "image" | "video" | "text" | "local";
  cost: string;
  speed: string;
  quality: string;
  status: "ready" | "fallback" | "offline";
  provider: "openai-compatible" | "local" | "video-api";
  capabilities: Array<"image" | "video" | "text" | "local" | "reference_image" | "composition">;
  route: string;
  costTier: "low" | "medium" | "high";
  latencyTier: "fast" | "medium" | "slow";
  fallbackModelIds: string[];
  nodeAffinity: WorkflowNode["type"][];
  routingRules: string[];
};

type FeedbackObject = {
  id: string;
  targetId: string;
  targetType: "workflow" | "skill" | "result" | "model" | "brand" | "node";
  rating: "accepted" | "needs_revision" | "failed";
  action: "reuse" | "revise" | "avoid";
  note: string;
  memoryId?: string;
  sourceResultId?: string;
  sourceWorkflowId?: string;
  createdAt: string;
};

type MemoryObject = {
  id: string;
  title: string;
  source: "feedback" | "run" | "manual";
  sourceType?: "feedback" | "result" | "workflow" | "node" | "skill";
  sourceId?: string;
  targetType?: FeedbackObject["targetType"];
  targetId?: string;
  confidence: number;
  reusable: boolean;
  body: string;
  createdAt: string;
};

type GoalType = "brand_design" | "image_generation" | "video_generation" | "skill_creation" | "asset_archive" | "workflow_automation";

type GoalObject = {
  id: string;
  title: string;
  rawInput: string;
  normalizedIntent: string;
  goalType: GoalType;
  brandId: string;
  outputTarget: string;
  constraints: string[];
  successCriteria: string[];
  createdAt: string;
  updatedAt: string;
};

type WorkflowObject = {
  id: string;
  title: string;
  goalId: string;
  version: string;
  status: "draft" | "ready" | "running" | "completed";
  reusable: boolean;
  prompt: string;
  nodeIds: string[];
  edgeIds: string[];
  selectedMaterialIds: string[];
  skillIds: string[];
  modelIds: string[];
  resultIds: string[];
  runCount: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

type WorkGraphWorkspace = {
  version: 1;
  goal: GoalObject;
  workflow: WorkflowObject;
  materials: Material[];
  skills: SkillTemplate[];
  nodes: WorkflowNode[];
  activeBrandId: string;
  activeModelId: string;
  selectedIds: string[];
  prompt: string;
  activeMaterialId: string;
  jobs: Job[];
  results: ResultObject[];
  feedback: FeedbackObject[];
  memories: MemoryObject[];
};

type WorkGraphObject = {
  id: string;
  type: "goal" | "asset" | "brand" | "skill" | "model" | "workflow" | "node" | "result" | "feedback" | "memory";
  title: string;
  summary: string;
  source: "workspace" | "derived";
  updatedAt: string;
};

type WorkGraphObjectIndex = {
  counts: Record<string, number>;
  objects: WorkGraphObject[];
};

type WorkGraphHistoryEntry = {
  id: string;
  createdAt: string;
  reason: "workspace-save" | "manual";
  prompt: string;
  counts: Record<string, number>;
  objectIds: string[];
};

type StorageState = "browser-local" | "memory-only";
type StorageMode = StorageState | "filesystem-json";

const now = () => new Date().toISOString();

const seedMaterials: Material[] = [
  {
    id: "mat-x-logo",
    title: "XMANX Logo",
    kind: "image",
    token: "$xmanx.logo",
    previewUrl: "/brand-assets/generated/xmanx-logo.png",
    fileName: "xmanx-logo.png",
    size: 896371,
    createdAt: now(),
    tags: ["logo", "brand", "transparent"],
    note: "品牌角标、片尾、工作流水印。"
  },
  {
    id: "mat-product",
    title: "Black orange product hero",
    kind: "image",
    token: "$xmanx.product",
    previewUrl: "/brand-assets/generated/xmanx-product.png",
    fileName: "xmanx-product.png",
    size: 1204572,
    createdAt: now(),
    tags: ["product", "reference"],
    note: "商品主图参考，适合 poster 和视频首帧。"
  },
  {
    id: "mat-ip",
    title: "XM Navigator IP",
    kind: "image",
    token: "$xmanx.ip",
    previewUrl: "/brand-assets/generated/xmanx-ip.png",
    fileName: "xmanx-ip.png",
    size: 1012844,
    createdAt: now(),
    tags: ["ip", "character"],
    note: "品牌助理 IP，用于教程和脚本工作流。"
  }
];

const skillTemplates: SkillTemplate[] = [
  {
    id: "poster",
    title: "素材生成海报",
    command: "/generate-poster",
    output: "PNG",
    description: "引用图片素材，生成可预览海报或封面图。",
    icon: "image",
    keywords: ["图片", "海报", "封面", "poster", "image", "png", "jpg"],
    nodeType: "output",
    capabilityType: "image_generation",
    inputs: ["Goal Object", "Asset Object", "Brand Object", "Model Object"],
    outputs: ["Result Object: PNG/JPG", "Memory Object: reusable prompt pattern"],
    runtime: "api",
    skillMdPath: "skills/generated/generate-poster/SKILL.md",
    version: "0.1.0",
    evolution: { status: "seed", runCount: 0, successCount: 0, failureCount: 0, testPlan: ["resolve image references", "generate preview image", "save result as asset"] }
  },
  {
    id: "compose",
    title: "素材合成",
    command: "/compose",
    output: "PNG",
    description: "把多张素材按主题合成统一画面。",
    icon: "compose",
    keywords: ["合成", "融合", "compose", "merge", "mix"],
    nodeType: "compose",
    capabilityType: "composition",
    inputs: ["Goal Object", "2+ Asset Objects", "Brand Object"],
    outputs: ["Result Object: composed visual", "Workflow Object: reusable composition graph"],
    runtime: "local-simulated",
    skillMdPath: "skills/generated/compose-materials/SKILL.md",
    version: "0.1.0",
    evolution: { status: "seed", runCount: 0, successCount: 0, failureCount: 0, testPlan: ["validate selected materials", "compose preview", "record review feedback"] }
  },
  {
    id: "story",
    title: "图生视频规划",
    command: "/generate-video",
    output: "MP4",
    description: "把素材作为首帧/参考图，生成视频任务规划。",
    icon: "video",
    keywords: ["视频", "首帧", "分镜", "video", "mp4", "storyboard"],
    nodeType: "video",
    capabilityType: "video_planning",
    inputs: ["Goal Object", "First-frame Asset Object", "Brand Object", "Model Object"],
    outputs: ["Result Object: storyboard", "Result Object: MP4 plan"],
    runtime: "api",
    skillMdPath: "skills/generated/generate-video/SKILL.md",
    version: "0.1.0",
    evolution: { status: "seed", runCount: 0, successCount: 0, failureCount: 0, testPlan: ["materialize public input reference", "create video job", "verify playable mp4"] }
  },
  {
    id: "kit",
    title: "素材归档",
    command: "/build-kit",
    output: "ZIP",
    description: "把当前素材、提示词和输出整理成项目包。",
    icon: "archive",
    keywords: ["文件", "归档", "zip", "kit", "素材包", "导出"],
    nodeType: "file",
    capabilityType: "archive",
    inputs: ["Workflow Object", "Asset Objects", "Result Objects", "Memory Objects"],
    outputs: ["Result Object: project kit archive"],
    runtime: "pi-skill",
    skillMdPath: "skills/generated/build-kit/SKILL.md",
    version: "0.1.0",
    evolution: { status: "seed", runCount: 0, successCount: 0, failureCount: 0, testPlan: ["collect graph objects", "write manifest", "verify archive contents"] }
  }
];

const brandMemories: BrandMemory[] = [
  {
    id: "dapot",
    name: "DAPOT",
    positioning: "年轻、干净、国际自助火锅，新店开业和社媒推广优先。",
    colors: "红、金、深灰",
    audience: "女性、年轻人、爱拍照、注重干净可信的门店体验。",
    rules: ["文字少", "画面干净", "不要廉价感", "保持红金深灰体系", "适配 TikTok / Facebook / 门店屏幕"]
  },
  {
    id: "xmanx",
    name: "XMANX",
    positioning: "AI-native brand operation and ecommerce creative workflow.",
    colors: "black, white, orange",
    audience: "品牌运营、设计、投放和内容生产团队。",
    rules: ["商品层级清晰", "黑橙强调", "避免杂乱", "保留可复用素材变量"]
  }
];

const modelOptions: ModelOption[] = [
  {
    id: "gpt-image",
    name: "GPT Image / cloud",
    kind: "image",
    cost: "高",
    speed: "中",
    quality: "高",
    status: "fallback",
    provider: "openai-compatible",
    capabilities: ["image", "reference_image"],
    route: "/v1/images/generations",
    costTier: "high",
    latencyTier: "medium",
    fallbackModelIds: ["imgen"],
    nodeAffinity: ["output", "compose"],
    routingRules: ["use when final visual quality matters", "fallback to imgen when unavailable"]
  },
  {
    id: "imgen",
    name: "@imgen gpt-5.4",
    kind: "image",
    cost: "中",
    speed: "中",
    quality: "中高",
    status: "ready",
    provider: "openai-compatible",
    capabilities: ["image", "reference_image", "composition"],
    route: "/v1/responses image_generation",
    costTier: "medium",
    latencyTier: "medium",
    fallbackModelIds: ["gpt-image", "local-flux"],
    nodeAffinity: ["skill", "compose", "output"],
    routingRules: ["default image/composition route", "keep brand references attached"]
  },
  {
    id: "kling",
    name: "Kling / 可灵",
    kind: "video",
    cost: "高",
    speed: "慢",
    quality: "高",
    status: "fallback",
    provider: "video-api",
    capabilities: ["video", "reference_image"],
    route: "/v1/videos",
    costTier: "high",
    latencyTier: "slow",
    fallbackModelIds: ["imgen"],
    nodeAffinity: ["video"],
    routingRules: ["use for final video nodes", "requires public input reference"]
  },
  {
    id: "local-flux",
    name: "Local Flux",
    kind: "local",
    cost: "低",
    speed: "中",
    quality: "中高",
    status: "offline",
    provider: "local",
    capabilities: ["image", "local"],
    route: "ollama/local-image",
    costTier: "low",
    latencyTier: "medium",
    fallbackModelIds: ["imgen"],
    nodeAffinity: ["compose", "output"],
    routingRules: ["use when local privacy is preferred", "fallback to imgen until local runtime is online"]
  }
];

const defaultPrompt = "@imgen /compose 使用 $xmanx.logo $xmanx.product，生成黑橙品牌首图 -> PNG";
const workspaceStorageKey = "workgraph-os.workspace.v1";
const authStorageKey = "workgraph-os.auth-token";

function interpretGoal(rawInput: string, brandId = "dapot", previous?: GoalObject): GoalObject {
  const text = rawInput.trim() || defaultPrompt;
  const lower = text.toLowerCase();
  const goalType: GoalType = /视频|mp4|tiktok|reel|short/i.test(text)
    ? "video_generation"
    : /skill|能力|沉淀|创建/i.test(text)
      ? "skill_creation"
      : /归档|zip|素材包|archive/i.test(text)
        ? "asset_archive"
        : /流程|自动|workflow|执行/i.test(text)
          ? "workflow_automation"
          : /海报|图片|png|jpg|封面|image|poster/i.test(text)
            ? "image_generation"
            : "brand_design";
  const outputTarget = /mp4|视频|tiktok|reel|short/i.test(text)
    ? "mp4"
    : /pdf|教材|文档/i.test(text)
      ? "pdf"
      : /zip|素材包|archive/i.test(text)
        ? "zip"
        : /jpg|jpeg/i.test(text)
          ? "jpg"
          : "png";
  const constraints = [
    lower.includes("thai") || text.includes("泰") ? "language: Thai-first" : "",
    text.includes("年轻") || lower.includes("young") ? "audience: young users" : "",
    text.includes("女性") || lower.includes("female") ? "audience: female users" : "",
    text.includes("品牌") || lower.includes("brand") ? "preserve brand memory" : "",
    text.includes("开业") || lower.includes("launch") ? "campaign: opening launch" : ""
  ].filter(Boolean);
  const title = text.replace(/^@[\w.-]+\s+/, "").replace(/\s+/g, " ").slice(0, 48) || "Untitled goal";
  const timestamp = now();
  return {
    id: previous?.id ?? `goal-${Date.now().toString(36)}`,
    title,
    rawInput: text,
    normalizedIntent: `${goalType} -> ${outputTarget} using brand:${brandId}`,
    goalType,
    brandId,
    outputTarget,
    constraints: constraints.length ? constraints : ["preserve selected materials", "keep result reusable"],
    successCriteria: [
      "Work graph shows goal, brand, material, skill, model, output and review nodes.",
      `Result can be reviewed as ${outputTarget.toUpperCase()} and saved back as reusable material.`,
      "Feedback can be recorded into Memory Objects for future runs."
    ],
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

function buildWorkflowObject(input: {
  prompt: string;
  goal: GoalObject;
  nodes: WorkflowNode[];
  selectedIds: string[];
  skills: SkillTemplate[];
  activeModelId: string;
  jobs: Job[];
  previous?: WorkflowObject;
}): WorkflowObject {
  const timestamp = now();
  const nodeIds = input.nodes.map((node) => node.id);
  const edgeIds = input.nodes.slice(1).map((node, index) => `${input.nodes[index].id}->${node.id}`);
  return {
    id: input.previous?.id ?? "workflow-active",
    title: input.goal.title || "Active workflow",
    goalId: input.goal.id,
    version: input.previous?.version ?? "0.1.0",
    status: input.jobs.some((job) => job.status === "running") ? "running" : input.jobs.some((job) => job.status === "done") ? "completed" : "ready",
    reusable: input.skills.some((skill) => skill.evolution.runCount > 0 || skill.evolution.status !== "seed"),
    prompt: input.prompt,
    nodeIds,
    edgeIds,
    selectedMaterialIds: input.selectedIds,
    skillIds: input.skills.map((skill) => skill.id),
    modelIds: [input.activeModelId],
    resultIds: input.jobs.map((job) => `result-${job.id}`),
    runCount: input.previous?.runCount ?? input.jobs.length,
    lastRunAt: input.jobs[0]?.createdAt ?? input.previous?.lastRunAt,
    createdAt: input.previous?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

function resultKindForOutput(output: string): ResultObject["kind"] {
  const normalized = output.toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("video")) return "video";
  if (normalized.includes("zip") || normalized.includes("archive")) return "archive";
  if (normalized.includes("pdf") || normalized.includes("doc")) return "document";
  return "image";
}

function buildResultObject(job: Job, workflowId: string, previous?: ResultObject): ResultObject {
  const timestamp = now();
  const kind = resultKindForOutput(job.output);
  return {
    id: previous?.id ?? `result-${job.id}`,
    title: `${job.title} -> ${job.output}`,
    workflowId,
    nodeId: "output",
    kind,
    status: previous?.status ?? (job.status === "done" ? "preview" : "preview"),
    version: previous?.version ?? 1,
    output: job.output,
    previewUrl: previous?.previewUrl ?? (kind === "image" ? "/brand-assets/generated/xmanx-product.png" : ""),
    sourceJobId: job.id,
    materialIds: job.materials,
    canSaveAsMaterial: kind === "image" || kind === "video" || kind === "document",
    savedMaterialId: previous?.savedMaterialId,
    reviewNote: previous?.reviewNote,
    createdAt: previous?.createdAt ?? job.createdAt,
    updatedAt: timestamp
  };
}

const defaultWorkspace = (): WorkGraphWorkspace => {
  const goal = interpretGoal(defaultPrompt, "dapot");
  const nodes: WorkflowNode[] = [];
  const jobs: Job[] = [];
  return {
    version: 1,
    goal,
    workflow: buildWorkflowObject({
      prompt: defaultPrompt,
      goal,
      nodes,
      selectedIds: ["mat-x-logo", "mat-product"],
      skills: skillTemplates,
      activeModelId: "imgen",
      jobs
    }),
    materials: seedMaterials,
    skills: skillTemplates,
    nodes,
    activeBrandId: "dapot",
    activeModelId: "imgen",
    selectedIds: ["mat-x-logo", "mat-product"],
    prompt: defaultPrompt,
    activeMaterialId: seedMaterials[0].id,
    jobs,
    results: [],
    feedback: [],
    memories: [
      {
        id: "mem-wgos-principle",
        title: "WGOS product rule",
        source: "manual",
        sourceType: "workflow",
        sourceId: "workflow-active",
        confidence: 0.8,
        reusable: true,
        body: "用户定义目标，系统组织工作图谱，用户判断结果，系统沉淀能力。",
        createdAt: now()
      }
    ]
  };
};

function readStoredWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem(workspaceStorageKey) ?? null;
  } catch {
    return null;
  }
}

function detectStorageState(): StorageState {
  if (typeof window === "undefined") return "memory-only";
  try {
    const key = `${workspaceStorageKey}.probe`;
    window.localStorage?.setItem(key, "1");
    window.localStorage?.removeItem(key);
    return "browser-local";
  } catch {
    return "memory-only";
  }
}

function loadWorkspace(): WorkGraphWorkspace {
  try {
    const raw = readStoredWorkspace();
    if (!raw) return defaultWorkspace();
    const parsed = JSON.parse(raw) as Partial<WorkGraphWorkspace>;
    const goal = parsed.goal ?? interpretGoal(parsed.prompt ?? defaultPrompt, parsed.activeBrandId ?? "dapot");
    const skills = parsed.skills?.length ? parsed.skills.map(normalizeSkillObject) : skillTemplates;
    const nodes = parsed.nodes?.length ? parsed.nodes : [];
    const jobs = parsed.jobs ?? [];
    const results = parsed.results ?? jobs.map((job) => buildResultObject(job, parsed.workflow?.id ?? "workflow-active"));
    const feedback = parsed.feedback?.length ? parsed.feedback.map((item) => normalizeFeedbackObject({ ...item, id: item.id })) : [];
    const memories = parsed.memories?.length ? parsed.memories.map((item) => normalizeMemoryObject({ ...item, id: item.id })) : defaultWorkspace().memories;
    return {
      ...defaultWorkspace(),
      ...parsed,
      version: 1,
      goal,
      workflow: parsed.workflow ?? buildWorkflowObject({
        prompt: parsed.prompt ?? defaultPrompt,
        goal,
        nodes,
        selectedIds: parsed.selectedIds ?? ["mat-x-logo", "mat-product"],
        skills,
        activeModelId: parsed.activeModelId ?? "imgen",
        jobs
      }),
      materials: parsed.materials?.length ? parsed.materials : seedMaterials,
      skills,
      nodes,
      jobs,
      results,
      feedback,
      memories
    };
  } catch {
    return defaultWorkspace();
  }
}

function saveWorkspace(workspace: WorkGraphWorkspace) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(workspaceStorageKey, JSON.stringify(workspace));
  } catch {
    // Storage can be unavailable in restricted browser contexts. WGOS must keep running in memory.
  }
}

async function ensureBackendToken() {
  const stored = window.localStorage?.getItem(authStorageKey);
  if (stored) return stored;
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  if (!response.ok) throw new Error("backend auth unavailable");
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("backend auth token missing");
  window.localStorage?.setItem(authStorageKey, data.token);
  return data.token;
}

async function backendRequest(pathname: string, options: RequestInit = {}) {
  const token = await ensureBackendToken();
  return fetch(`/api${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {})
    }
  });
}

async function loadBackendWorkspace() {
  const response = await backendRequest("/workgraph-os/workspace");
  if (!response.ok) throw new Error("backend workspace unavailable");
  const data = await response.json() as { workspace?: Partial<WorkGraphWorkspace> | null; objectIndex?: WorkGraphObjectIndex };
  if (!data.workspace) return null;
  const goal = data.workspace.goal ?? interpretGoal(data.workspace.prompt ?? defaultPrompt, data.workspace.activeBrandId ?? "dapot");
  const skills = data.workspace.skills?.length ? data.workspace.skills.map(normalizeSkillObject) : skillTemplates;
  const nodes = data.workspace.nodes?.length ? data.workspace.nodes : [];
  const jobs = data.workspace.jobs ?? [];
  const results = data.workspace.results ?? jobs.map((job) => buildResultObject(job, data.workspace?.workflow?.id ?? "workflow-active"));
  const feedback = data.workspace.feedback?.length ? data.workspace.feedback.map((item) => normalizeFeedbackObject({ ...item, id: item.id })) : [];
  const memories = data.workspace.memories?.length ? data.workspace.memories.map((item) => normalizeMemoryObject({ ...item, id: item.id })) : defaultWorkspace().memories;
  return {
    workspace: {
      ...defaultWorkspace(),
      ...data.workspace,
      version: 1,
      goal,
      workflow: data.workspace.workflow ?? buildWorkflowObject({
        prompt: data.workspace.prompt ?? defaultPrompt,
        goal,
        nodes,
        selectedIds: data.workspace.selectedIds ?? ["mat-x-logo", "mat-product"],
        skills,
        activeModelId: data.workspace.activeModelId ?? "imgen",
        jobs
      }),
      materials: data.workspace.materials?.length ? data.workspace.materials : seedMaterials,
      skills,
      nodes,
      jobs,
      results,
      feedback,
      memories
    } satisfies WorkGraphWorkspace,
    objectIndex: data.objectIndex
  };
}

async function saveBackendWorkspace(workspace: WorkGraphWorkspace) {
  const goal = workspace.goal.rawInput === workspace.prompt && workspace.goal.brandId === workspace.activeBrandId
    ? workspace.goal
    : interpretGoal(workspace.prompt, workspace.activeBrandId, workspace.goal);
  const nodes = workspace.nodes.length ? workspace.nodes : buildNodes(
    workspace.prompt,
    workspace.materials,
    workspace.skills,
    brandMemories.find((item) => item.id === workspace.activeBrandId) ?? brandMemories[0],
    modelOptions.find((item) => item.id === workspace.activeModelId) ?? modelOptions[1]
  );
  const workflow = buildWorkflowObject({
    prompt: workspace.prompt,
    goal,
    nodes,
    selectedIds: workspace.selectedIds,
    skills: workspace.skills,
    activeModelId: workspace.activeModelId,
    jobs: workspace.jobs,
    previous: workspace.workflow
  });
  const response = await backendRequest("/workgraph-os/workspace", {
    method: "PUT",
    body: JSON.stringify({
      ...workspace,
      goal,
      workflow,
      nodes
    })
  });
  if (!response.ok) throw new Error("backend workspace save failed");
}

async function loadBackendHistory() {
  const response = await backendRequest("/workgraph-os/history?limit=5");
  if (!response.ok) throw new Error("backend history unavailable");
  const data = await response.json() as { entries?: WorkGraphHistoryEntry[] };
  return data.entries ?? [];
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function materialToken(fileName: string, existingCount: number) {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || `asset-${existingCount + 1}`;
  return `$local.${base}`;
}

function inferKind(file: File): MaterialKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return "document";
}

function normalizeSkillObject(skill: Partial<SkillTemplate> & Pick<SkillTemplate, "id" | "title" | "command">): SkillTemplate {
  const isVideo = /video|视频|mp4/i.test(`${skill.title} ${skill.command} ${skill.output ?? ""}`);
  const isArchive = /archive|归档|zip|kit/i.test(`${skill.title} ${skill.command} ${skill.output ?? ""}`);
  const capabilityType = skill.capabilityType ?? (isVideo ? "video_planning" : isArchive ? "archive" : skill.nodeType === "compose" ? "composition" : "custom");
  const output = skill.output ?? (isVideo ? "MP4" : isArchive ? "ZIP" : "PNG");
  return {
    id: skill.id,
    title: skill.title,
    command: skill.command,
    output,
    description: skill.description ?? "由一句话搜索自动创建，可继续编辑命令、输出和提示词。",
    icon: skill.icon ?? (isVideo ? "video" : isArchive ? "archive" : "image"),
    keywords: skill.keywords?.length ? skill.keywords : skill.title.split(/\s+/).filter(Boolean),
    nodeType: skill.nodeType ?? (isVideo ? "video" : isArchive ? "file" : "output"),
    capabilityType,
    inputs: skill.inputs?.length ? skill.inputs : ["Goal Object", "Asset Object", "Brand Object"],
    outputs: skill.outputs?.length ? skill.outputs : [`Result Object: ${output}`],
    runtime: skill.runtime ?? "pi-skill",
    skillMdPath: skill.skillMdPath ?? `skills/generated/${skill.command.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "-") || skill.id}/SKILL.md`,
    version: skill.version ?? "0.1.0",
    evolution: {
      status: skill.evolution?.status ?? "created",
      runCount: skill.evolution?.runCount ?? 0,
      successCount: skill.evolution?.successCount ?? 0,
      failureCount: skill.evolution?.failureCount ?? 0,
      lastRunAt: skill.evolution?.lastRunAt,
      testPlan: skill.evolution?.testPlan?.length ? skill.evolution.testPlan : ["run with selected materials", "verify output object", "record feedback memory"]
    }
  };
}

function normalizeModelObject(model: Partial<ModelOption> & Pick<ModelOption, "id" | "name" | "kind">): ModelOption {
  const isVideo = model.kind === "video";
  const isLocal = model.kind === "local";
  const costTier = model.costTier ?? (model.cost === "低" ? "low" : model.cost === "高" ? "high" : "medium");
  const latencyTier = model.latencyTier ?? (model.speed === "慢" ? "slow" : model.speed === "快" ? "fast" : "medium");
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    cost: model.cost ?? (costTier === "low" ? "低" : costTier === "high" ? "高" : "中"),
    speed: model.speed ?? (latencyTier === "slow" ? "慢" : latencyTier === "fast" ? "快" : "中"),
    quality: model.quality ?? "中高",
    status: model.status ?? (isLocal ? "offline" : "fallback"),
    provider: model.provider ?? (isLocal ? "local" : isVideo ? "video-api" : "openai-compatible"),
    capabilities: model.capabilities?.length ? model.capabilities : isVideo ? ["video", "reference_image"] : isLocal ? ["image", "local"] : ["image", "reference_image"],
    route: model.route ?? (isVideo ? "/v1/videos" : isLocal ? "ollama/local-image" : "/v1/responses image_generation"),
    costTier,
    latencyTier,
    fallbackModelIds: model.fallbackModelIds ?? (isLocal ? ["imgen"] : ["imgen", "local-flux"].filter((id) => id !== model.id)),
    nodeAffinity: model.nodeAffinity?.length ? model.nodeAffinity : isVideo ? ["video"] : ["skill", "compose", "output"],
    routingRules: model.routingRules?.length ? model.routingRules : ["match node capability first", "fallback by availability and cost"]
  };
}

function normalizeFeedbackObject(feedback: Partial<FeedbackObject> & Pick<FeedbackObject, "id">): FeedbackObject {
  const rating = feedback.rating ?? "needs_revision";
  return {
    id: feedback.id,
    targetId: feedback.targetId ?? feedback.sourceResultId ?? "workflow-active",
    targetType: feedback.targetType ?? (feedback.sourceResultId ? "result" : "workflow"),
    rating,
    action: feedback.action ?? (rating === "accepted" ? "reuse" : rating === "failed" ? "avoid" : "revise"),
    note: feedback.note ?? "",
    memoryId: feedback.memoryId,
    sourceResultId: feedback.sourceResultId,
    sourceWorkflowId: feedback.sourceWorkflowId,
    createdAt: feedback.createdAt ?? now()
  };
}

function normalizeMemoryObject(memory: Partial<MemoryObject> & Pick<MemoryObject, "id">): MemoryObject {
  return {
    id: memory.id,
    title: memory.title ?? "Memory Object",
    source: memory.source ?? "manual",
    sourceType: memory.sourceType,
    sourceId: memory.sourceId,
    targetType: memory.targetType,
    targetId: memory.targetId,
    confidence: memory.confidence ?? 0.5,
    reusable: memory.reusable ?? memory.source !== "run",
    body: memory.body ?? "",
    createdAt: memory.createdAt ?? now()
  };
}

function feedbackTargetForActiveNode(node: WorkflowNode, workspace: WorkGraphWorkspace) {
  const latestResult = workspace.results[0];
  if ((node.type === "output" || node.type === "review") && latestResult) {
    return { targetType: "result" as const, targetId: latestResult.id, sourceResultId: latestResult.id };
  }
  if (node.type === "skill") {
    return { targetType: "skill" as const, targetId: findMatchingSkill(workspace.prompt, workspace.skills).id };
  }
  if (node.type === "model") {
    return { targetType: "model" as const, targetId: workspace.activeModelId };
  }
  if (node.type === "brand") {
    return { targetType: "brand" as const, targetId: workspace.activeBrandId };
  }
  if (node.type === "goal") {
    return { targetType: "workflow" as const, targetId: workspace.workflow.id };
  }
  return { targetType: "node" as const, targetId: node.id };
}

function buildMemoryFromFeedback(feedback: FeedbackObject, nodeTitle: string): MemoryObject {
  return {
    id: feedback.memoryId ?? `mem-${Date.now().toString(36)}`,
    title: `Feedback memory · ${nodeTitle}`,
    source: "feedback",
    sourceType: "feedback",
    sourceId: feedback.id,
    targetType: feedback.targetType,
    targetId: feedback.targetId,
    confidence: feedback.rating === "accepted" ? 0.9 : feedback.rating === "failed" ? 0.7 : 0.65,
    reusable: feedback.rating === "accepted",
    body: `${feedback.action}: ${feedback.note}`,
    createdAt: feedback.createdAt
  };
}

function skillIcon(icon: SkillTemplate["icon"]) {
  if (icon === "compose") return <Scissors />;
  if (icon === "video") return <Film />;
  if (icon === "archive") return <Archive />;
  return <FileImage />;
}

function findMatchingSkill(prompt: string, skills: SkillTemplate[]) {
  const lower = prompt.toLowerCase();
  return skills.find((skill) => lower.includes(skill.command.replace("/", "").toLowerCase()))
    ?? skills.find((skill) => skill.keywords.some((keyword) => lower.includes(keyword.toLowerCase())))
    ?? skills[1];
}

function buildNodes(prompt: string, materials: Material[], skills: SkillTemplate[], brand: BrandMemory, model: ModelOption): WorkflowNode[] {
  const ast = parseCalPrompt(prompt);
  const refs = ast.resources
    .map((resource) => materials.find((item) => item.token === resource.raw || item.token.endsWith(`.${resource.path}`)))
    .filter((item): item is Material => Boolean(item));
  const matchedSkill = findMatchingSkill(prompt, skills);
  const command = ast.commands[0] ? `/${ast.commands[0]}` : matchedSkill.command;
  const output = ast.outputs[0]?.toUpperCase() || matchedSkill.output;
  const outputType: WorkflowNode["type"] = output === "MP4" ? "video" : output === "ZIP" || output === "PDF" ? "file" : "output";
  return [
    {
      id: "goal",
      title: "目标节点",
      type: "goal",
      body: prompt.replace(/\s+/g, " ").slice(0, 120) || "输入一句话工作目标。",
      x: 70,
      y: 72,
      status: "ready"
    },
    {
      id: "brand",
      title: `${brand.name} 品牌记忆`,
      type: "brand",
      body: `${brand.positioning}\n规则: ${brand.rules.join(" / ")}`,
      x: 355,
      y: 52,
      status: "ready"
    },
    {
      id: "input",
      title: "素材输入",
      type: "material",
      body: refs.length ? refs.map((item) => item.token).join(" + ") : "从左侧上传或选择素材作为参数。",
      x: 80,
      y: 242,
      materialIds: refs.map((item) => item.id),
      status: refs.length ? "ready" : "queued"
    },
    {
      id: "skill",
      title: command,
      type: "skill",
      body: summarizeCal(ast) || `${matchedSkill.title}: ${matchedSkill.description}`,
      x: 410,
      y: 210,
      materialIds: refs.map((item) => item.id),
      status: ast.warnings.length ? "queued" : "ready"
    },
    {
      id: "model",
      title: `模型节点 · ${model.name}`,
      type: "model",
      body: `${model.kind} · ${model.provider} · ${model.route}\ncapabilities: ${model.capabilities.join(", ")}\nfallback: ${model.fallbackModelIds.join(" -> ") || "none"}\nrouting: ${model.routingRules.join(" / ")}`,
      x: 690,
      y: 72,
      materialIds: [],
      status: model.status === "offline" ? "queued" : "ready"
    },
    {
      id: "compose",
      title: matchedSkill.title,
      type: matchedSkill.nodeType === "output" ? "compose" : matchedSkill.nodeType,
      body: matchedSkill.description,
      x: 690,
      y: 270,
      materialIds: refs.map((item) => item.id),
      status: "ready"
    },
    {
      id: "output",
      title: `输出 ${output}`,
      type: outputType,
      body: "生成后在右侧预览，确认后保存为新素材。",
      x: 1010,
      y: 196,
      materialIds: refs.slice(0, 1).map((item) => item.id),
      status: "ready"
    },
    {
      id: "review",
      title: "人工修改 / 版本节点",
      type: "review",
      body: "点开任意节点，用自然语言修改参数、模型、品牌规则或输出版本。",
      x: 1010,
      y: 392,
      materialIds: [],
      status: "ready"
    }
  ];
}

function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const { goal, materials, skills, activeBrandId, activeModelId, selectedIds, prompt, activeMaterialId, jobs, feedback, memories } = workspace;
  const [activeNodeId, setActiveNodeId] = useState("skill");
  const [storageMode, setStorageMode] = useState<StorageMode>(detectStorageState);
  const [backendLoaded, setBackendLoaded] = useState(false);
  const [objectIndex, setObjectIndex] = useState<WorkGraphObjectIndex | null>(null);
  const [historyEntries, setHistoryEntries] = useState<WorkGraphHistoryEntry[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillCommand, setNewSkillCommand] = useState("");
  const [query, setQuery] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const activeBrand = brandMemories.find((item) => item.id === activeBrandId) ?? brandMemories[0];
  const activeModel = modelOptions.find((item) => item.id === activeModelId) ?? modelOptions[1];
  const nodes = useMemo(() => buildNodes(prompt, materials, skills, activeBrand, activeModel), [materials, prompt, skills, activeBrand, activeModel]);
  const activeMaterial = materials.find((item) => item.id === activeMaterialId) ?? materials[0];
  const activeNode = nodes.find((item) => item.id === activeNodeId) ?? nodes[1];
  const filteredMaterials = materials.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [item.title, item.token, item.fileName, item.tags.join(" ")].join(" ").toLowerCase().includes(needle);
  });
  const ast = useMemo(() => parseCalPrompt(prompt), [prompt]);
  const selectedMaterials = materials.filter((item) => selectedIds.includes(item.id));
  const matchingSkill = useMemo(() => findMatchingSkill(prompt, skills), [prompt, skills]);
  const filteredSkills = skills.filter((skill) => {
    const needle = skillSearch.trim().toLowerCase();
    if (!needle) return true;
    return [skill.title, skill.command, skill.output, skill.description, skill.keywords.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const objectCounts = {
    goals: 1,
    assets: materials.length,
    brands: brandMemories.length,
    skills: skills.length,
    models: modelOptions.length,
    workflows: jobs.length ? jobs.length : 1,
    results: jobs.filter((job) => job.status === "done").length,
    feedback: feedback.length,
    memories: memories.length
  };
  const indexedObjects = objectIndex?.objects ?? [];
  const objectCount = (
    indexedKey: WorkGraphObject["type"],
    fallbackKey: keyof typeof objectCounts
  ) => objectIndex?.counts?.[indexedKey] ?? objectCounts[fallbackKey];

  useEffect(() => {
    let cancelled = false;
    void loadBackendWorkspace()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setWorkspace(loaded.workspace);
          if (loaded.objectIndex) setObjectIndex(loaded.objectIndex);
        }
        void loadBackendHistory().then(setHistoryEntries).catch(() => undefined);
        setStorageMode("filesystem-json");
      })
      .catch(() => {
        if (!cancelled) setStorageMode(detectStorageState());
      })
      .finally(() => {
        if (!cancelled) setBackendLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveWorkspace(workspace);
    if (!backendLoaded) return;
    if (storageMode !== "filesystem-json") return;
    void saveBackendWorkspace(workspace)
      .then(() => backendRequest("/workgraph-os/objects"))
      .then((response) => response.ok ? response.json() : null)
      .then((data: WorkGraphObjectIndex | null) => {
        if (data?.objects) setObjectIndex(data);
        return loadBackendHistory();
      })
      .then(setHistoryEntries)
      .catch(() => setStorageMode(detectStorageState()));
  }, [backendLoaded, storageMode, workspace]);

  function updateWorkspace(updater: (current: WorkGraphWorkspace) => WorkGraphWorkspace) {
    setWorkspace((current) => {
      const next = updater(current);
      const goal = next.prompt !== next.goal.rawInput || next.activeBrandId !== next.goal.brandId
        ? interpretGoal(next.prompt, next.activeBrandId, next.goal)
        : next.goal;
      const workflow = buildWorkflowObject({
        prompt: next.prompt,
        goal,
        nodes: next.nodes,
        selectedIds: next.selectedIds,
        skills: next.skills,
        activeModelId: next.activeModelId,
        jobs: next.jobs,
        previous: next.workflow
      });
      return { ...next, goal, workflow };
    });
  }

  function toggleMaterial(id: string) {
    updateWorkspace((current) => ({
      ...current,
      activeMaterialId: id,
      selectedIds: current.selectedIds.includes(id) ? current.selectedIds.filter((item) => item !== id) : [...current.selectedIds, id]
    }));
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const incoming = await Promise.all(Array.from(files).map(async (file, index) => {
      const previewUrl = file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")
        ? URL.createObjectURL(file)
        : "";
      const token = materialToken(file.name, materials.length + index);
      return {
        id: `mat-${Date.now().toString(36)}-${index}`,
        title: file.name.replace(/\.[^.]+$/, ""),
        kind: inferKind(file),
        token,
        previewUrl,
        fileName: file.name,
        size: file.size,
        createdAt: now(),
        tags: ["local", inferKind(file)],
        note: "本地上传素材，可作为 skill 参数传入。"
      } satisfies Material;
    }));
    const refs = incoming.map((item) => item.token).join(" ");
    updateWorkspace((current) => ({
      ...current,
      materials: [...incoming, ...current.materials],
      selectedIds: [...incoming.map((item) => item.id), ...current.selectedIds],
      activeMaterialId: incoming[0].id,
      prompt: current.prompt.includes(refs) ? current.prompt : `${current.prompt.replace(/\s*->\s*\w+$/i, "")} ${refs} -> PNG`
    }));
  }

  function applySkill(template: SkillTemplate) {
    const refs = selectedMaterials.map((item) => item.token).join(" ") || "$local.asset";
    updateWorkspace((current) => ({
      ...current,
      prompt: `@imgen ${template.command} 使用 ${refs}，生成可预览素材结果 -> ${template.output}`
    }));
  }

  function createSkillFromSearch() {
    const title = newSkillName.trim() || skillSearch.trim() || "自定义 Skill";
    const command = (newSkillCommand.trim() || title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")).replace(/^\/?/, "/");
    const skill = normalizeSkillObject({
      id: `skill-${Date.now().toString(36)}`,
      title,
      command,
      output: /video|视频|mp4/i.test(`${title} ${command}`) ? "MP4" : "PNG",
      description: "由一句话搜索自动创建，可继续编辑命令、输出和提示词。",
      icon: /video|视频|mp4/i.test(`${title} ${command}`) ? "video" : "image",
      keywords: title.split(/\s+/).filter(Boolean),
      nodeType: /video|视频|mp4/i.test(`${title} ${command}`) ? "video" : "output",
      evolution: { status: "created", runCount: 0, successCount: 0, failureCount: 0, testPlan: ["run generated skill", "verify result object", "save reusable SKILL.md"] }
    });
    const refs = selectedMaterials.map((item) => item.token).join(" ") || "$local.asset";
    updateWorkspace((current) => ({
      ...current,
      skills: [skill, ...current.skills],
      prompt: `@imgen ${skill.command} 使用 ${refs}，生成可预览素材结果 -> ${skill.output}`,
      memories: [
        {
          id: `mem-${Date.now().toString(36)}`,
          title: `Created skill ${skill.command}`,
          source: "manual",
          sourceType: "skill",
          sourceId: skill.id,
          targetType: "skill",
          targetId: skill.id,
          confidence: 0.7,
          reusable: true,
          body: `${skill.title}: ${skill.description}`,
          createdAt: now()
        },
        ...current.memories
      ]
    }));
    setSkillSearch("");
    setNewSkillName("");
    setNewSkillCommand("");
  }

  function updateActiveNodeBody(body: string) {
    if (!activeNode) return;
    if (activeNode.id === "skill") {
      updateWorkspace((current) => ({
        ...current,
        prompt: current.prompt.includes(activeNode.body) ? current.prompt.replace(activeNode.body, body) : `${current.prompt}\n${body}`
      }));
      return;
    }
    updateWorkspace((current) => ({
      ...current,
      prompt: `${current.prompt}\n节点 ${activeNode.title}: ${body}`.trim()
    }));
  }

  function applyNaturalLanguageChange(change: string) {
    const lower = change.toLowerCase();
    if (!change.trim()) return;
    updateWorkspace((current) => ({
      ...current,
      activeModelId: lower.includes("本地") || lower.includes("local")
        ? "local-flux"
        : lower.includes("最贵") || lower.includes("最好") || lower.includes("高质量")
          ? "gpt-image"
          : current.activeModelId,
      activeBrandId: lower.includes("dapot") ? "dapot" : lower.includes("xmanx") ? "xmanx" : current.activeBrandId,
      prompt: `${current.prompt}\n修改要求: ${change}`
    }));
    if (lower.includes("视频") || lower.includes("mp4")) applySkill(skills.find((item) => item.id === "story") ?? skills[0]);
  }

  function runWorkflow() {
    const activeSkill = matchingSkill;
    const createdAt = now();
    const job: Job = {
      id: `job-${Date.now().toString(36)}`,
      title: ast.commands[0] ? `/${ast.commands[0]}` : "素材工作流",
      status: "running",
      output: ast.outputs[0]?.toUpperCase() || "PNG",
      materials: selectedMaterials.map((item) => item.token),
      createdAt
    };
    const result = buildResultObject(job, workspace.workflow.id);
    updateWorkspace((current) => ({
      ...current,
      skills: current.skills.map((skill) => skill.id === activeSkill.id
        ? {
            ...skill,
            evolution: {
              ...skill.evolution,
              status: skill.evolution.status === "seed" ? "candidate" : skill.evolution.status,
              runCount: skill.evolution.runCount + 1,
              successCount: skill.evolution.successCount + 1,
              lastRunAt: job.createdAt
            }
          }
        : skill),
      jobs: [job, ...current.jobs],
      results: [result, ...current.results],
      memories: [
        {
          id: `mem-${Date.now().toString(36)}`,
          title: `Ran ${job.title}`,
          source: "run",
          sourceType: "workflow",
          sourceId: current.workflow.id,
          targetType: "result",
          targetId: result.id,
          confidence: 0.6,
          reusable: false,
          body: `${job.title} -> ${job.output} with ${job.materials.join(" ") || "no material refs"}`,
          createdAt: now()
        },
        ...current.memories
      ]
    }));
    window.setTimeout(() => {
      updateWorkspace((current) => ({
        ...current,
        jobs: current.jobs.map((item) => item.id === job.id ? { ...item, status: "done" } : item),
        results: current.results.map((item) => item.sourceJobId === job.id ? { ...item, status: "preview", updatedAt: now() } : item)
      }));
    }, 900);
  }

  function saveResultAsMaterial(result: ResultObject) {
    if (!result.canSaveAsMaterial) return;
    const materialId = result.savedMaterialId ?? `mat-result-${Date.now().toString(36)}`;
    const material: Material = {
      id: materialId,
      title: result.title,
      kind: result.kind === "video" ? "video" : result.kind === "document" || result.kind === "archive" ? "document" : "image",
      token: `$result.${result.id.replace(/^result-/, "")}`,
      previewUrl: result.previewUrl,
      fileName: `${result.id}.${result.output.toLowerCase()}`,
      size: 0,
      createdAt: now(),
      tags: ["result", result.kind, result.status],
      note: `Saved from ${result.workflowId} version ${result.version}.`
    };
    updateWorkspace((current) => ({
      ...current,
      materials: current.materials.some((item) => item.id === materialId) ? current.materials : [material, ...current.materials],
      selectedIds: current.selectedIds.includes(materialId) ? current.selectedIds : [materialId, ...current.selectedIds],
      activeMaterialId: materialId,
      results: current.results.map((item) => item.id === result.id ? { ...item, status: "accepted", savedMaterialId: materialId, updatedAt: now() } : item)
    }));
  }

  function recordFeedback(rating: FeedbackObject["rating"]) {
    const note = feedbackNote.trim() || (rating === "accepted" ? "结果可复用，沉淀为正向样例。" : "需要继续调整。");
    const target = feedbackTargetForActiveNode(activeNode, workspace);
    const feedbackId = `fb-${Date.now().toString(36)}`;
    const memoryId = `mem-${Date.now().toString(36)}`;
    const feedbackObject: FeedbackObject = {
      id: feedbackId,
      targetId: target.targetId,
      targetType: target.targetType,
      rating,
      action: rating === "accepted" ? "reuse" : rating === "failed" ? "avoid" : "revise",
      note,
      memoryId,
      sourceResultId: target.sourceResultId,
      sourceWorkflowId: workspace.workflow.id,
      createdAt: now()
    };
    const memoryObject = buildMemoryFromFeedback(feedbackObject, activeNode.title);
    updateWorkspace((current) => ({
      ...current,
      feedback: [feedbackObject, ...current.feedback],
      memories: [memoryObject, ...current.memories]
    }));
    setFeedbackNote("");
  }

  return (
    <main className="pm-shell">
      <header className="pm-topbar">
        <div className="pm-brand">
          <span>π</span>
          <div>
            <strong>WorkGraph OS</strong>
            <small>WorkGraph OS · local Pi Agent base · goal to executable graph</small>
          </div>
        </div>
        <div className="pm-status">
          <span><Bot /> pi-web compatible</span>
          <span><Library /> {objectCount("asset", "assets")} assets</span>
          <span><Sparkles /> {objectCount("skill", "skills")} skills</span>
          <span><RefreshCcw /> {objectCount("memory", "memories")} memories</span>
          <span><Archive /> {storageMode === "filesystem-json" ? "filesystem JSON" : storageMode === "browser-local" ? "browser local store" : "memory only"}</span>
          <span><CheckCircle2 /> WGOS local first</span>
        </div>
      </header>

      <aside className="pm-sidebar">
        <section className="pm-panel">
          <div className="pm-panel-head">
            <strong>素材库</strong>
            <label className="pm-upload">
              <Upload />
              <input type="file" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.md" onChange={(event) => void handleFiles(event.target.files)} />
            </label>
          </div>
          <label className="pm-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 token / 文件 / 标签" /></label>
          <div className="pm-material-list">
            {filteredMaterials.map((item) => (
              <button key={item.id} className={`pm-material ${selectedIds.includes(item.id) ? "selected" : ""}`} onClick={() => toggleMaterial(item.id)}>
                <span className="pm-thumb">
                  {item.previewUrl && item.kind === "image" ? <img src={item.previewUrl} alt={item.title} /> : item.kind === "video" ? <Film /> : <FileImage />}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.token} · {formatBytes(item.size)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="pm-panel compact">
          <div className="pm-panel-head"><strong>Skill 模板</strong><Sparkles /></div>
          <label className="pm-search"><Search /><input value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="一句话搜索 skill" /></label>
          {filteredSkills.map((template) => (
            <button key={template.id} className="pm-skill" onClick={() => applySkill(template)}>
              {skillIcon(template.icon)}
              <span><strong>{template.title}</strong><small>{template.description}</small></span>
              <ChevronRight />
            </button>
          ))}
          {skillSearch && !filteredSkills.length && (
            <div className="pm-create-skill">
              <strong>没有匹配 Skill</strong>
              <input value={newSkillName} onChange={(event) => setNewSkillName(event.target.value)} placeholder="Skill 名称" />
              <input value={newSkillCommand} onChange={(event) => setNewSkillCommand(event.target.value)} placeholder="/command" />
              <button type="button" onClick={createSkillFromSearch}><Wand2 /> 创建并使用</button>
            </div>
          )}
        </section>

        <section className="pm-panel compact">
          <div className="pm-panel-head"><strong>对象图谱</strong><Layers3 /></div>
          <div className="pm-goal-card">
            <strong>{goal.title}</strong>
            <small>{goal.goalType} · {goal.outputTarget.toUpperCase()} · {goal.normalizedIntent}</small>
            <p>{goal.successCriteria[0]}</p>
          </div>
          <div className="pm-goal-card">
            <strong>{workspace.workflow.title}</strong>
            <small>{workspace.workflow.status} · v{workspace.workflow.version} · {workspace.workflow.nodeIds.length} nodes · {workspace.workflow.edgeIds.length} edges</small>
            <p>{workspace.workflow.reusable ? "可复用工作图谱，已具备能力沉淀基础。" : "运行并反馈后可沉淀为可复用工作图谱。"}</p>
          </div>
          <div className="pm-object-grid">
            <span>Goal <strong>{objectCount("goal", "goals")}</strong></span>
            <span>Asset <strong>{objectCount("asset", "assets")}</strong></span>
            <span>Brand <strong>{objectCount("brand", "brands")}</strong></span>
            <span>Skill <strong>{objectCount("skill", "skills")}</strong></span>
            <span>Model <strong>{objectCount("model", "models")}</strong></span>
            <span>Workflow <strong>{objectCount("workflow", "workflows")}</strong></span>
            <span>Result <strong>{objectCount("result", "results")}</strong></span>
            <span>Feedback <strong>{objectCount("feedback", "feedback")}</strong></span>
            <span>Memory <strong>{objectCount("memory", "memories")}</strong></span>
          </div>
          <div className="pm-object-index">
            {(indexedObjects.length ? indexedObjects : []).slice(0, 5).map((object) => (
              <button key={object.id} type="button">
                <strong>{object.type}</strong>
                <span>{object.title}</span>
                <small>{object.summary}</small>
              </button>
            ))}
            {!indexedObjects.length ? <p className="pm-muted">后端对象索引会在连接 filesystem JSON 后显示。</p> : null}
          </div>
          <div className="pm-history-list">
            <strong>版本历史</strong>
            {historyEntries.slice(0, 4).map((entry) => (
              <button key={entry.id} type="button">
                <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                <small>{entry.reason} · {entry.objectIds.length} objects</small>
                <em>{entry.prompt || "No prompt"}</em>
              </button>
            ))}
            {!historyEntries.length ? <p className="pm-muted">保存到后端后会记录对象索引快照。</p> : null}
          </div>
        </section>

        <section className="pm-panel compact">
          <div className="pm-panel-head"><strong>品牌画布</strong><FolderOpen /></div>
          {brandMemories.map((brand) => (
            <button key={brand.id} className={`pm-skill ${activeBrandId === brand.id ? "selected" : ""}`} onClick={() => updateWorkspace((current) => ({ ...current, activeBrandId: brand.id }))}>
              <Library />
              <span><strong>{brand.name}</strong><small>{brand.colors} · {brand.rules.length} rules</small></span>
            </button>
          ))}
        </section>

        <section className="pm-panel compact">
          <div className="pm-panel-head"><strong>模型画布</strong><Bot /></div>
          {modelOptions.map((model) => (
            <button key={model.id} className={`pm-skill ${activeModelId === model.id ? "selected" : ""}`} onClick={() => updateWorkspace((current) => ({ ...current, activeModelId: model.id }))}>
              <Bot />
              <span>
                <strong>{model.name}</strong>
                <small>{model.kind} · {model.provider} · {model.costTier}/{model.latencyTier} · {model.status}</small>
                <small>{model.capabilities.join(", ")} · fallback {model.fallbackModelIds.join(" -> ") || "none"}</small>
              </span>
            </button>
          ))}
        </section>
      </aside>

      <section className="pm-canvas">
        <div className="pm-grid" />
        <div className="pm-canvas-toolbar">
          <span><Layers3 /> 素材工作流</span>
          <span>{summarizeCal(ast) || "等待任务"}</span>
          <button type="button"><Maximize2 /> 适配</button>
        </div>
        <svg className="pm-lines" viewBox="0 0 1280 560" preserveAspectRatio="none">
          <path d="M285 154 C330 154 315 134 355 134" />
          <path d="M560 134 C615 134 620 134 690 134" />
          <path d="M270 335 C340 335 330 292 410 292" />
          <path d="M596 292 C640 292 620 352 690 352" />
          <path d="M890 352 C950 352 940 278 1010 278" />
          <path d="M1126 332 C1126 360 1126 370 1126 392" />
        </svg>
        {nodes.map((node) => (
          <article key={node.id} className={`pm-node ${node.type} ${activeNodeId === node.id ? "active" : ""}`} style={{ left: node.x, top: node.y }} onClick={() => setActiveNodeId(node.id)}>
            <div className="pm-node-title">
              <strong>{node.title}</strong>
              <small>{node.status}</small>
            </div>
            {node.materialIds?.length ? (
              <div className="pm-node-media">
                {node.materialIds.slice(0, 3).map((id) => {
                  const material = materials.find((item) => item.id === id);
                  if (!material) return null;
                  return material.previewUrl && material.kind === "image"
                    ? <img key={id} src={material.previewUrl} alt={material.title} />
                    : <span key={id}><FileImage /></span>;
                })}
              </div>
            ) : null}
            <p>{node.body}</p>
          </article>
        ))}
      </section>

      <aside className="pm-inspector">
        <section className="pm-panel preview">
          <div className="pm-panel-head"><strong>文件预览</strong><PanelRight /></div>
          {activeMaterial ? (
            <>
              <div className="pm-preview-box">
                {activeMaterial.kind === "image" && activeMaterial.previewUrl ? <img src={activeMaterial.previewUrl} alt={activeMaterial.title} /> : <FileImage />}
              </div>
              <h2>{activeMaterial.title}</h2>
              <code>{activeMaterial.token}</code>
              <p>{activeMaterial.note}</p>
              <dl>
                <div><dt>文件</dt><dd>{activeMaterial.fileName}</dd></div>
                <div><dt>大小</dt><dd>{formatBytes(activeMaterial.size)}</dd></div>
                <div><dt>类型</dt><dd>{activeMaterial.kind}</dd></div>
              </dl>
            </>
          ) : <p>选择或上传素材后预览。</p>}
        </section>

        <section className="pm-panel">
          <div className="pm-panel-head"><strong>节点编辑</strong><Pencil /></div>
          {activeNode ? (
            <div className="pm-node-editor">
              <strong>{activeNode.title}</strong>
              <small>{activeNode.type} · {activeNode.status}</small>
              <textarea value={activeNode.body} onChange={(event) => updateActiveNodeBody(event.target.value)} />
              <div className="pm-node-actions">
                <button type="button" onClick={() => updateWorkspace((current) => ({ ...current, prompt: `${current.prompt}\n修改 ${activeNode.title}: ${activeNode.body}` }))}><Pencil /> 写入提示词</button>
                <button type="button" onClick={runWorkflow}><Play /> 跑此节点</button>
              </div>
            </div>
          ) : <p className="pm-muted">点击画布节点后编辑。</p>}
        </section>

        <section className="pm-panel">
          <div className="pm-panel-head"><strong>自然语言修改</strong><Wand2 /></div>
          <NaturalLanguageEditor onApply={applyNaturalLanguageChange} />
        </section>

        <section className="pm-panel">
          <div className="pm-panel-head"><strong>Skill 进化</strong><Sparkles /></div>
          <div className="pm-evolution">
            <div>
              <span>当前 Skill</span>
              <strong>{matchingSkill.title}</strong>
              <small>{matchingSkill.command} · 输出 {matchingSkill.output}</small>
              <small>{matchingSkill.capabilityType} · {matchingSkill.runtime} · {matchingSkill.skillMdPath}</small>
              <small>runs {matchingSkill.evolution.runCount} · pass {matchingSkill.evolution.successCount} · status {matchingSkill.evolution.status}</small>
            </div>
            <button type="button" onClick={() => setSkillSearch(matchingSkill.title)}>
              <Search /> 查找相似 Skill
            </button>
            <button type="button" onClick={() => {
              updateWorkspace((current) => ({
                ...current,
                prompt: `${current.prompt}\n进化要求: 将 ${matchingSkill.command} 沉淀为可复用 SKILL.md，保留输入素材、模型、失败重试和输出检查。`
              }));
              runWorkflow();
            }}>
              <Wand2 /> 生成进化任务
            </button>
            <p className="pm-muted">后续接入 pi 后，这里会把高频流程保存成 SKILL.md、测试脚本和回归样例。</p>
          </div>
        </section>

        <section className="pm-panel">
          <div className="pm-panel-head"><strong>反馈记忆</strong><CheckCircle2 /></div>
          <div className="pm-feedback">
            <textarea value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} placeholder="记录你对当前节点或结果的判断，系统会沉淀为 Memory Object。" />
            <div className="pm-feedback-actions">
              <button type="button" onClick={() => recordFeedback("accepted")}><CheckCircle2 /> 接受</button>
              <button type="button" onClick={() => recordFeedback("needs_revision")}><Pencil /> 需修改</button>
            </div>
            {memories.slice(0, 3).map((memory) => (
              <div key={memory.id} className="pm-memory">
                <strong>{memory.title}</strong>
                <small>{memory.source} · {new Date(memory.createdAt).toLocaleString()}</small>
                <p>{memory.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pm-panel">
          <div className="pm-panel-head"><strong>任务队列</strong><RefreshCcw /></div>
          {jobs.length ? jobs.map((job) => (
            <div key={job.id} className="pm-job">
              <span>{job.status === "running" ? <Loader2 className="spin" /> : <CheckCircle2 />}</span>
              <div><strong>{job.title} {"->"} {job.output}</strong><small>{job.materials.join(" ") || "no material refs"}</small></div>
            </div>
          )) : <p className="pm-muted">运行后会显示 skill / 合成 / 归档任务。</p>}
        </section>

        <section className="pm-panel">
          <div className="pm-panel-head"><strong>结果版本</strong><CheckCircle2 /></div>
          {workspace.results.length ? workspace.results.slice(0, 4).map((result) => (
            <div key={result.id} className="pm-job">
              <span>{result.status === "accepted" ? <CheckCircle2 /> : <FileImage />}</span>
              <div>
                <strong>{result.title}</strong>
                <small>v{result.version} · {result.kind} · {result.status} · {result.canSaveAsMaterial ? "can save as material" : "view only"}</small>
              </div>
              {result.canSaveAsMaterial ? <button type="button" onClick={() => saveResultAsMaterial(result)}><Archive /> 存为素材</button> : null}
            </div>
          )) : <p className="pm-muted">运行节点后会生成可预览、可接受、可回写素材库的 Result Object。</p>}
        </section>
      </aside>

      <footer className="pm-composer">
        <button type="button" className="pm-new"><Plus /> 新素材</button>
        <textarea value={prompt} onChange={(event) => updateWorkspace((current) => ({ ...current, prompt: event.target.value }))} />
        <div className="pm-composer-side">
          <span>{ast.warnings.length ? ast.warnings.join(" / ") : `匹配 ${matchingSkill.title}`}</span>
          <button type="button" onClick={runWorkflow}><Play /> 运行</button>
          <button type="button"><Send /> 发送到 pi</button>
        </div>
      </footer>
    </main>
  );
}

function NaturalLanguageEditor({ onApply }: { onApply: (change: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="pm-node-editor">
      <textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如：这个节点换成本地模型；字幕节点改成泰文优先；保存成 DAPOT 开业模板。" />
      <button type="button" className="pm-wide-action" onClick={() => { onApply(value); setValue(""); }}><Wand2 /> 应用修改</button>
    </div>
  );
}

const rootHost = window as Window & { __piMaterialRoot?: Root };
rootHost.__piMaterialRoot ??= createRoot(document.getElementById("root")!);
rootHost.__piMaterialRoot.render(<App />);
