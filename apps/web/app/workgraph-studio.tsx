"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import { create } from "zustand";
import {
  Boxes,
  Brain,
  Database,
  Download,
  Film,
  FileText,
  FolderOpen,
  Image,
  Layers3,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Wand2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

type ObjectType = "goal" | "asset" | "brand" | "skill" | "model" | "workflow" | "result" | "feedback" | "memory";
type BottomTab = "日志" | "预览" | "队列" | "反馈";
type NodeModuleDrawer = "params" | "model" | "skill" | "asset" | "brand" | null;
type PreviewTraceAction = "node" | "brand" | "skill" | "model" | "asset" | "logs" | "feedback";
type ViewMode = "full" | "focus" | "resource" | "inspector";
type ComposerMode = "goal" | "node";
type ExecutionFlowStep = {
  key: string;
  label: string;
  value: string;
  state: "done" | "active" | "idle" | "blocked";
  hint: string;
};
const viewModeTopAction: Record<ViewMode, "reset" | "focus" | "resource" | "inspector"> = {
  full: "reset",
  focus: "focus",
  resource: "resource",
  inspector: "inspector"
};
const modelStrategies = [
  { value: "fast_draft", label: "快速草稿" },
  { value: "low_cost", label: "低成本" },
  { value: "balanced", label: "平衡" },
  { value: "high_quality", label: "高质量" },
  { value: "local_privacy", label: "本地优先" },
  { value: "final_output", label: "最终输出" },
  { value: "manual", label: "手动" }
] as const;

const studioLayoutStorageKeys = {
  version: "sparkcanvas.workgraph.layoutVersion",
  inspectorCollapsed: "sparkcanvas.workgraph.inspectorCollapsed",
  resourceCollapsed: "sparkcanvas.workgraph.resourceCollapsed"
} as const;
const studioLayoutVersion = "2-bottom-first";

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, String(value));
}

function removeStoredLayoutBooleans() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(studioLayoutStorageKeys.version);
  window.localStorage.removeItem(studioLayoutStorageKeys.inspectorCollapsed);
  window.localStorage.removeItem(studioLayoutStorageKeys.resourceCollapsed);
}

type WorkGraphObject = {
  id: string;
  type: ObjectType | string;
  title: string;
  summary: string;
};

type WorkGraphNode = {
  id: string;
  title: string;
  type: string;
  body?: string;
  status?: string;
  disabled?: boolean;
  retryCount?: number;
  lastError?: string;
  modelId?: string;
  modelTitle?: string;
  modelStrategy?: string;
  skillId?: string;
  materialIds?: string[];
  x?: number;
  y?: number;
  params?: Record<string, string | number | boolean>;
  assetPreviews?: Array<{ id: string; title?: string; thumbnailUrl?: string; 预览Url?: string; kind?: string }>;
  skillTitle?: string;
  skillCommand?: string;
  resultPreview?: string;
  resultKind?: string;
  logCount?: number;
  modelPolicy?: ModelPolicyObject;
};

type NodeParamOption = {
  key: string;
  label: string;
  fallback: string;
  options: string[];
};

type NodeOperationProfile = {
  role: string;
  intent: string;
  takeover: string[];
  actions: string[];
};

type AssetObject = {
  id: string;
  title: string;
  kind?: string;
  token?: string;
  预览Url?: string;
  thumbnailUrl?: string;
  versionPath?: string;
  usagePath?: string;
  fileName?: string;
  tags?: string[];
  brandId?: string;
};

type SkillFile = {
  path: string;
  content: string;
};

type SkillPayload = {
  id: string;
  title: string;
  command?: string;
  description?: string;
  version?: string;
  evolution?: {
    status?: string;
    runCount?: number;
    成功Count?: number;
    failureCount?: number;
    lastRunAt?: string;
    history?: Array<Record<string, unknown>>;
  };
};

type SkillDetail = {
  skill: SkillPayload;
  技能: SkillPayload;
  folder: string;
  files: SkillFile[];
  tree: Array<{ name: string; path: string; type: "file" | "directory"; children?: SkillDetail["tree"] }>;
  onlineSearch?: { status: string; disabled: boolean };
};

type SkillTestResult = {
  status?: string;
  testId?: string;
  预览?: string;
  logs?: Array<{ step: string; message: string }>;
  routingDecision?: { selectedModelId?: string; route?: string; reason?: string };
};

type SkillOptimizePreview = {
  status: "预览" | "applied";
  plan?: string[];
  diffPreview?: string;
  message: string;
};

type FeedbackTargetOption = {
  type: "result" | "node" | "skill" | "brand" | "model" | "workflow" | "asset";
  id: string;
  label: string;
};

type BrandObject = {
  id: string;
  name: string;
  context?: string;
  rules?: string[];
  forbiddenWords?: string[];
  sceneKeywords?: string[];
};

type FeedbackLearning = {
  brand?: BrandObject | null;
  feedback?: {
    id?: string;
    targetType?: string;
    targetId?: string;
    rating?: string;
    action?: string;
    note?: string;
  };
  memory?: { id?: string; title?: string; rule?: string; reusable?: boolean };
  appliedLearning?: {
    brandForbiddenWords?: string[];
    brandSceneKeywords?: string[];
    assetIds?: string[];
    modelPolicyId?: string;
    modelPolicyStrategy?: string;
    assetTags?: string[];
    memoryReusable?: boolean;
  };
};

type ModelOption = {
  id: string;
  name?: string;
  provider?: string;
  strategy?: string;
  kind?: string;
  status?: string;
};

type ModelPolicyObject = {
  id?: string;
  type?: string;
  targetType?: string;
  targetId?: string;
  feedbackId?: string;
  action?: string;
  rating?: string;
  strategy?: string;
  provider?: string;
  modelId?: string;
  avoid?: boolean;
  note?: string;
  updatedAt?: string;
};

type HistoryEntry = {
  id: string;
  createdAt?: string;
  reason?: string;
  prompt?: string;
  counts?: Record<string, number>;
  objectIds?: string[];
};

type SqliteStatus = {
  storage?: string;
  dbFile?: string;
  tables?: string[];
  rowCounts?: Record<string, number>;
};

type SnapshotStatus = {
  storage?: { file?: string; exists?: boolean };
  manifest?: {
    counts?: Record<string, number>;
    directories?: Record<string, string>;
  };
  snapshots?: Array<{ type: string; dir: string; exists: boolean; indexes: string[]; files: string[] }>;
};

type PiSessionSummary = {
  id: string;
  executionId?: string;
  workflowId?: string;
  nodeId?: string;
  skillId?: string;
  resultId?: string;
  promptRecordId?: string;
  status?: string;
  createdAt?: string;
  sessionJson?: string;
};

type PiSessionDetail = {
  id?: string;
  executionId?: string;
  workflowId?: string;
  nodeId?: string;
  skillId?: string;
  resultId?: string;
  promptRecordId?: string;
  status?: string;
  createdAt?: string;
  input?: {
    goal?: string;
    finalPrompt?: string;
    brandId?: string;
    materialIds?: string[];
    modelPolicy?: unknown;
    skill?: unknown;
    piContext?: {
      source?: string;
      localPaths?: Record<string, string>;
      node?: unknown;
      brand?: unknown;
      assets?: unknown[];
      modelPolicy?: unknown;
    };
  };
  输出?: {
    resultId?: string;
    输出?: string;
    artifactPaths?: Record<string, string>;
    executionLog?: unknown[];
  };
};

type ExecutionLogEntry = {
  id: string;
  executionId?: string;
  step: string;
  status?: string;
  nodeId: string;
  workflowId?: string;
  message: string;
  payload?: Record<string, unknown>;
};

type PromptRecordObject = {
  id: string;
  executionId?: string;
  workflowId?: string;
  nodeId?: string;
  nodeTitle?: string;
  sourcePrompt?: string;
  workspacePrompt?: string;
  nodePrompt?: string;
  finalPrompt?: string;
  brandId?: string;
  brandContext?: string;
  materialIds?: string[];
  skillId?: string;
  modelId?: string;
  requestedModelId?: string;
  modelStrategy?: string;
  输出?: string;
};

type ResultObject = {
  id: string;
  title: string;
  goalId?: string;
  workflowId?: string;
  nodeId?: string;
  nodeTitle?: string;
  kind?: string;
  status?: string;
  version?: number;
  输出?: string;
  预览?: string;
  预览Url?: string;
  // Backend (English) result fields: real run output, preview URL and variant grouping.
  output?: string;
  previewUrl?: string;
  artifactPaths?: string[];
  variantGroupId?: string;
  variantIndex?: number;
  variantRole?: string;
  simulated?: boolean;
  sourceJobId?: string;
  executionId?: string;
  piSessionId?: string;
  promptRecordId?: string;
  brandId?: string;
  materialIds?: string[];
  skillId?: string;
  modelId?: string;
  feedbackIds?: string[];
  canSaveAsMaterial?: boolean;
  executor?: string;
  modelStrategy?: string;
  trace?: {
    goalId?: string;
    workflowId?: string;
    nodeId?: string;
    brandId?: string;
    materialIds?: string[];
    skillId?: string;
    modelId?: string;
    promptRecordId?: string;
    executionId?: string;
    piSessionId?: string;
    feedbackIds?: string[];
  };
  routingDecision?: {
    selectedModelId?: string;
    route?: string;
    strategy?: string;
    reason?: string;
  };
  promptRecord?: PromptRecordObject;
  createdAt?: string;
  updatedAt?: string;
};

function displayLogMessage(log: Pick<ExecutionLogEntry, "message" | "payload">) {
  const message = log.message || "";
  if (log.payload?.预览Only === true || (message.includes("Executed") && message.includes("/v1/videos"))) {
    return message.includes("Preview-only")
      ? message
      : "预览执行：未发送付费视频请求。";
  }
  return message;
}

function formatRecord(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function objectField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

type WorkGraphWorkspace = {
  version?: 1;
  prompt?: string;
  activeBrandId?: string;
  activeModelId?: string;
  selectedIds?: string[];
  activeMaterialId?: string;
  activeSkillId?: string;
  nodes?: WorkGraphNode[];
  edges?: Array<{ id?: string; source: string; target: string }>;
  jobs?: Array<{ id: string; title: string; status: string; 输出?: string }>;
  results?: ResultObject[];
  feedback?: Array<{ id: string; targetId: string; note: string; rating: string }>;
  memories?: Array<{ id: string; title?: string; body?: string; reusable?: boolean }>;
  executionLog?: ExecutionLogEntry[];
  models?: ModelOption[];
  modelPolicies?: ModelPolicyObject[];
  skills?: unknown[];
  materials?: AssetObject[];
  promptRecords?: PromptRecordObject[];
  updatedAt?: string;
  [key: string]: unknown;
};

type WorkspacePayload = {
  workspace?: WorkGraphWorkspace | null;
  objectIndex?: {
    counts?: Record<string, number>;
    objects?: WorkGraphObject[];
  };
};

type StudioState = {
  提示词: string;
  activeObjectType: ObjectType;
  activeNodeId: string;
  bottomTab: BottomTab;
  previewExpanded: boolean;
  skillDrawerOpen: boolean;
  setPrompt: (提示词: string) => void;
  setActiveObjectType: (type: ObjectType) => void;
  setActiveNodeId: (nodeId: string) => void;
  setBottomTab: (tab: BottomTab) => void;
  setPreviewExpanded: (expanded: boolean) => void;
  setSkillDrawerOpen: (open: boolean) => void;
};

const useStudioStore = create<StudioState>((set) => ({
  提示词: "给 DAPOT 做一条泰国年轻女性喜欢的新店开业 TikTok 视频",
  activeObjectType: "asset",
  activeNodeId: "",
  bottomTab: "预览",
  previewExpanded: false,
  skillDrawerOpen: false,
  setPrompt: (提示词) => set({ 提示词 }),
  setActiveObjectType: (activeObjectType) => set({ activeObjectType }),
  setActiveNodeId: (activeNodeId) => set({ activeNodeId }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setPreviewExpanded: (previewExpanded) => set({ previewExpanded }),
  setSkillDrawerOpen: (skillDrawerOpen) => set({ skillDrawerOpen })
}));

const objectTabs: Array<{ type: ObjectType; label: string; icon: React.ElementType }> = [
  { type: "goal", label: "目标", icon: ListChecks },
  { type: "asset", label: "素材", icon: Image },
  { type: "brand", label: "品牌", icon: Boxes },
  { type: "skill", label: "技能", icon: Wand2 },
  { type: "model", label: "模型", icon: Settings2 },
  { type: "workflow", label: "流程", icon: Layers3 },
  { type: "result", label: "结果", icon: FileText },
  { type: "feedback", label: "反馈", icon: MessageSquareText },
  { type: "memory", label: "记忆", icon: Brain }
];

const primaryObjectTabs = objectTabs.filter(({ type }) => (
  type === "asset" || type === "skill" || type === "model" || type === "result"
));

function displayObjectType(type?: string | null) {
  const labels: Record<string, string> = {
    goal: "目标",
    asset: "素材",
    brand: "品牌",
    skill: "技能",
    model: "模型",
    workflow: "流程",
    result: "结果",
    feedback: "反馈",
    memory: "记忆",
    prompt: "提示词",
    log: "日志"
  };
  return labels[type || ""] || type || "对象";
}

function displayShortId(id?: string | null) {
  if (!id) return "-";
  const clean = id.replace(/^(asset|skill|model|result|workflow|memory|feedback|goal):/i, "");
  if (clean.length <= 18) return clean;
  return `${clean.slice(0, 8)}...${clean.slice(-6)}`;
}

function displayNodeShortId(node?: Pick<WorkGraphNode, "id" | "type"> | null) {
  if (!node) return "-";
  const typePrefix = displayNodeType(node.type).slice(0, 2);
  const raw = node.id.replace(/^node-/, "");
  if (/^[a-z_]+$/i.test(raw)) return typePrefix;
  return raw.length <= 8 ? raw : `${raw.slice(0, 4)}...${raw.slice(-3)}`;
}

function displayModelName(modelId?: string | null, modelOptions: ModelOption[] = []) {
  if (!modelId) return "自动模型";
  const found = modelOptions.find((model) => model.id === modelId || model.name === modelId);
  if (found?.name) return found.name;
  const aliases: Record<string, string> = {
    imgen: "图片生成",
    "gpt-image-2": "GPT Image 2",
    "gpt-image-1.5": "GPT Image 1.5",
    "gpt-image-1": "GPT Image 1",
    "gpt-5.4-mini": "GPT-5.4 Mini"
  };
  return aliases[modelId] || modelId;
}

function executionStepState(done: boolean, active: boolean, blocked = false): ExecutionFlowStep["state"] {
  if (blocked) return "blocked";
  if (done) return "done";
  if (active) return "active";
  return "idle";
}

function api(path: string, init?: RequestInit) {
  if (typeof fetch !== "function") {
    throw new Error("browser fetch is unavailable; cannot load WorkGraph API");
  }
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
}

function assetIdFromDataTransfer(dataTransfer: DataTransfer) {
  return dataTransfer.getData("application/x-workgraph-asset") || dataTransfer.getData("text/plain");
}

function nodeModuleKind(type: string) {
  if (type === "brand_context") return "brand";
  if (type === "asset_search" || type === "asset_input") return "asset";
  if (type === "skill_search" || type === "skill_create" || type === "skill_execute") return "skill";
  if (type === "model_select") return "model";
  if (type === "video_generate") return "video";
  if (type === "image_generate" || type === "预览" || type === "preview" || type === "result_preview") return "visual";
  if (type === "text_generate" || type === "prompt_generate" || type === "goal") return "text";
  if (type === "human_review" || type === "feedback") return "review";
  return "control";
}

function displayNodeTitle(node?: Pick<WorkGraphNode, "id" | "title" | "type"> | null) {
  if (!node) return "未选择节点";
  const title = node.title || node.id || "未命名节点";
  const aliases: Record<string, string> = {
    "Goal Object": "目标对象",
    "Brand Context": "品牌上下文",
    "Brand Context · DAPOT": "品牌上下文 · DAPOT",
    "Asset Retriever": "素材检索",
    "Skill Search": "技能匹配",
    "Skill Creator": "技能创建",
    "Model Router": "模型路由",
    "Model Router · yijiarj-grok-video-super": "模型路由 · 视频",
    "Prompt Builder": "提示词打包",
    "Workflow Runner": "流程执行",
    "Generate MP4": "生成视频",
    "Result Preview": "结果预览",
    "Result Preview · MP4": "结果预览 · MP4",
    "Human Review": "人工审核",
    "Feedback Memory": "反馈记忆"
  };
  return aliases[title] || title;
}

function displayNodeType(type?: string | null) {
  if (!type) return "节点";
  const aliases: Record<string, string> = {
    goal: "目标",
    brand_context: "品牌上下文",
    asset_search: "素材检索",
    asset_input: "素材输入",
    skill_search: "技能匹配",
    skill_create: "技能创建",
    skill_execute: "技能执行",
    model_select: "模型选择",
    prompt_generate: "提示词",
    text_generate: "文本生成",
    image_generate: "图片生成",
    video_generate: "视频生成",
    human_review: "人工审核",
    feedback: "反馈记忆",
    result_preview: "结果预览",
    preview: "结果预览"
  };
  return aliases[type] || type.replaceAll("_", " ");
}

function displayModuleKind(kind?: string | null) {
  const aliases: Record<string, string> = {
    brand: "品牌",
    asset: "素材",
    skill: "技能",
    model: "模型",
    video: "视频",
    visual: "画面",
    text: "文本",
    review: "评估",
    control: "控制",
    params: "参数"
  };
  return aliases[kind || ""] || kind || "模块";
}

function displayTextAlias(value?: string | null) {
  if (!value) return "";
  const aliases: Record<string, string> = {
    "Workflow Runner Draft Skill": "流程执行草稿技能",
    "Workflow Runner": "流程执行",
    "Goal Object": "目标对象",
    "Brand Context": "品牌上下文",
    "Asset Retriever": "素材检索",
    "Skill Search": "技能匹配",
    "Model Router": "模型路由",
    "Result Preview": "结果预览",
    "Human Review": "人工审核",
    "Feedback Memory": "反馈记忆"
  };
  return Object.entries(aliases)
    .reduce((text, [source, target]) => text.replaceAll(source, target), value)
    .replace(/\bSkill\b/g, "技能");
}

function nodeParamOptions(type: string): NodeParamOption[] {
  if (/video/i.test(type)) {
    return [
      { key: "宽高比", label: "宽高比", fallback: "9:16", options: ["9:16", "16:9", "1:1", "4:5"] },
      { key: "duration", label: "时长", fallback: "8s", options: ["6s", "8s", "12s", "15s"] },
      { key: "清晰度", label: "清晰度", fallback: "预览", options: ["预览", "720p", "1080p"] }
    ];
  }
  if (/image|preview|预览/i.test(type)) {
    return [
      { key: "尺寸", label: "尺寸", fallback: "1024x1024", options: ["1024x1024", "1024x1536", "1536x1024"] },
      { key: "referenceMode", label: "引用源", fallback: "brand_assets", options: ["brand_assets", "node_assets", "none"] },
      { key: "format", label: "输出", fallback: "png", options: ["png", "jpg", "webp"] }
    ];
  }
  if (/text|prompt|goal|brand_context|skill/i.test(type)) {
    return [
      { key: "schema", label: "输出结构", fallback: "structured", options: ["structured", "script", "storyboard", "prompt_pack"] },
      { key: "语言", label: "语言", fallback: "thai_first", options: ["thai_first", "zh_cn", "en", "mixed"] }
    ];
  }
  return [];
}

  function nodeOperationProfile(type: string): NodeOperationProfile {
  const profiles: Record<string, NodeOperationProfile> = {
    goal: {
      role: "目标输入",
      intent: "把自然语言业务目标转成可追踪目标对象",
      takeover: ["改目标", "改语言", "改输出结构"],
      actions: ["重建流程", "保存目标", "追踪下游"]
    },
    brand_context: {
      role: "品牌守护",
      intent: "读取 DAPOT 品牌上下文、禁用词和反馈记忆",
      takeover: ["查看品牌规则", "追加禁用词", "绑定品牌素材"],
      actions: ["刷新品牌", "应用记忆", "锁定约束"]
    },
    asset_search: {
      role: "素材检索",
      intent: "从 data/assets 和品牌素材里找可用引用",
      takeover: ["上传素材", "拖入节点", "替换素材"],
      actions: ["搜索本地素材", "绑定引用源", "记录使用"]
    },
    asset_input: {
      role: "素材输入",
      intent: "接收用户上传或拖入的图片、视频、字体、文档",
      takeover: ["上传文件", "预览素材", "改品牌归属"],
      actions: ["保存素材", "生成预览", "打标签"]
    },
    skill_search: {
      role: "技能匹配",
      intent: "扫描 .pi/skills 和 data/skills，匹配可执行技能",
      takeover: ["搜索技能", "绑定技能", "创建草稿"],
      actions: ["搜索本地技能", "匹配合适", "打开文件"]
    },
    skill_create: {
      role: "技能草稿",
      intent: "没有合适技能时创建可审核草稿技能",
      takeover: ["编辑 SKILL.md", "优化提示词", "确认启用"],
      actions: ["创建草稿", "预览对比", "生成版本"]
    },
    skill_execute: {
      role: "Pi 技能执行",
      intent: "通过 Pi 上下文执行技能并回写结果对象",
      takeover: ["单节点运行", "失败重试", "查看日志"],
      actions: ["通过 Pi 运行", "写入 session", "采集输出"]
    },
    prompt_generate: {
      role: "提示词打包",
      intent: "合并目标、品牌、素材和技能约束生成结构化提示",
      takeover: ["改提示词", "改输出结构", "查看上下文"],
      actions: ["生成提示词", "串联记录", "校验引用源"]
    },
    model_select: {
      role: "模型策略",
      intent: "按节点选择模型、provider 和执行策略",
      takeover: ["替换模型", "切换策略", "应用反馈策略"],
      actions: ["路由模型", "设置回退", "学习策略"]
    },
    text_generate: {
      role: "文案输出",
      intent: "生成脚本、文案、分镜说明或结构化文本",
      takeover: ["改语言", "改结构", "查看输出"],
      actions: ["生成文案", "保存提示词", "追踪日志"]
    },
    image_generate: {
      role: "图片提示词",
      intent: "生成可用于图片模型的画面提示词和引用包",
      takeover: ["改尺寸", "改引用", "替换素材"],
      actions: ["打包引用", "选择图片模型", "预览图片方案"]
    },
    video_generate: {
      role: "视频方案",
      intent: "生成 TikTok 视频方案、分镜、画面提示词和执行日志",
      takeover: ["改比例", "改时长", "改质量"],
      actions: ["分镜清单", "画面提示词", "仅预览"]
    },
    preview: {
      role: "结果预览",
      intent: "展示结果对象、提示词记录、日志和 Pi session",
      takeover: ["查看追溯", "接受结果", "转素材"],
      actions: ["渲染预览", "关联追踪", "保存素材"]
    },
    预览: {
      role: "结果预览",
      intent: "展示结果对象、提示词记录、日志和 Pi session",
      takeover: ["查看追溯", "接受结果", "转素材"],
      actions: ["渲染预览", "关联追踪", "保存素材"]
    },
    human_review: {
      role: "人工审核",
      intent: "人工检查输出是否符合品牌和业务目标",
      takeover: ["通过", "要求修改", "写反馈"],
      actions: ["审核结果", "控制导出", "提交反馈"]
    },
    feedback: {
      role: "反馈学习",
      intent: "把用户反馈写入记忆、品牌、技能、模型策略和素材标签",
      takeover: ["选择对象", "写评价", "设复用/避免"],
      actions: ["写入记忆", "更新品牌", "进化技能"]
    },
    export: {
      role: "导出",
      intent: "把已确认结果整理成可交付输出",
      takeover: ["选择格式", "检查文件", "归档输出"],
      actions: ["打包输出", "写入交付数据", "记录交付"]
    },
    archive: {
      role: "归档",
      intent: "保存工作流、结果、日志和反馈，供下次复用",
      takeover: ["查看历史", "复用模板", "清理草稿"],
      actions: ["保存快照", "持久化对象", "索引记忆"]
    }
  };
  return profiles[type] ?? {
    role: "控制步",
    intent: "控制工作流状态和上下游对象关系",
    takeover: ["编辑节点", "禁用节点", "追加步骤"],
    actions: ["更新节点", "持久化节点", "追踪变更"]
  };
}

function preferredNodeModuleDrawer(type: string): Exclude<NodeModuleDrawer, null> {
  if (type === "brand_context") return "brand";
  if (type === "asset_search" || type === "asset_input") return "asset";
  if (type === "skill_search" || type === "skill_create" || type === "skill_execute") return "skill";
  if (type === "model_select") return "model";
  if (type === "video_generate" || type === "image_generate" || type === "text_generate" || type === "prompt_generate" || type === "goal") return "params";
  if (type === "预览" || type === "human_review" || type === "feedback") return "brand";
  return "params";
}

function dispatchNodeParamChange(nodeId: string, key: string, value: string) {
  window.dispatchEvent(new CustomEvent("workgraph-node-param-change", {
    detail: { nodeId, patch: { [key]: value } }
  }));
}

function dispatchNodeAction(nodeId: string, action: string) {
  window.dispatchEvent(new CustomEvent("workgraph-node-action", {
    detail: { nodeId, action }
  }));
}

function StudioNode({ data, selected }: NodeProps<Node<{ 节点: WorkGraphNode; activeNodeId?: string }>>) {
  const node = data.节点;
  const moduleKind = nodeModuleKind(node.type);
  const nodeKindStyle = moduleKind === "brand"
    ? "bg-amber-300/15 text-amber-200"
    : moduleKind === "asset"
    ? "bg-emerald-300/15 text-emerald-200"
    : moduleKind === "skill"
    ? "bg-violet-300/15 text-violet-200"
    : moduleKind === "model"
    ? "bg-cyan-300/15 text-cyan-200"
    : moduleKind === "video"
    ? "bg-rose-300/15 text-rose-200"
    : moduleKind === "visual"
    ? "bg-sky-300/15 text-sky-200"
    : moduleKind === "text"
    ? "bg-slate-300/15 text-slate-200"
    : moduleKind === "review"
    ? "bg-lime-300/15 text-lime-200"
    : "bg-slate-500/15 text-slate-300";
  const nodeKindTag = moduleKind === "brand"
    ? "品牌"
    : moduleKind === "asset"
    ? "素材"
    : moduleKind === "skill"
    ? "技能"
    : moduleKind === "model"
    ? "模型"
    : moduleKind === "video"
    ? "视频"
    : moduleKind === "visual"
    ? "画面"
    : moduleKind === "text"
    ? "文本"
    : moduleKind === "review"
    ? "评估"
    : "控制";
  const isMedia = moduleKind === "asset" || moduleKind === "visual" || moduleKind === "video";
  const firstAsset = node.assetPreviews?.[0];
  const operationProfile = nodeOperationProfile(node.type);
  const isActive = selected || data.activeNodeId === node.id;
  const statusTone = /失败|error/i.test(node.status || "")
    ? "failed"
    : /完成|done|success|成功/i.test(node.status || "")
    ? "done"
    : "ready";
  const statusProgressClass = /失败|error/i.test(node.status || "")
    ? "w-1/2 bg-red-400"
    : /完成|done|success/i.test(node.status || "")
    ? "w-full bg-emerald-300"
    : "w-1/3 bg-cyan-300";
  const nodeFrameClassName = cn(
    "wg-studio-node w-[210px] overflow-hidden rounded-md border bg-[#111417]/96 backdrop-blur transition",
    isActive ? "border-cyan-300/90 ring-2 ring-cyan-300/30" : "border-slate-700/70 ring-0 hover:border-slate-500/70",
    node.disabled && "opacity-50"
  );
  const dropHandlers = {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const assetId = assetIdFromDataTransfer(event.dataTransfer);
      if (!assetId) return;
      window.dispatchEvent(new CustomEvent("workgraph-asset-drop", {
        detail: { assetId, nodeId: node.id }
      }));
    }
  };

  if (!isActive) {
    return (
      <div
        {...dropHandlers}
        className={nodeFrameClassName}
        data-workgraph-node="true"
        data-graph-node="true"
        data-node-card-layout="execution-step"
        data-node-visual-hierarchy="status-rail"
        data-node-render-mode="flow-summary"
        data-node-active="false"
        data-node-status-tone={statusTone}
      >
        <Handle type="target" position={Position.Left} />
        <span className="wg-node-status-rail" aria-hidden="true" data-node-status-rail="true" />
        <div className="wg-node-status-strip flex h-6 items-center justify-between gap-1.5 border-b border-white/10 px-2 text-[12px]" data-node-status-strip="true" data-node-status-layout="step-header">
          <span className={cn("rounded px-1.5 py-0.5 uppercase", nodeKindStyle)} data-node-kind-tag="true">{nodeKindTag}</span>
          <span className="ml-auto shrink-0 text-slate-300">{node.status || "就绪"}</span>
        </div>
        <div className="wg-node-title-block border-b border-white/8 px-2 py-2" data-node-title-block="true" data-node-title-layout="primary-step" data-node-title-density="compact">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-slate-100">{displayNodeTitle(node)}</div>
              <p className="mt-0.5 line-clamp-1 text-[12px] leading-5 text-slate-500" data-node-intent-line="true">{operationProfile.intent}</p>
            </div>
            <span className="wg-node-index-pill shrink-0 rounded px-1.5 py-0.5 text-[12px]" title={node.id}>{displayNodeShortId(node)}</span>
          </div>
        </div>
        <div className="wg-node-progress h-0.5 bg-slate-800" data-node-progress-bar="true">
          <div className={cn("h-full", statusProgressClass)} />
        </div>
        <div className="wg-node-summary-row grid min-h-0 gap-1 p-1.5" data-node-summary-row="true" data-node-section="operation">
          <div className="wg-node-operation rounded-md border border-white/10 bg-black/18 p-1.5" data-node-operation-profile="true" data-node-operation-layout="action-summary" data-node-operation-density="compact" data-node-operation-panel="true" data-node-section="operation">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12.5px] font-semibold text-cyan-100">{operationProfile.role}</span>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[12px]", moduleKind === "video" && "bg-rose-400/12 text-rose-200", moduleKind === "skill" && "bg-violet-400/12 text-violet-200", moduleKind === "model" && "bg-cyan-400/12 text-cyan-200", "bg-slate-800 text-slate-400")}>{displayModuleKind(moduleKind)}</span>
            </div>
          </div>
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div
      {...dropHandlers}
      className={nodeFrameClassName}
      data-workgraph-node="true"
      data-graph-node="true"
      data-node-card-layout="execution-step"
      data-node-visual-hierarchy="status-rail"
      data-node-render-mode="active-detail"
      data-node-active={isActive ? "true" : "false"}
      data-node-status-tone={statusTone}
    >
      <Handle type="target" position={Position.Left} />
      <span className="wg-node-status-rail" aria-hidden="true" data-node-status-rail="true" />
      <div className="wg-node-status-strip flex h-6 items-center justify-between gap-1.5 border-b border-white/10 px-2 text-[12px]" data-node-status-strip="true" data-node-status-layout="step-header">
        <span className={cn("rounded px-1.5 py-0.5 uppercase", nodeKindStyle)} data-node-kind-tag="true">{nodeKindTag}</span>
        <span className="truncate text-slate-500">{displayNodeType(node.type)}</span>
        <span className="ml-auto shrink-0 text-slate-300">{node.status || "就绪"}</span>
      </div>
      <div className="wg-node-title-block border-b border-white/8 px-2 py-2" data-node-title-block="true" data-node-title-layout="primary-step" data-node-title-density="compact">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-slate-100">{displayNodeTitle(node)}</div>
            <p className="mt-0.5 line-clamp-1 text-[12px] leading-5 text-slate-500" data-node-intent-line="true">{operationProfile.intent}</p>
          </div>
          <span className="wg-node-index-pill shrink-0 rounded px-1.5 py-0.5 text-[12px]" title={node.id}>{displayNodeShortId(node)}</span>
        </div>
      </div>
      <div className="wg-node-progress h-0.5 bg-slate-800" data-node-progress-bar="true">
        <div className={cn("h-full", statusProgressClass)} />
      </div>
      <div className="wg-node-body-grid grid gap-1 p-1.5" data-node-body-density="compact" data-node-body-fit="short-card" data-node-body-layout="fixed-step">
        {isMedia && (
          <div className="grid h-11 place-items-center overflow-hidden rounded-md border border-white/10 bg-black/40" data-node-media-preview-density="compact">
            {firstAsset?.thumbnailUrl || firstAsset?.预览Url ? (
              <img src={firstAsset.thumbnailUrl || firstAsset.预览Url} alt={firstAsset.title || node.title} className="h-full w-full object-cover" />
            ) : moduleKind === "video" ? (
              <div className="grid h-9 w-12 place-items-center rounded-md bg-slate-800 text-rose-200"><Play className="h-4 w-4" /></div>
            ) : (
              <Image className="h-5 w-5 text-slate-600" />
            )}
          </div>
        )}
          <div className="wg-node-operation rounded-md border border-white/10 bg-black/18 p-1.5" data-node-operation-profile="true" data-node-operation-layout="action-summary" data-node-operation-density="compact" data-node-operation-panel="true" data-node-section="operation">
            <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12.5px] font-semibold text-cyan-100">{operationProfile.role}</span>
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[12px]", moduleKind === "video" && "bg-rose-400/12 text-rose-200", moduleKind === "skill" && "bg-violet-400/12 text-violet-200", moduleKind === "model" && "bg-cyan-400/12 text-cyan-200", "bg-slate-800 text-slate-400")}>{displayModuleKind(moduleKind)}</span>
          </div>
          <div className="mt-1 flex gap-1 overflow-hidden" data-node-action-strip="true" data-node-action-strip-mode="quiet">
            {operationProfile.actions.slice(0, 3).map((action) => (
              <span key={action} className="truncate rounded bg-white/5 px-1.5 py-0.5 text-[12px] text-slate-500">{action}</span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 text-[12px] text-slate-500" data-node-mini-metrics="true" data-node-metrics-layout="single-row" data-node-section="metrics">
          <span className="truncate rounded bg-black/24 px-1.5 py-1" title={node.modelId || node.modelTitle || "自动模型"} data-node-metric="model">模型 {node.modelTitle || displayShortId(node.modelId || "自动")}</span>
          <span className="truncate rounded bg-black/24 px-1.5 py-1" data-node-metric="asset">素材 {node.materialIds?.length ?? 0}</span>
          <span className="truncate rounded bg-black/24 px-1.5 py-1" data-node-metric="log">日志 {node.logCount ?? 0}</span>
        </div>

        {moduleKind === "brand" && (
          <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[12.5px] leading-5 text-amber-100/80" data-node-detail-density="one-line">
            <p className="line-clamp-1"><span className="font-semibold text-amber-200">品牌</span> · {node.body || "读取品牌上下文、禁用词、风格规则。"}</p>
          </div>
        )}
        {moduleKind === "skill" && (
          <div className="rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[12.5px] leading-5" data-node-detail-density="one-line">
            <p className="truncate text-violet-200"><span className="font-semibold">技能</span> · {node.skillTitle || node.skillId || node.skillCommand || "自动技能"}</p>
          </div>
        )}
        {moduleKind === "model" && (
          <div className="grid grid-cols-2 gap-1 text-[12.5px]" data-node-detail-density="one-line">
            <div className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-0.5 text-cyan-200" title={node.modelId || "自动模型"}>{node.modelTitle || "自动模型"}</div>
            <div className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-0.5 text-slate-300">{node.modelStrategy || "balanced"}</div>
          </div>
        )}

        <p className="line-clamp-1 text-[12.5px] leading-5 text-slate-300" data-node-result-summary="true" data-node-section="result">{displayTextAlias(node.resultPreview || node.body) || "等待节点输入"}</p>
        <div className="wg-node-action-bar grid grid-cols-[minmax(0,1fr)_28px_28px] gap-1" data-node-action-style="icon-compact" data-node-section="actions">
          <button className="flex h-7 min-w-0 items-center justify-center gap-1 rounded-md bg-cyan-300 px-2 text-[12px] font-semibold text-slate-950" title="运行当前节点" aria-label="运行当前节点" onClick={() => dispatchNodeAction(node.id, "run")} data-node-card-action="run">
            <Play className="h-3.5 w-3.5" />
            <span className="truncate">运行</span>
          </button>
          <button className="grid h-7 place-items-center rounded-md border border-white/10 px-1 text-[12px] text-slate-300" title="重试当前节点" aria-label="重试当前节点" onClick={() => dispatchNodeAction(node.id, "retry")} data-node-card-action="retry">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-7 place-items-center rounded-md border border-white/10 px-1 text-[12px] text-slate-300" title="打开节点参数" aria-label="打开节点参数" onClick={() => dispatchNodeAction(node.id, "params")} data-node-card-action="params">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { studio: StudioNode };
const CANVAS_TOP_SAFE_PX = 48;

async function fitCanvasWithSafeTop(instance: ReactFlowInstance<Node<{ 节点: WorkGraphNode }>, Edge>, duration = 250) {
  await instance.fitView({ padding: 0.1, duration, maxZoom: 0.72 });
  const viewport = instance.getViewport();
  instance.setViewport({ ...viewport, y: viewport.y + CANVAS_TOP_SAFE_PX }, { duration });
}

function nodePosition(index: number) {
  const columns = 4;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 80 + column * 248,
    y: 128 + row * 176
  };
}

function enrichNodeForCanvas(node: WorkGraphNode, context?: { assets?: AssetObject[]; skills?: SkillDetail["skill"][]; models?: ModelOption[]; results?: ResultObject[]; logs?: ExecutionLogEntry[]; modelPolicies?: ModelPolicyObject[] }) {
  const assetPreviews = (node.materialIds ?? [])
    .map((id) => context?.assets?.find((asset) => asset.id === id))
    .filter(Boolean) as WorkGraphNode["assetPreviews"];
  const skill = node.skillId ? context?.skills?.find((item) => item.id === node.skillId) : undefined;
  const result = context?.results?.find((item) => item.nodeId === node.id || item.trace?.nodeId === node.id);
  const resultFeedbackIds = result?.feedbackIds ?? result?.trace?.feedbackIds ?? [];
  const modelPolicy = context?.modelPolicies?.find((policy) => policy.targetId === node.id)
    ?? context?.modelPolicies?.find((policy) => policy.targetId === result?.id || Boolean(policy.feedbackId && resultFeedbackIds.includes(policy.feedbackId)));
  const logCount = context?.logs?.filter((log) => log.nodeId === node.id).length ?? 0;
  return {
    ...node,
    assetPreviews,
    modelTitle: displayModelName(node.modelId, context?.models),
    skillTitle: displayTextAlias(skill?.title),
    skillCommand: displayTextAlias(skill?.command),
    resultPreview: displayTextAlias(result?.预览 || result?.输出),
    resultKind: result?.kind,
    logCount,
    modelPolicy
  };
}

function toFlowNodes(nodes: WorkGraphNode[], context?: { assets?: AssetObject[]; skills?: SkillDetail["skill"][]; models?: ModelOption[]; results?: ResultObject[]; logs?: ExecutionLogEntry[]; modelPolicies?: ModelPolicyObject[] }, activeNodeId?: string): Node<{ 节点: WorkGraphNode; activeNodeId?: string }>[] {
  return nodes.map((node, index) => ({
    id: node.id,
    type: "studio",
    selected: activeNodeId === node.id,
    position: typeof node.x === "number" && typeof node.y === "number" ? { x: node.x, y: node.y } : nodePosition(index),
    data: { 节点: enrichNodeForCanvas(node, context), activeNodeId }
  }));
}

function fallbackNodes(提示词: string): WorkGraphNode[] {
  return [
    { id: "goal", title: "目标", type: "goal", body: 提示词, status: "就绪" },
    { id: "brand", title: "品牌上下文", type: "brand_context", body: "读取 DAPOT 品牌规则和禁用项", status: "就绪" },
    { id: "asset", title: "素材检索", type: "asset_search", body: "搜索品牌素材、参考图、开业场景素材", status: "就绪" },
    { id: "skill", title: "视频技能", type: "skill_search", body: "搜索或创建 TikTok 视频方案技能", status: "就绪" },
    { id: "model", title: "模型策略", type: "model_select", body: "按节点选择文本/图片/视频模型策略", status: "就绪" },
    { id: "预览", title: "预览结果", type: "预览", body: "生成分镜、文案、画面提示词和执行日志", status: "就绪" },
    { id: "feedback", title: "反馈记忆", type: "feedback", body: "将用户反馈写入品牌和记忆", status: "就绪" }
  ];
}

function fallbackEdges(nodes: WorkGraphNode[]): Edge[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
    animated: index < 4
  }));
}

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="section-title flex h-7 items-center gap-2 border-b border-white/12 px-3 text-[12.5px] font-semibold uppercase tracking-wide text-slate-200">
      <Icon className="h-3.5 w-3.5 text-cyan-300" />
      {children}
    </div>
  );
}

export default function WorkGraphStudio() {
  const {
    提示词,
    setPrompt,
    activeObjectType,
    setActiveObjectType,
    activeNodeId,
    setActiveNodeId,
    bottomTab,
    setBottomTab,
    previewExpanded,
    setPreviewExpanded,
    skillDrawerOpen,
    setSkillDrawerOpen
  } = useStudioStore();
  const prompt = 提示词;
  const [workspace, setWorkspace] = useState<WorkspacePayload["workspace"]>(null);
  const [objects, setObjects] = useState<WorkGraphObject[]>([]);
  const [brands, setBrands] = useState<BrandObject[]>([]);
  const [assets, setAssets] = useState<AssetObject[]>([]);
  const [skills, setSkills] = useState<SkillDetail["skill"][]>([]);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("本地就绪");
  const [feedbackNote, setFeedbackNote] = useState("这个方案要更干净可信，避免廉价感，适合 DAPOT");
  const [feedbackTargetValue, setFeedbackTargetValue] = useState("");
  const [feedbackRating, setFeedbackRating] = useState<"accepted" | "needs_revision" | "failed">("needs_revision");
  const [feedbackAction, setFeedbackAction] = useState<"reuse" | "revise" | "avoid">("avoid");
  const [activeSkillFilePath, setActiveSkillFilePath] = useState("SKILL.md");
  const [skillFileDraft, setSkillFileDraft] = useState("");
  const [skillOptimizePrompt, setSkillOptimizePrompt] = useState("强化 DAPOT TikTok 开业视频：少文字、干净可信、泰语优先、避免廉价拼接感。");
  const [skillOptimizePreview, setSkillOptimizePreview] = useState<SkillOptimizePreview | null>(null);
  const [skillTestResult, setSkillTestResult] = useState<SkillTestResult | null>(null);
  const [nodeSkillQuery, setNodeSkillQuery] = useState("TikTok DAPOT video");
  const [nodeSkillSearchResults, setNodeSkillSearchResults] = useState<SkillDetail["skill"][]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [sqliteStatus, setSqliteStatus] = useState<SqliteStatus | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus | null>(null);
  const [piSessions, setPiSessions] = useState<PiSessionSummary[]>([]);
  const [piSessionDetail, setPiSessionDetail] = useState<PiSessionDetail | null>(null);
  const [lastFeedbackLearning, setLastFeedbackLearning] = useState<FeedbackLearning | null>(null);
  const [nodeModuleDrawer, setNodeModuleDrawer] = useState<NodeModuleDrawer>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("goal");
  const [goalComposerDraft, setGoalComposerDraft] = useState(prompt);
  const [nodeComposerDraft, setNodeComposerDraft] = useState("");
  const [workspaceLoadState, setWorkspaceLoadState] = useState<"booting" | "loaded" | "fallback" | "失败">("booting");
  const [runningNodeId, setRunningNodeId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"overview" | "modules" | "trace">("overview");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [resourceCollapsed, setResourceCollapsed] = useState(true);
  const [layoutPreferencesLoaded, setLayoutPreferencesLoaded] = useState(false);
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false);
  const [isGoalDragOver, setIsGoalDragOver] = useState(false);
  const [objectSearchTerm, setObjectSearchTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const goalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const goalComposerDirtyRef = useRef(false);
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node<{ 节点: WorkGraphNode }>, Edge> | null>(null);
  const plannedNodes = useMemo(() => workspace?.nodes?.length ? workspace.nodes : fallbackNodes(prompt), [workspace, prompt]);
  const plannedEdges = useMemo<Edge[]>(() => {
    if (workspace?.edges?.length) {
      return workspace.edges.map((edge, index) => ({
        id: edge.id || `edge-${index}`,
        source: edge.source,
        target: edge.target
      }));
    }
    return fallbackEdges(plannedNodes);
  }, [workspace, plannedNodes]);
  const persistedActiveNodeId = typeof workspace?.activeNodeId === "string" ? workspace.activeNodeId : "";
  const canvasActiveNodeId = activeNodeId || persistedActiveNodeId || plannedNodes[0]?.id || "";
  const nodeCanvasContext = useMemo(() => ({
    assets: [...assets, ...(workspace?.materials ?? [])],
    skills,
    models,
    results: workspace?.results ?? [],
    logs: workspace?.executionLog ?? [],
    modelPolicies: workspace?.modelPolicies ?? []
  }), [assets, models, skills, workspace?.executionLog, workspace?.materials, workspace?.modelPolicies, workspace?.results]);
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(plannedNodes, nodeCanvasContext, canvasActiveNodeId));
  const [edges, setEdges, onEdgesChange] = useEdgesState(plannedEdges);
  const persistNodePositions = useCallback((flowNodes: Node<{ 节点: WorkGraphNode }>[]) => {
    const currentWorkspace = workspace ?? baseWorkspace();
    const positionById = new Map(flowNodes.map((node) => [node.id, node.position]));
    const nextNodes = (currentWorkspace.nodes ?? plannedNodes).map((node) => {
      const position = positionById.get(node.id);
      return position ? { ...node, x: Math.round(position.x), y: Math.round(position.y) } : node;
    });
    void persistWorkspace({ ...currentWorkspace, nodes: nextNodes }, "node layout saved");
  }, [plannedNodes, workspace]);
  const handleNodesChange = useCallback((changes: NodeChange<Node<{ 节点: WorkGraphNode }>>[]) => {
    onNodesChange(changes);
    if (!changes.some((change) => change.type === "position" && "dragging" in change && change.dragging === false)) return;
    setNodes((currentNodes) => {
      persistNodePositions(currentNodes);
      return currentNodes;
    });
  }, [onNodesChange, persistNodePositions, setNodes]);

  const activeNode = useMemo(() => {
    return plannedNodes.find((node) => node.id === canvasActiveNodeId) || plannedNodes[0];
  }, [canvasActiveNodeId, plannedNodes]);

  useEffect(() => {
    setNodeComposerDraft(activeNode?.body || "");
  }, [activeNode?.id, activeNode?.body]);

  const filteredObjects = useMemo(() => {
    const keyword = objectSearchTerm.trim().toLowerCase();
    return objects.filter((item) => item.type === activeObjectType).filter((item) => {
      if (!keyword) return true;
      return (
        item.title.toLowerCase().includes(keyword)
        || item.summary.toLowerCase().includes(keyword)
        || item.id.toLowerCase().includes(keyword)
      );
    });
  }, [objects, activeObjectType, objectSearchTerm]);

  function activateNode(nodeId: string) {
    const node = plannedNodes.find((item) => item.id === nodeId);
    setActiveNodeId(nodeId);
    if (node) setNodeModuleDrawer(preferredNodeModuleDrawer(node.type));
    void persistWorkspace({ ...(workspace ?? baseWorkspace()), activeNodeId: nodeId }, "当前节点已切换");
  }

  function openNodeModule(drawer: Exclude<NodeModuleDrawer, null>) {
    // Drawer mutual exclusion (agy review条件1): the right-side inspector module
    // drawer and the 520px skill drawer are two heavy right surfaces — only one
    // may be open at a time, otherwise the "多面板叠加" density regresses.
    setSkillDrawerOpen(false);
    setInspectorCollapsed(false);
    setInspectorTab("modules");
    setNodeModuleDrawer(drawer);
  }

  function resetStudioLayout() {
    removeStoredLayoutBooleans();
    setResourceCollapsed(false);
    setInspectorCollapsed(false);
    setBottomTab("预览");
    setStatus("布局已恢复");
  }

  function enterFocusMode() {
    setResourceCollapsed(true);
    setInspectorCollapsed(true);
    setBottomTab("预览");
    setStatus("专注模式");
  }

  function setViewMode(mode: ViewMode) {
    if (mode === "full") {
      resetStudioLayout();
      return;
    }
    if (mode === "focus") {
      enterFocusMode();
      return;
    }
    if (mode === "resource") {
      setResourceCollapsed(false);
      setInspectorCollapsed(true);
      setStatus("资源视图");
      return;
    }
    setResourceCollapsed(true);
    setInspectorCollapsed(false);
    setStatus("参数视图");
  }

  // Drawer mutual exclusion (agy review条件1, reverse direction): whenever the
  // 520px skill drawer is open it is the sole right surface — collapse the
  // inspector module drawer so the two never stack.
  useEffect(() => {
    if (skillDrawerOpen) setInspectorCollapsed(true);
  }, [skillDrawerOpen]);

  function baseWorkspace(): WorkGraphWorkspace {
    return {
      version: 1,
      prompt,
      activeBrandId: "brand-dapot",
      activeModelId: "imgen",
      selectedIds: [],
      activeMaterialId: "",
      activeSkillId: "",
      materials: [],
      skills: [],
      models: [],
      nodes: fallbackNodes(prompt),
      edges: fallbackEdges(fallbackNodes(prompt)).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      jobs: [],
      results: [],
      feedback: [],
      memories: [],
      executionLog: [],
      promptRecords: [],
      updatedAt: new Date().toISOString()
    };
  }

  async function persistWorkspace(nextWorkspace: WorkGraphWorkspace, nextStatus = "工作区已保存") {
    setBusy(true);
    setStatus("正在保存工作区");
    try {
      const response = await api("/workgraph-os/workspace", {
        method: "PUT",
        body: JSON.stringify({
          ...baseWorkspace(),
          ...(workspace ?? {}),
          ...nextWorkspace,
          version: 1,
          prompt: nextWorkspace.prompt ?? workspace?.prompt ?? prompt,
          updatedAt: new Date().toISOString()
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as WorkspacePayload;
      setWorkspace(payload.workspace ?? null);
      setObjects(payload.objectIndex?.objects ?? []);
      setStatus(nextStatus);
      void loadOpsStatus();
      return payload.workspace ?? null;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function patchActiveNode(patch: Partial<WorkGraphNode>, nextStatus = "节点已更新") {
    if (!activeNode) return;
    const nextNodes = plannedNodes.map((node) => node.id === activeNode.id ? { ...node, ...patch } : node);
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: activeNode.id }, nextStatus);
  }

  async function patchActiveNodeParams(patch: Record<string, string | number | boolean>) {
    if (!activeNode) return;
    await patchActiveNode({ params: { ...(activeNode.params ?? {}), ...patch } }, "节点参数已保存");
  }

  async function applyComposerToNode() {
    if (!activeNode || busy) return;
    const nextBody = nodeComposerDraft.trim();
    if (!nextBody) {
      openNodeModule("params");
      setStatus("请输入节点指令");
      return;
    }
    await patchActiveNode({ body: nextBody }, "节点输入已更新");
    openNodeModule("params");
  }

  async function submitComposer() {
    if (composerMode === "node") {
      await applyComposerToNode();
      return;
    }
    await planGoal(goalComposerDraft);
  }

  async function patchNodeParams(nodeId: string, patch: Record<string, string | number | boolean>) {
    const target = plannedNodes.find((node) => node.id === nodeId);
    if (!target) return;
    const nextNodes = plannedNodes.map((node) => node.id === nodeId ? { ...node, params: { ...(node.params ?? {}), ...patch } } : node);
    activateNode(nodeId);
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: nodeId }, "画布参数已保存");
  }

  async function autoLayoutGraph() {
    const nextNodes = plannedNodes.map((node, index) => ({
      ...node,
      ...nodePosition(index)
    }));
    setNodes(toFlowNodes(nextNodes, nodeCanvasContext, canvasActiveNodeId));
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: activeNode?.id || nextNodes[0]?.id || "" }, "画布自动重排已保存");
    if (reactFlowInstance) void fitCanvasWithSafeTop(reactFlowInstance, 250);
  }

  async function bindAssetToNode(assetId: string, nodeId = activeNode?.id, nextStatus = "素材已绑定到节点") {
    if (!assetId || !nodeId) return;
    const target = plannedNodes.find((node) => node.id === nodeId);
    if (!target) return;
    const materialIds = Array.from(new Set([...(target.materialIds ?? []), assetId]));
    const nextNodes = plannedNodes.map((node) => node.id === nodeId ? { ...node, materialIds } : node);
    activateNode(nodeId);
    openNodeModule("asset");
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: nodeId, activeMaterialId: assetId }, nextStatus);
  }

  async function unbindAssetFromNode(assetId: string, nodeId = activeNode?.id) {
    if (!assetId || !nodeId) return;
    const target = plannedNodes.find((node) => node.id === nodeId);
    if (!target) return;
    const materialIds = (target.materialIds ?? []).filter((id) => id !== assetId);
    const nextNodes = plannedNodes.map((node) => node.id === nodeId ? { ...node, materialIds } : node);
    activateNode(nodeId);
    openNodeModule("asset");
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: nodeId, activeMaterialId: materialIds[0] || "" }, "素材已从节点移除");
  }

  function nodeIdFromCanvasPoint(clientX: number, clientY: number) {
    const droppedNodeId = (document.elementFromPoint(clientX, clientY)?.closest(".react-flow__node") as HTMLElement | null)?.dataset.id;
    if (droppedNodeId) return droppedNodeId;
    const bounds = reactFlowWrapperRef.current?.getBoundingClientRect();
    const point = reactFlowInstance && bounds
      ? reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY })
      : null;
    const targetNode = point
      ? nodes.find((node) => {
          const width = Number(node.measured?.width ?? node.width ?? 224);
          const height = Number(node.measured?.height ?? node.height ?? 130);
          return point.x >= node.position.x
            && point.x <= node.position.x + width
            && point.y >= node.position.y
            && point.y <= node.position.y + height;
        })
      : undefined;
    return targetNode?.id || activeNode?.id;
  }

  async function handleAssetDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsCanvasDragOver(false);
    const nodeId = nodeIdFromCanvasPoint(event.clientX, event.clientY);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      await uploadAssetFile(droppedFile, nodeId);
      return;
    }
    const assetId = assetIdFromDataTransfer(event.dataTransfer);
    if (!assetId) return;
    await bindAssetToNode(assetId, nodeId, nodeId ? "素材已拖拽到节点" : "素材已拖拽到当前节点");
  }

  async function handleGoalComposerDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsGoalDragOver(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      await uploadAssetFile(droppedFile, activeNode?.id);
      goalInputRef.current?.focus();
      return;
    }
    const assetId = assetIdFromDataTransfer(event.dataTransfer);
    if (!assetId) return;
    await bindAssetToNode(assetId, activeNode?.id, "素材已拖入目标输入区");
    goalInputRef.current?.focus();
  }

  function handleGoalComposerDrag(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsGoalDragOver(true);
  }

  async function handleGoalInputPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFile = Array.from(event.clipboardData.files ?? [])[0]
      ?? Array.from(event.clipboardData.items ?? [])
        .find((item) => item.kind === "file")
        ?.getAsFile();
    if (!pastedFile) return;
    event.preventDefault();
    await uploadAssetFile(pastedFile, activeNode?.id);
    goalInputRef.current?.focus();
  }

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ assetId?: string; nodeId?: string }>).detail;
      if (!detail?.assetId || !detail.nodeId) return;
      void bindAssetToNode(detail.assetId, detail.nodeId, "素材已拖拽到节点");
    };
    window.addEventListener("workgraph-asset-drop", listener);
    return () => window.removeEventListener("workgraph-asset-drop", listener);
  });

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; patch?: Record<string, string | number | boolean> }>).detail;
      if (!detail?.nodeId || !detail.patch) return;
      void patchNodeParams(detail.nodeId, detail.patch);
    };
    window.addEventListener("workgraph-node-param-change", listener);
    return () => window.removeEventListener("workgraph-node-param-change", listener);
  });

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; action?: string }>).detail;
      if (!detail?.nodeId || !detail.action) return;
      activateNode(detail.nodeId);
      if (detail.action === "run") void runNode(detail.nodeId);
      if (detail.action === "retry") void retryNode(detail.nodeId);
      if (detail.action === "skill") openNodeModule("skill");
      if (detail.action === "model") openNodeModule("model");
      if (detail.action === "asset") openNodeModule("asset");
      if (detail.action === "params") {
        openNodeModule("params");
      }
      if (detail.action === "save-skill") void saveNodeAsSkill(detail.nodeId);
      if (detail.action === "add-after") void addNodeAfter(detail.nodeId);
    };
    window.addEventListener("workgraph-node-action", listener);
    return () => window.removeEventListener("workgraph-node-action", listener);
  });

  async function deleteActiveNode() {
    if (!activeNode) return;
    const nextNodes = plannedNodes.filter((node) => node.id !== activeNode.id);
    const nextEdges = plannedEdges
      .filter((edge) => edge.source !== activeNode.id && edge.target !== activeNode.id)
      .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
    if (nextNodes[0]) activateNode(nextNodes[0].id);
    else setActiveNodeId("");
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, edges: nextEdges, activeNodeId: nextNodes[0]?.id ?? "" }, "节点已删除");
  }

  async function addNodeAfter(sourceNodeId?: string) {
    const sourceNode = plannedNodes.find((node) => node.id === sourceNodeId) ?? activeNode ?? plannedNodes[plannedNodes.length - 1];
    const nextNode: WorkGraphNode = {
      id: `node-${Date.now().toString(36)}`,
      title: "手动节点",
      type: "skill_execute",
      body: "手动新增节点：补充 Prompt、Skill、模型和素材后运行。",
      status: "就绪",
      modelId: workspace?.activeModelId || "imgen",
      modelStrategy: "balanced"
    };
    const nextNodes = [...plannedNodes, nextNode];
    const nextEdges = [
      ...plannedEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      ...(sourceNode ? [{ id: `edge-${sourceNode.id}-${nextNode.id}`, source: sourceNode.id, target: nextNode.id }] : [])
    ];
    activateNode(nextNode.id);
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, edges: nextEdges, activeNodeId: nextNode.id }, "节点已新增");
  }

  async function addNodeAfterActive() {
    await addNodeAfter(activeNode?.id);
  }

  function skillOptimizationPromptForNode(节点: WorkGraphNode, skillTitle?: string) {
    return [
      `优化 ${skillTitle || 节点.title || "当前节点"} Skill，使它更适合 DAPOT 新店开业 TikTok 视频。`,
      "要求：泰语优先、少文字、年轻女性喜欢、干净可信、温暖、好复制、适合拍照传播。",
      "避免：廉价感、拼接感、文字太多、不落地、过度复杂、低质卡通、杂乱背景。",
      `节点类型：${节点.type}`,
      节点.body ? `节点上下文：${节点.body}` : ""
    ].filter(Boolean).join("\n");
  }

  async function saveNodeAsSkill(nodeId?: string) {
    const targetNode = plannedNodes.find((node) => node.id === nodeId) ?? activeNode;
    if (!targetNode) return;
    setBusy(true);
    setStatus("节点技能化中");
    try {
      const response = await api("/workgraph-os/skills", {
        method: "POST",
        body: JSON.stringify({
          title: `${targetNode.title} 技能`,
          command: `/${targetNode.type}-${targetNode.id}`.replace(/[^a-z0-9/_-]+/gi, "-").toLowerCase(),
          输出: /video/i.test(targetNode.type) ? "MP4" : "Preview",
          description: targetNode.body || `从节点 ${targetNode.id} 生成的技能`,
          keywords: [targetNode.type, "节点技能", "workgraph-os"],
          capabilityType: /video/i.test(targetNode.type) ? "video_planning" : "custom"
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setWorkspace(payload.workspace ?? workspace);
      setObjects(payload.objectIndex?.objects ?? objects);
      await loadLibraries();
      const nextNodes = plannedNodes.map((node) => node.id === targetNode.id ? { ...node, skillId: payload.skill?.id } : node);
      activateNode(targetNode.id);
      openNodeModule("skill");
      await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: targetNode.id }, "节点已保存为技能");
      if (payload.skill?.id) await openSkill(payload.skill.id, {
        optimizePrompt: skillOptimizationPromptForNode(targetNode, payload.skill.title)
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存技能失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveActiveNodeAsSkill() {
    await saveNodeAsSkill(activeNode?.id);
  }

  async function bindSkillToActiveNode(skillId: string, nextStatus = "技能已绑定到节点") {
    if (!skillId || !activeNode) return;
    await patchActiveNode({ skillId }, nextStatus);
    await openSkill(skillId, {
      optimizePrompt: skillOptimizationPromptForNode(activeNode)
    });
  }

  async function searchSkillForNode() {
    const query = nodeSkillQuery.trim() || [activeNode?.title, activeNode?.type, activeNode?.body, prompt].filter(Boolean).join(" ");
    setBusy(true);
    setStatus("本地技能搜索中");
    try {
      const response = await api(`/workgraph-os/skills?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const results = (payload.skills ?? []) as SkillDetail["skill"][];
      setNodeSkillSearchResults(results);
      setStatus(results.length ? `已找到 ${results.length} 个本地技能` : "未匹配到技能，请创建草稿");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能搜索失败");
    } finally {
      setBusy(false);
    }
  }

  async function createDraftSkillForNode() {
    if (!activeNode) return;
    setBusy(true);
    setStatus("创建草稿技能中");
    try {
      const draftTitle = `${activeNode.title || activeNode.type} 草稿技能`;
      const response = await api("/workgraph-os/skills", {
        method: "POST",
        body: JSON.stringify({
          title: draftTitle,
          command: `/${activeNode.type}-${Date.now().toString(36)}`.replace(/[^a-z0-9/_-]+/gi, "-").toLowerCase(),
          输出: /video/i.test(activeNode.type) ? "视频方案" : /image|预览/i.test(activeNode.type) ? "图片方案" : "结构化输出结果",
          description: [
            "基于当前节点创建的草稿技能。",
            `节点: ${activeNode.title}`,
            `目标: ${prompt}`,
            activeNode.body ? `节点提示词: ${activeNode.body}` : ""
          ].filter(Boolean).join("\n"),
          keywords: [activeNode.type, "草稿", "node-created", "dapot", "workgraph-os"],
          capabilityType: /video/i.test(activeNode.type) ? "video_planning" : /image|预览/i.test(activeNode.type) ? "image_planning" : "custom"
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setWorkspace(payload.workspace ?? workspace);
      setObjects(payload.objectIndex?.objects ?? objects);
      await loadLibraries();
      if (payload.skill?.id) {
        setNodeSkillSearchResults([payload.skill, ...nodeSkillSearchResults]);
        await bindSkillToActiveNode(payload.skill.id, "草稿技能已创建并绑定");
        setSkillOptimizePrompt(skillOptimizationPromptForNode(activeNode, payload.skill.title));
      }
      void loadOpsStatus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "草稿技能创建失败");
    } finally {
      setBusy(false);
    }
  }

  const loadWorkspace = useCallback(async () => {
    try {
      setWorkspaceLoadState("booting");
      const response = await api("/workgraph-os/workspace");
      if (!response.ok) {
        const fallback = baseWorkspace();
        setWorkspace(fallback);
        setObjects([]);
        setAssets([]);
        setModels([]);
        setWorkspaceLoadState("fallback");
        setStatus("本地预览模式：后端未连接");
        return;
      }
      const payload = (await response.json()) as WorkspacePayload;
      const nextWorkspace = payload.workspace ?? null;
      setWorkspace(nextWorkspace);
      setObjects(payload.objectIndex?.objects ?? []);
      setAssets(nextWorkspace?.materials ?? []);
      if (nextWorkspace?.prompt) {
        setPrompt(nextWorkspace.prompt);
        if (!goalComposerDirtyRef.current) setGoalComposerDraft(nextWorkspace.prompt);
      }
      setModels(nextWorkspace?.models ?? []);
      const loadedNodes = nextWorkspace?.nodes?.length ? nextWorkspace.nodes : fallbackNodes(nextWorkspace?.prompt || prompt);
      const loadedEdges = nextWorkspace?.edges?.length
        ? nextWorkspace.edges.map((edge, index) => ({ id: edge.id || `edge-${index}`, source: edge.source, target: edge.target }))
        : fallbackEdges(loadedNodes);
      const savedActiveNodeId = typeof nextWorkspace?.activeNodeId === "string" ? nextWorkspace.activeNodeId : "";
      const savedActiveNode = loadedNodes.find((node) => node.id === savedActiveNodeId) ?? loadedNodes[0];
      if (savedActiveNode) {
        setActiveNodeId(savedActiveNode.id);
        setNodeModuleDrawer((current) => current ?? preferredNodeModuleDrawer(savedActiveNode.type));
      }
      setNodes(toFlowNodes(loadedNodes, {
        assets: nextWorkspace?.materials ?? [],
        skills,
        models: nextWorkspace?.models ?? models,
        results: nextWorkspace?.results ?? [],
        logs: nextWorkspace?.executionLog ?? [],
        modelPolicies: nextWorkspace?.modelPolicies ?? []
      }, savedActiveNode?.id || ""));
      setEdges(loadedEdges);
      setWorkspaceLoadState(nextWorkspace?.nodes?.length ? "loaded" : "fallback");
    } catch (error) {
      const fallback = baseWorkspace();
      setWorkspace(fallback);
      setObjects([]);
      setAssets([]);
      setModels([]);
      setWorkspaceLoadState("fallback");
      setStatus("本地预览模式：后端未连接");
    }
  }, [prompt, setActiveNodeId, setEdges, setNodes, setPrompt, skills]);

  const loadLibraries = useCallback(async () => {
    try {
      const [brandResponse, skillResponse, assetResponse] = await Promise.all([api("/workgraph-os/brands"), api("/workgraph-os/skills"), api("/workgraph-os/assets")]);
      if (brandResponse.ok) {
        const payload = await brandResponse.json();
        setBrands(payload.brands ?? []);
      }
      if (skillResponse.ok) {
        const payload = await skillResponse.json();
        setSkills(payload.skills ?? []);
      }
      if (assetResponse.ok) {
        const payload = await assetResponse.json();
        setAssets(payload.assets ?? []);
      }
    } catch {
      setBrands([]);
      setSkills([]);
      setAssets([]);
    }
  }, []);

  const loadOpsStatus = useCallback(async () => {
    try {
      const [historyResponse, sqliteResponse, snapshotResponse, piSessionsResponse] = await Promise.all([
        api("/workgraph-os/history?limit=8"),
        api("/workgraph-os/sqlite/schema"),
        api("/workgraph-os/snapshots"),
        api("/workgraph-os/pi/sessions?limit=8")
      ]);
      if (historyResponse.ok) {
        const payload = await historyResponse.json();
        setHistoryEntries(payload.entries ?? []);
      }
      if (sqliteResponse.ok) setSqliteStatus(await sqliteResponse.json());
      if (snapshotResponse.ok) setSnapshotStatus(await snapshotResponse.json());
      if (piSessionsResponse.ok) {
        const payload = await piSessionsResponse.json();
        setPiSessions(payload.sessions ?? []);
      }
    } catch {
      setHistoryEntries([]);
      setSqliteStatus(null);
      setSnapshotStatus(null);
      setPiSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
    void loadLibraries();
    void loadOpsStatus();
  }, [loadLibraries, loadOpsStatus, loadWorkspace]);

  useEffect(() => {
    setNodes(toFlowNodes(plannedNodes, nodeCanvasContext, canvasActiveNodeId));
    setEdges(plannedEdges);
    if (!activeNodeId && canvasActiveNodeId) {
      const node = plannedNodes.find((item) => item.id === canvasActiveNodeId);
      if (node) {
        setActiveNodeId(node.id);
        setNodeModuleDrawer((current) => current ?? preferredNodeModuleDrawer(node.type));
      }
    }
  }, [plannedNodes, plannedEdges, activeNodeId, canvasActiveNodeId, nodeCanvasContext, setActiveNodeId, setEdges, setNodes]);

  useEffect(() => {
    if (!reactFlowInstance || !plannedNodes.length) return;
    const handle = window.setTimeout(() => {
      void fitCanvasWithSafeTop(reactFlowInstance, 180);
    }, 80);
    return () => window.clearTimeout(handle);
  }, [reactFlowInstance, plannedNodes.length, plannedEdges.length]);

  useEffect(() => {
    const savedLayoutVersion = window.localStorage.getItem(studioLayoutStorageKeys.version);
    const savedInspector = window.localStorage.getItem(studioLayoutStorageKeys.inspectorCollapsed);
    const savedResource = window.localStorage.getItem(studioLayoutStorageKeys.resourceCollapsed);
    const shouldUseBottomFirstDefault = savedLayoutVersion !== studioLayoutVersion;
    setInspectorCollapsed(shouldUseBottomFirstDefault ? true : savedInspector === null ? true : savedInspector === "true");
    setResourceCollapsed(shouldUseBottomFirstDefault ? true : savedResource === null ? true : savedResource === "true");
    window.localStorage.setItem(studioLayoutStorageKeys.version, studioLayoutVersion);
    setLayoutPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!layoutPreferencesLoaded) return;
    writeStoredBoolean(studioLayoutStorageKeys.inspectorCollapsed, inspectorCollapsed);
  }, [inspectorCollapsed, layoutPreferencesLoaded]);

  useEffect(() => {
    if (!layoutPreferencesLoaded) return;
    writeStoredBoolean(studioLayoutStorageKeys.resourceCollapsed, resourceCollapsed);
  }, [resourceCollapsed, layoutPreferencesLoaded]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) return;
      if (event.key === "/") {
        event.preventDefault();
        setBottomTab("预览");
        goalInputRef.current?.focus();
        goalInputRef.current?.select();
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const node = plannedNodes[Number(event.key) - 1];
        if (!node) return;
        event.preventDefault();
        activateNode(node.id);
        setStatus(`已切换到节点 ${event.key}`);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        openNodeModule(nodeModuleDrawer || preferredNodeModuleDrawer(activeNode?.type || "goal"));
        setStatus("已打开节点模块");
        return;
      }
      if (key === "r") {
        event.preventDefault();
        if (activeNode && !busy) void runNode(activeNode.id);
        return;
      }
      if (key === "f") {
        event.preventDefault();
        enterFocusMode();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        resetStudioLayout();
      }
    };
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [activeNode, busy, nodeModuleDrawer, plannedNodes]);

  useEffect(() => {
    const result = workspace?.results?.[0];
    const sessionId = result?.piSessionId || result?.trace?.piSessionId;
    if (!sessionId) {
      setPiSessionDetail(null);
      return;
    }
    let cancelled = false;
    void api(`/workgraph-os/pi/sessions/${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = await response.json();
        if (!cancelled) setPiSessionDetail(payload.session ?? null);
      })
      .catch(() => {
        if (!cancelled) setPiSessionDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.results]);

  async function planGoal(nextPrompt = goalComposerDraft) {
    const planningPrompt = nextPrompt.trim() || prompt;
    setPrompt(planningPrompt);
    setGoalComposerDraft(planningPrompt);
    goalComposerDirtyRef.current = false;
    setBusy(true);
    setStatus("正在规划流程");
    try {
      let currentWorkspace = workspace;
      if (!currentWorkspace) {
        const putResponse = await api("/workgraph-os/workspace", {
          method: "PUT",
          body: JSON.stringify({
            version: 1,
            id: "workspace-local",
            prompt: planningPrompt,
            activeBrandId: "brand-dapot",
            selectedIds: [],
            activeMaterialId: "",
            activeSkillId: "",
            activeNodeId: "",
            materials: [],
            skills: [],
            models: [],
            nodes: [],
            edges: [],
            jobs: [],
            results: [],
            feedback: [],
            memories: [],
            executionLog: [],
            history: [],
            updatedAt: new Date().toISOString()
          })
        });
        const putPayload = await putResponse.json();
        currentWorkspace = putPayload.workspace;
        setWorkspace(currentWorkspace);
      }
      const response = await api("/workgraph-os/plan", {
        method: "POST",
        body: JSON.stringify({ prompt: planningPrompt, brandId: "brand-dapot" })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setWorkspace(payload.workspace);
      setObjects(payload.objectIndex?.objects ?? []);
      setAssets(payload.workspace?.materials ?? assets);
      setModels(payload.workspace?.models ?? []);
      void loadOpsStatus();
      setStatus("流程规划完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "规划失败");
    } finally {
      setBusy(false);
    }
  }

  async function runNode(nodeId = activeNode?.id) {
    if (!nodeId) return;
    activateNode(nodeId);
    setBusy(true);
    setBottomTab("预览");
    setInspectorCollapsed(false);
    setInspectorTab("trace");
    setRunningNodeId(nodeId);
    setStatus(`执行中 ${nodeId}`);
    try {
      const response = await api("/workgraph-os/run", {
        method: "POST",
        body: JSON.stringify({ nodeId, prompt })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setWorkspace(payload.workspace);
      setObjects(payload.objectIndex?.objects ?? []);
      setAssets(payload.workspace?.materials ?? assets);
      setBottomTab("预览");
      void loadOpsStatus();
      setStatus("节点已出结果");
    } catch (error) {
      setBottomTab("日志");
      setInspectorTab("trace");
      setStatus(error instanceof Error ? error.message : "执行失败");
    } finally {
      setRunningNodeId("");
      setBusy(false);
    }
  }

  async function retryActiveNode() {
    await retryNode(activeNode?.id);
  }

  async function retryNode(nodeId?: string) {
    const targetNode = plannedNodes.find((node) => node.id === nodeId) ?? activeNode;
    if (!targetNode) return;
    activateNode(targetNode.id);
    const nextNodes = plannedNodes.map((node) => node.id === targetNode.id ? {
      ...node,
      status: "就绪",
      disabled: false,
      retryCount: (node.retryCount ?? 0) + 1,
      lastError: ""
    } : node);
    await persistWorkspace({ ...(workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: targetNode.id }, "node retry queued");
    setBottomTab("预览");
    setInspectorCollapsed(false);
    setInspectorTab("trace");
    await runNode(targetNode.id);
  }

  async function recordFeedback() {
    const currentWorkspace = workspace ?? baseWorkspace();
    const currentLatestResult = currentWorkspace.results?.[0];
    const currentPromptRecord = currentLatestResult?.promptRecord
      ?? currentWorkspace.promptRecords?.find((record) => record.id === currentLatestResult?.promptRecordId)
      ?? currentWorkspace.promptRecords?.[0];
    const [selectedType, ...selectedIdParts] = feedbackTargetValue.split(":");
    const selectedId = selectedIdParts.join(":");
    const targetType = selectedType || (currentLatestResult ? "result" : "node");
    const targetId = selectedId || currentLatestResult?.id || activeNode?.id;
    if (!targetId) return;
    setBusy(true);
    setStatus("正在写入反馈记忆");
    try {
      const response = await api("/workgraph-os/feedback", {
        method: "POST",
        body: JSON.stringify({
          targetId,
          targetType,
          rating: feedbackRating,
          action: feedbackAction,
          note: feedbackNote,
          sourceResultId: currentLatestResult?.id,
          sourceWorkflowId: currentLatestResult?.workflowId || currentLatestResult?.trace?.workflowId || currentPromptRecord?.workflowId,
          brandId: currentWorkspace.activeBrandId || "brand-dapot"
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setWorkspace(payload.workspace);
      setObjects(payload.objectIndex?.objects ?? []);
      setAssets(payload.workspace?.materials ?? assets);
      setLastFeedbackLearning({
        brand: payload.brand ?? null,
        feedback: payload.feedback,
        memory: payload.memory,
        appliedLearning: payload.appliedLearning
      });
      if (payload.brand?.id) {
        setBrands((current) => [payload.brand, ...current.filter((brand) => brand.id !== payload.brand.id)]);
      }
      setBottomTab("反馈");
      void loadOpsStatus();
      setStatus("反馈记忆已写入");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "反馈失败");
    } finally {
      setBusy(false);
    }
  }

  async function openSkill(skillId: string, options?: { optimizePrompt?: string }) {
    setSkillDrawerOpen(true);
    setStatus("正在加载技能文件");
    const response = await api(`/workgraph-os/skills/${encodeURIComponent(skillId)}`);
    if (!response.ok) {
      setStatus("技能文件加载失败");
      return;
    }
    const detail = await response.json() as SkillDetail;
    setSkillDetail(detail);
    const firstFile = detail.files.find((file) => file.path === activeSkillFilePath) ?? detail.files[0];
    setActiveSkillFilePath(firstFile?.path ?? "SKILL.md");
    setSkillFileDraft(firstFile?.content ?? "");
    if (options?.optimizePrompt) setSkillOptimizePrompt(options.optimizePrompt);
    setSkillOptimizePreview(null);
    setSkillTestResult(null);
    setStatus("技能文件已加载");
  }

  async function openActiveSkillDrawer() {
    setSkillDrawerOpen(true);
    const targetSkillId = activeNode?.skillId || skills[0]?.id;
    if (targetSkillId) {
      await openSkill(targetSkillId);
      return;
    }
    setStatus("请先选择或创建一个技能");
  }

  async function openSkillDrawerForNode(nodeId?: string) {
    const targetNode = plannedNodes.find((node) => node.id === nodeId) ?? activeNode;
    if (targetNode?.id) activateNode(targetNode.id);
    // Pre-select the node's skill module without expanding the inspector, then
    // open the skill drawer — exclusivity keeps only the drawer as the right surface.
    setInspectorTab("modules");
    setNodeModuleDrawer("skill");
    setSkillDrawerOpen(true);
    const targetSkillId = targetNode?.skillId || skills[0]?.id;
    if (targetSkillId) {
      await openSkill(targetSkillId);
      return;
    }
    setStatus("请先选择或创建一个技能");
  }

  async function openSkillManager() {
    setSkillDrawerOpen(true);
    const targetSkillId = skillDetail?.skill.id || activeNode?.skillId || skills[0]?.id;
    if (targetSkillId) await openSkill(targetSkillId);
  }

  function selectSkillFile(file: SkillFile) {
    setActiveSkillFilePath(file.path);
    setSkillFileDraft(file.content);
  }

  async function saveSkillFile() {
    if (!skillDetail) return;
    setBusy(true);
    setStatus("正在保存技能文件");
    try {
      const response = await api(`/workgraph-os/skills/${encodeURIComponent(skillDetail.skill.id)}/files`, {
        method: "PUT",
        body: JSON.stringify({
          path: activeSkillFilePath,
          content: skillFileDraft,
          reason: `手动 edit from WorkGraph 工作室: ${activeSkillFilePath}`
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const detail = payload.detail as SkillDetail;
      setSkillDetail(detail);
      const updatedFile = detail.files.find((file) => file.path === activeSkillFilePath);
      setSkillFileDraft(updatedFile?.content ?? skillFileDraft);
      void loadOpsStatus();
      setStatus("技能文件已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能文件保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function 预览SkillOptimization() {
    if (!skillDetail) return;
    setBusy(true);
    setStatus("正在预览技能差异");
    try {
      const response = await api(`/workgraph-os/skills/${encodeURIComponent(skillDetail.skill.id)}/optimize`, {
        method: "POST",
        body: JSON.stringify({ 提示词: skillOptimizePrompt, files: [activeSkillFilePath] })
      });
      if (!response.ok) throw new Error(await response.text());
      setSkillOptimizePreview(await response.json());
      setStatus("技能差异已就绪");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能预览失败");
    } finally {
      setBusy(false);
    }
  }

  async function applySkillOptimization() {
    if (!skillDetail) return;
    setBusy(true);
    setStatus("正在应用技能差异");
    try {
      const response = await api(`/workgraph-os/skills/${encodeURIComponent(skillDetail.skill.id)}/optimize/apply`, {
        method: "POST",
        body: JSON.stringify({ 提示词: skillOptimizePrompt })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const detail = payload.detail as SkillDetail;
      setSkillDetail(detail);
      const updatedFile = detail.files.find((file) => file.path === activeSkillFilePath) ?? detail.files[0];
      setActiveSkillFilePath(updatedFile?.path ?? "SKILL.md");
      setSkillFileDraft(updatedFile?.content ?? "");
      setSkillOptimizePreview(null);
      void loadOpsStatus();
      setStatus("技能优化已应用");
      await loadLibraries();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能应用失败");
    } finally {
      setBusy(false);
    }
  }

  async function copySkill() {
    if (!skillDetail) return;
    setBusy(true);
    setStatus("正在复制技能");
    try {
      const response = await api(`/workgraph-os/skills/${encodeURIComponent(skillDetail.skill.id)}/copy`, {
        method: "POST",
        body: JSON.stringify({})
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setWorkspace(payload.workspace ?? workspace);
      setObjects(payload.objectIndex?.objects ?? objects);
      await loadLibraries();
      if (payload.skill?.id) await openSkill(payload.skill.id);
      void loadOpsStatus();
      setStatus("技能已复制");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能复制失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyPreviewText() {
    const text = previewText || previewUrl || "";
    if (!text) {
      setStatus("暂无可复制结果");
      return;
    }
    try {
      await navigator.clipboard?.writeText(text);
      setStatus("结果已复制");
    } catch {
      setStatus("复制失败：浏览器未授权剪贴板");
    }
  }

  async function testSkill() {
    if (!skillDetail) return;
    setBusy(true);
    setStatus("正在本地测试技能");
    try {
      const response = await api(`/workgraph-os/skills/${encodeURIComponent(skillDetail.skill.id)}/test`, {
        method: "POST",
        body: JSON.stringify({ prompt, nodeId: activeNode?.id })
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setSkillTestResult(payload);
      setWorkspace(payload.workspace ?? workspace);
      setObjects(payload.objectIndex?.objects ?? objects);
      const nextDetailResponse = await api(`/workgraph-os/skills/${encodeURIComponent(skillDetail.skill.id)}`);
      if (nextDetailResponse.ok) setSkillDetail(await nextDetailResponse.json());
      void loadOpsStatus();
      setStatus("技能测试已完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAssetFile(file: File, targetNodeId = activeNode?.id) {
    setBusy(true);
    setStatus("正在上传素材");
    const targetNode = plannedNodes.find((node) => node.id === targetNodeId);
    try {
      const query = new URLSearchParams({
        title: file.name.replace(/\.[^.]+$/, "") || "Uploaded Asset",
        filename: file.name,
        mime: file.type || "application/octet-stream",
        brandId: workspace?.activeBrandId || "brand_dapot",
        tags: "studio-upload,node-bind",
        note: `uploaded from WorkGraph 工作室 for ${targetNodeId || "workspace"}`
      });
      const response = await fetch(`/workgraph-os/assets/upload?${query.toString()}`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream"
        },
        body: await file.arrayBuffer()
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      const asset = payload.asset as AssetObject;
      setWorkspace(payload.workspace ?? workspace);
      setObjects(payload.objectIndex?.objects ?? objects);
      setAssets(payload.workspace?.materials ?? [asset, ...assets]);
      if (targetNode && asset?.id) {
        const materialIds = Array.from(new Set([...(targetNode.materialIds ?? []), asset.id]));
        const nextNodes = plannedNodes.map((node) => node.id === targetNode.id ? { ...node, materialIds } : node);
        activateNode(targetNode.id);
        openNodeModule("asset");
        await persistWorkspace({ ...(payload.workspace ?? workspace ?? baseWorkspace()), nodes: nextNodes, activeNodeId: targetNode.id, activeMaterialId: asset.id }, "素材已上传并绑定");
      } else {
        setStatus("素材已上传");
      }
      setActiveObjectType("asset");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材上传失败");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const latestResult = workspace?.results?.[0];
  // T7: side-by-side output variants — results that share the latest variant group.
  const variantGroup = latestResult?.variantGroupId
    ? (workspace?.results ?? [])
        .filter((result) => result.variantGroupId === latestResult.variantGroupId)
        .sort((left, right) => (left.variantIndex ?? 0) - (right.variantIndex ?? 0))
    : [];
  // T8: version history for the latest result, derived from history snapshots.
  const [resultVersions, setResultVersions] = useState<Array<{ version: number; createdAt: string; reason: string; object?: { payload?: ResultObject } }>>([]);
  useEffect(() => {
    const resultId = latestResult?.id;
    if (!resultId) { setResultVersions([]); return; }
    let cancelled = false;
    api(`/workgraph-os/versions/result/${encodeURIComponent(resultId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled && data) setResultVersions(Array.isArray(data.versions) ? data.versions : []); })
      .catch(() => { if (!cancelled) setResultVersions([]); });
    return () => { cancelled = true; };
  }, [latestResult?.id, workspace?.updatedAt]);
  async function selectVariantAsMain(resultId: string) {
    if (!workspace) return;
    const results = workspace.results ?? [];
    const chosen = results.find((result) => result.id === resultId);
    if (!chosen) return;
    await persistWorkspace({ ...workspace, results: [chosen, ...results.filter((result) => result.id !== resultId)] }, "已选为主结果");
  }
  async function rollbackResultToVersion(versionPayload?: ResultObject) {
    if (!workspace || !versionPayload?.id) return;
    const results = workspace.results ?? [];
    await persistWorkspace({ ...workspace, results: results.map((result) => result.id === versionPayload.id ? { ...result, ...versionPayload } : result) }, "已回滚到所选版本");
  }
  const latestPromptRecord = latestResult?.promptRecord
    ?? workspace?.promptRecords?.find((record) => record.id === latestResult?.promptRecordId)
    ?? workspace?.promptRecords?.[0];
  const resultLogs = (workspace?.executionLog ?? [])
    .filter((log) => !latestPromptRecord?.executionId || log.executionId === latestPromptRecord.executionId)
    .slice(0, 8);
  const resultMaterialIds = latestResult?.materialIds ?? latestResult?.trace?.materialIds ?? latestPromptRecord?.materialIds ?? [];
  const resultFeedbackIds = latestResult?.feedbackIds ?? latestResult?.trace?.feedbackIds ?? [];
  const resultFeedback = (workspace?.feedback ?? []).filter((feedback) => resultFeedbackIds.includes(feedback.id) || feedback.targetId === latestResult?.id);
  const resultAssets = resultMaterialIds
    .map((id) => assets.find((asset) => asset.id === id) ?? workspace?.materials?.find((asset) => asset.id === id) ?? { id, title: id })
    .filter(Boolean) as AssetObject[];
  const feedbackTargets = useMemo<FeedbackTargetOption[]>(() => {
    const options: FeedbackTargetOption[] = [];
    if (latestResult?.id) options.push({ type: "result", id: latestResult.id, label: `结果 · ${latestResult.title || latestResult.id}` });
    if (activeNode?.id) options.push({ type: "node", id: activeNode.id, label: `节点 · ${activeNode.title || activeNode.id}` });
    const activeSkillId = activeNode?.skillId || latestResult?.skillId || latestResult?.trace?.skillId || latestPromptRecord?.skillId || workspace?.activeSkillId;
    const activeSkillTitle = skills.find((skill) => skill.id === activeSkillId)?.title || activeSkillId;
    if (activeSkillId) options.push({ type: "skill", id: activeSkillId, label: `技能 · ${activeSkillTitle}` });
    const activeBrandId = latestResult?.brandId || latestResult?.trace?.brandId || latestPromptRecord?.brandId || workspace?.activeBrandId;
    const activeBrandName = brands.find((brand) => brand.id === activeBrandId)?.name || activeBrandId;
    if (activeBrandId) options.push({ type: "brand", id: activeBrandId, label: `品牌 · ${activeBrandName}` });
    const activeModelId = latestResult?.modelId || latestResult?.trace?.modelId || latestResult?.routingDecision?.selectedModelId || latestPromptRecord?.modelId || activeNode?.modelId || workspace?.activeModelId;
    if (activeModelId) options.push({ type: "model", id: activeModelId, label: `模型 · ${displayModelName(activeModelId, models)}` });
    const activeWorkflowId = latestResult?.workflowId || latestResult?.trace?.workflowId || latestPromptRecord?.workflowId || objectField(workspace?.workflow, "id");
    if (activeWorkflowId) options.push({ type: "workflow", id: String(activeWorkflowId), label: `工作流 · ${String(activeWorkflowId)}` });
    resultAssets.slice(0, 4).forEach((asset) => options.push({ type: "asset", id: asset.id, label: `素材 · ${asset.title || asset.id}` }));
    return options.filter((option, index, list) => list.findIndex((item) => item.type === option.type && item.id === option.id) === index);
  }, [activeNode?.id, activeNode?.modelId, activeNode?.skillId, activeNode?.title, brands, latestPromptRecord, latestResult, models, resultAssets, skills, workspace?.activeBrandId, workspace?.activeModelId, workspace?.activeSkillId, workspace?.workflow]);
  const latestLogs = workspace?.executionLog?.slice(0, 8) ?? [];
  const latestMemories = workspace?.memories?.slice(0, 6) ?? [];
  const dapot = brands.find((brand) => /dapot|da pot/i.test(`${brand.id} ${brand.name}`)) ?? brands[0];
  const learnedForbiddenWords = lastFeedbackLearning?.appliedLearning?.brandForbiddenWords ?? dapot?.forbiddenWords ?? [];
  const learnedSceneKeywords = lastFeedbackLearning?.appliedLearning?.brandSceneKeywords ?? dapot?.sceneKeywords ?? [];
  const latestModelPolicy = workspace?.modelPolicies?.[0];
  const activeBoundAsset = assets.find((asset) => asset.id === activeNode?.materialIds?.[0])
    ?? workspace?.materials?.find((asset) => asset.id === activeNode?.materialIds?.[0]);
  const activeNodeLogs = useMemo(() => {
    return (workspace?.executionLog ?? []).filter((log) => log.nodeId === activeNode?.id).slice(0, 8);
  }, [activeNode?.id, workspace?.executionLog]);
  const activePromptRecord = useMemo(() => {
    const nodeRecord = (workspace?.promptRecords ?? []).find((record) => record.nodeId === activeNode?.id);
    return nodeRecord ?? (latestPromptRecord?.nodeId === activeNode?.id ? latestPromptRecord : undefined);
  }, [activeNode?.id, latestPromptRecord, workspace?.promptRecords]);
  const activeNodeResult = useMemo(() => {
    return (workspace?.results ?? []).find((result) => result.nodeId === activeNode?.id || result.trace?.nodeId === activeNode?.id);
  }, [activeNode?.id, workspace?.results]);
  const activeNodeModelPolicy = (workspace?.modelPolicies ?? []).find((policy) => policy.targetId === activeNode?.id)
    ?? (workspace?.modelPolicies ?? []).find((policy) => policy.targetId === activeNodeResult?.id || Boolean(policy.feedbackId && resultFeedbackIds.includes(policy.feedbackId)))
    ?? latestModelPolicy;
  const activeNodeAssets = (activeNode?.materialIds ?? [])
    .map((id) => assets.find((asset) => asset.id === id) ?? workspace?.materials?.find((asset) => asset.id === id) ?? { id, title: id })
    .filter(Boolean) as AssetObject[];
  const assetLibraryCandidates = useMemo(() => {
    const byId = new Map<string, AssetObject>();
    [...activeNodeAssets, ...assets, ...(workspace?.materials ?? [])].forEach((asset) => {
      if (asset?.id && !byId.has(asset.id)) byId.set(asset.id, asset);
    });
    const boundIds = new Set(activeNode?.materialIds ?? []);
    return Array.from(byId.values()).sort((left, right) => {
      const leftBound = boundIds.has(left.id) ? 0 : 1;
      const rightBound = boundIds.has(right.id) ? 0 : 1;
      return leftBound - rightBound || (left.title || left.id).localeCompare(right.title || right.id);
    });
  }, [activeNode?.materialIds, activeNodeAssets, assets, workspace?.materials]);
  const unboundAssetCandidates = assetLibraryCandidates.filter((asset) => !(activeNode?.materialIds ?? []).includes(asset.id));
  const activeNodeSkill = activeNode?.skillId ? skills.find((skill) => skill.id === activeNode.skillId) : undefined;
  const nodeSkillSuggestedQuery = [activeNode?.title, activeNode?.type, activeNode?.body, workspace?.prompt || prompt]
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
  const nodeSkillSearchCount = nodeSkillSearchResults.length;
  const activeOperationProfile = activeNode ? nodeOperationProfile(activeNode.type) : undefined;
  const activeModuleKey = nodeModuleDrawer || "params";
  const activeModuleCopy = {
    params: { label: "参数", hint: "调整提示词、比例、语言、输出格式", action: "微调节点输入", next: "确认输出结构后运行节点" },
    model: { label: "模型", hint: "选择生成模型、速度、质量和 fallback", action: "选择执行模型", next: "按质量或成本策略运行" },
    skill: { label: "技能", hint: "搜索、绑定、创建或保存当前节点技能", action: "绑定 Pi 技能", next: "保存为可复用节点能力" },
    asset: { label: "素材", hint: "拖入文件或绑定品牌、图片、视频、文本", action: "绑定输入素材", next: "检查素材是否进入当前节点" },
    brand: { label: "品牌", hint: "检查品牌规则、禁用词和素材上下文", action: "读取品牌约束", next: "把禁用词和场景写入提示词" }
  }[activeModuleKey];
  const activeModuleLabel = activeModuleCopy.label;
  const activeModuleHint = activeModuleCopy.hint;
  const activeModuleAction = activeModuleCopy.action;
  const activeModuleNext = activeModuleCopy.next;
  const activeNode输出结果Text = activeNodeResult?.预览 || activeNodeResult?.输出 || activePromptRecord?.输出 || "";
  const previewResult = activeNodeResult ?? latestResult;
  const previewPromptRecord = activePromptRecord ?? latestPromptRecord;
  const previewText = previewResult?.输出 || previewResult?.预览 || previewResult?.output || activeNode输出结果Text || "";
  const previewUrl = previewResult?.预览Url || previewResult?.previewUrl;
  const previewIsVideo = Boolean(previewUrl && /\.mp4\b|\.webm\b|\.mov\b/i.test(previewUrl));
  const isPreviewRunning = Boolean(runningNodeId && activeNode?.id === runningNodeId && !previewText && !previewUrl);
  const hasPreviewReceipt = Boolean(previewResult?.id && !previewText && !previewUrl && !isPreviewRunning);
  const resultLinkedAssets = resultMaterialIds
    .map((id) => assets.find((asset) => asset.id === id) ?? workspace?.materials?.find((asset) => asset.id === id))
    .filter(Boolean) as AssetObject[];
  const previewGalleryItems = [
    previewUrl ? { id: previewResult?.id || "preview-url", title: previewResult?.title || "结果预览", url: previewUrl, kind: previewIsVideo ? "video" : "image", source: "result" } : null,
    ...[...resultLinkedAssets, ...activeNodeAssets].map((asset) => ({
      id: asset.id,
      title: asset.title || asset.fileName || asset.id,
      url: asset.thumbnailUrl || asset.预览Url || "",
      kind: asset.kind || asset.fileName || "asset",
      source: "asset"
    }))
  ].filter((item): item is { id: string; title: string; url: string; kind: string; source: string } => Boolean(item?.id && item.url));
  const previewSourceKind = activeNodeResult
    ? "当前节点结果"
    : latestResult
    ? "最近结果"
    : isPreviewRunning
    ? "执行中"
    : activeNode输出结果Text
    ? "节点草稿"
    : "等待输出";
  const previewSourceTone = activeNodeResult ? "active-node" : latestResult ? "latest-result" : isPreviewRunning ? "running" : "empty";
  const isActiveVideoNode = /video/i.test(activeNode?.type || "");
  const videoShotLines = activeNode输出结果Text.split("\n").filter((line) => /^\d+\.\s/.test(line.trim())).slice(0, 6);
  const videoImagePromptLines = activeNode输出结果Text.split("\n").filter((line) => line.trim().startsWith("- ")).filter((line) => /restaurant|hot pot|buffet|DAPOT|logo|Thai|opening|หม้อไฟ/i.test(line)).slice(0, 4);
  const thaiCopyLine = activeNode输出结果Text.split("\n").find((line) => /เปิดโลก|บุฟเฟต์|DAPOT HOT POT/i.test(line)) || "";
  const skillVersionDirs = skillDetail?.tree
    .find((item) => item.path === "versions")
    ?.children?.filter((item) => item.type === "directory") ?? [];
  const skillLogFiles = skillDetail?.tree
    .find((item) => item.path === "logs")
    ?.children?.filter((item) => item.type === "file") ?? [];
  const traceNodeId = previewResult?.nodeId || previewResult?.trace?.nodeId || previewPromptRecord?.nodeId || activeNode?.id || "";
  const traceBrandId = previewResult?.brandId || previewResult?.trace?.brandId || previewPromptRecord?.brandId || workspace?.activeBrandId || "";
  const traceSkillId = previewResult?.skillId || previewResult?.trace?.skillId || previewPromptRecord?.skillId || activeNode?.skillId || "";
  const traceModelId = previewResult?.modelId || previewResult?.trace?.modelId || previewResult?.routingDecision?.selectedModelId || previewPromptRecord?.modelId || activeNode?.modelId || "";
  const traceAssetId = resultMaterialIds[0] || "";
  const previewContextChipCandidates: Array<{ label: string; value?: string; action?: PreviewTraceAction }> = [
    { label: "节点", value: traceNodeId, action: "node" },
    { label: "品牌", value: traceBrandId, action: "brand" },
    { label: "技能", value: traceSkillId, action: "skill" },
    { label: "模型", value: traceModelId, action: "model" },
    { label: "素材", value: traceAssetId, action: traceAssetId ? "asset" : undefined }
  ];
  const previewContextChips = previewContextChipCandidates.filter((item) => Boolean(item.value));
  const previewProcessSummary = [
    { label: "状态", value: isPreviewRunning ? "执行中" : previewResult?.status || activeNode?.status || "待处理" },
    { label: "日志", value: resultLogs.length ? `${resultLogs.length}` : `${activeNodeLogs.length}` },
    { label: "Pi", value: piSessionDetail?.status || (previewResult?.piSessionId || previewResult?.trace?.piSessionId ? "已关联" : "待关联") },
    { label: "反馈", value: resultFeedback.length ? `${resultFeedback.length}` : "0" }
  ];
  const executionFlowSteps = useMemo<ExecutionFlowStep[]>(() => {
    const nodeStatus = activeNode?.status || "待处理";
    const hasPrompt = Boolean((composerMode === "node" ? nodeComposerDraft : goalComposerDraft).trim() || activeNode?.body || workspace?.prompt);
    const hasSkill = Boolean(activeNode?.skillId || traceSkillId || activePromptRecord?.skillId);
    const hasModel = Boolean(activeNode?.modelId || traceModelId || workspace?.activeModelId);
    const hasAssets = activeNodeAssets.length > 0 || resultMaterialIds.length > 0;
    const hasResult = Boolean(previewText || previewUrl || activeNodeResult?.id);
    const failed = /失败|error|failed/i.test(nodeStatus);
    return [
      {
        key: "input",
        label: "输入",
        value: hasPrompt ? "已接收" : "待输入",
        state: executionStepState(hasPrompt, !hasPrompt),
        hint: activeNode?.body || workspace?.prompt || "底部输入框写目标，或拖入文件。"
      },
      {
        key: "skill",
        label: "技能",
        value: hasSkill ? displayShortId(activeNode?.skillId || traceSkillId || activePromptRecord?.skillId) : "待匹配",
        state: executionStepState(hasSkill, hasPrompt && !hasSkill),
        hint: hasSkill ? "已绑定可复用技能。" : "从左侧技能搜索或保存当前节点。"
      },
      {
        key: "model",
        label: "模型",
        value: displayModelName(activeNode?.modelId || traceModelId || workspace?.activeModelId, models),
        state: executionStepState(hasModel, hasSkill && !hasModel),
        hint: activeNodeModelPolicy?.note || activeNodeModelPolicy?.strategy || activeNode?.modelStrategy || "按节点类型选择文本、图片或视频模型。"
      },
      {
        key: "asset",
        label: "素材",
        value: hasAssets ? `${Math.max(activeNodeAssets.length, resultMaterialIds.length)} 个` : "可选",
        state: executionStepState(hasAssets, Boolean(activeNode && !hasResult && !hasAssets)),
        hint: hasAssets ? activeNodeAssets.map((asset) => asset.title || displayShortId(asset.id)).join(" / ") : "素材可拖到画布节点或底部输入区。"
      },
      {
        key: "result",
        label: "结果",
        value: hasResult ? "可预览" : isPreviewRunning ? "执行中" : "待运行",
        state: executionStepState(hasResult, Boolean(activeNode && !hasResult), failed),
        hint: failed ? (activeNode?.lastError || "执行失败，可重试当前节点。") : previewSourceKind
      },
      {
        key: "feedback",
        label: "反馈",
        value: resultFeedback.length ? `${resultFeedback.length} 条` : "待记录",
        state: executionStepState(resultFeedback.length > 0, hasResult && resultFeedback.length === 0),
        hint: resultFeedback.length ? "反馈已进入记忆和策略候选。" : "结果确认后写入反馈，形成下次约束。"
      }
    ];
  }, [activeNode, activeNodeAssets, activeNodeModelPolicy?.note, activeNodeModelPolicy?.strategy, activeNodeResult?.id, activePromptRecord?.skillId, composerMode, goalComposerDraft, isPreviewRunning, models, nodeComposerDraft, previewSourceKind, previewText, previewUrl, resultFeedback.length, resultMaterialIds.length, traceModelId, traceSkillId, workspace?.activeModelId, workspace?.prompt]);
  const bottomModeTabs = [
    { id: "预览" as const, key: "preview", label: "预览", count: previewUrl || previewText ? 1 : 0 },
    { id: "日志" as const, key: "logs", label: "日志", count: latestLogs.length },
    { id: "队列" as const, key: "queue", label: "队列", count: workspace?.jobs?.length ?? 0 },
    { id: "反馈" as const, key: "feedback", label: "反馈", count: workspace?.feedback?.length ?? 0 }
  ];
  const 预览TraceRows: Array<{ label: string; value?: string; action?: PreviewTraceAction }> = [
    { label: "结果", value: previewResult?.id },
    { label: "目标", value: previewResult?.goalId || previewResult?.trace?.goalId || (previewPromptRecord?.sourcePrompt ? "当前目标" : workspace?.prompt ? "工作区提示词" : "") },
    { label: "工作流", value: previewResult?.workflowId || previewResult?.trace?.workflowId || previewPromptRecord?.workflowId },
    { label: "节点", value: traceNodeId, action: "node" },
    { label: "品牌", value: traceBrandId, action: "brand" },
    { label: "技能", value: traceSkillId, action: "skill" },
    { label: "模型", value: traceModelId, action: "model" },
    { label: "策略", value: previewResult?.routingDecision?.strategy || previewResult?.modelStrategy || previewPromptRecord?.modelStrategy },
    { label: "提示词", value: previewResult?.promptRecordId || previewResult?.trace?.promptRecordId || previewPromptRecord?.id },
    { label: "Pi 会话", value: previewResult?.piSessionId || previewResult?.trace?.piSessionId },
    { label: "素材", value: resultMaterialIds.join(", "), action: traceAssetId ? "asset" : undefined },
    { label: "日志", value: resultLogs.length ? `${resultLogs.length} 条记录` : "" },
    { label: "反馈", value: resultFeedback.length ? resultFeedback.map((item) => item.id).join(", ") : "" },
    { label: "状态", value: previewResult?.status || activeNode?.status || "待处理" }
  ];

  function openPreviewTraceTarget(action: PreviewTraceAction, value?: string) {
    const targetNodeId = action === "node" ? value : traceNodeId;
    if (targetNodeId) activateNode(targetNodeId);
    if (action === "node") {
      setStatus("已聚焦节点");
      return;
    }
    if (action === "brand") {
      openNodeModule("brand");
      setActiveObjectType("brand");
      setStatus("已打开品牌详情");
      return;
    }
    if (action === "skill") {
      openNodeModule("skill");
      setActiveObjectType("skill");
      if (value) void openSkill(value);
      else setStatus("已打开技能详情");
      return;
    }
    if (action === "model") {
      openNodeModule("model");
      setActiveObjectType("model");
      setStatus("已打开模型详情");
      return;
    }
    if (action === "logs") {
      setBottomTab("日志");
      setStatus("已打开执行日志");
      return;
    }
    if (action === "feedback") {
      setBottomTab("反馈");
      setStatus("已打开反馈记录");
      return;
    }
    openNodeModule("asset");
    setActiveObjectType("asset");
    setStatus("已打开素材详情");
  }

  function openPreviewProcessStep(step: ExecutionFlowStep["key"]) {
    if (step === "skill") {
      openNodeModule("skill");
      setStatus("已打开技能流程");
      return;
    }
    if (step === "model") {
      openNodeModule("model");
      setStatus("已打开模型流程");
      return;
    }
    if (step === "asset") {
      openNodeModule("asset");
      setStatus("已打开素材流程");
      return;
    }
    if (step === "result") {
      setBottomTab("预览");
      setStatus("已打开结果预览");
      return;
    }
    if (step === "feedback") {
      setBottomTab("反馈");
      setStatus("已打开反馈流程");
      return;
    }
    setComposerMode("node");
    goalInputRef.current?.focus();
    setStatus("已聚焦节点输入");
  }

  const inspectorTabs = [
    { id: "overview", label: "总览", icon: FileText },
    { id: "modules", label: "模块", icon: Settings2 },
    { id: "trace", label: "输入", icon: ListChecks }
  ] as const;
  const workspaceStateLabel = workspaceLoadState === "loaded"
    ? "已加载"
    : workspaceLoadState === "fallback"
    ? "本地预览"
    : workspaceLoadState === "失败"
    ? "连接失败"
    : "加载中";
  const workflowStageItems = [
    { key: "input", label: "输入", value: prompt || workspace?.prompt ? "已就绪" : "等待目标" },
    { key: "execute", label: "执行", value: activeNode?.status || "待处理" },
    { key: "tune", label: "微调", value: activeModuleLabel },
    { key: "preview", label: "预览", value: previewUrl || previewText ? "有结果" : "等待输出" }
  ];
  const activeWorkflowStage = previewUrl || previewText
    ? "preview"
    : busy || /运行|执行|处理中|生成/i.test(status)
    ? "execute"
    : nodeModuleDrawer
    ? "tune"
    : prompt || workspace?.prompt
    ? "input"
    : "input";
  const activeViewMode: ViewMode = resourceCollapsed && inspectorCollapsed
    ? "focus"
    : resourceCollapsed
    ? "inspector"
    : inspectorCollapsed
    ? "resource"
    : "full";
  const viewModeItems: Array<{ key: ViewMode; label: string; icon: LucideIcon; title: string }> = [
    { key: "full", label: "全局", icon: Boxes, title: "展开资源栏和参数栏" },
    { key: "focus", label: "专注", icon: PanelRightClose, title: "收起左右栏，专注执行图和结果" },
    { key: "resource", label: "资源", icon: PanelLeftOpen, title: "打开资源库，收起参数栏" },
    { key: "inspector", label: "参数", icon: PanelRightOpen, title: "打开节点参数，收起资源栏" }
  ];

  return (
      <main className="wg-shell h-screen overflow-hidden text-slate-100">
      <div className="wg-main-shell">
      <header className="wg-topbar sticky top-0 z-30 flex h-11 min-h-[44px] items-center gap-2 border-b border-white/10 px-3" data-top-command-bar="true">
        <div className="wg-topbar-brand grid h-7 w-7 place-items-center rounded-md border border-cyan-300/40 bg-cyan-300/15 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,.2)]">
          <Database className="h-3.5 w-3.5 text-cyan-200" />
        </div>
        <div className="wg-topbar-title min-w-0" data-topbar-product-identity="true">
          <div className="text-[12px] font-semibold">AI 工作图谱</div>
          <div className="wg-topbar-subtitle truncate text-micro text-slate-500" title="底部输入目标，中间执行图谱，右侧微调节点">
            Pi 可视工作台
          </div>
        </div>
        <div className="wg-flow-strip hidden min-w-0 items-center gap-1 md:flex" data-workbench-flow-strip="true" data-workbench-flow-contract="input-execute-tune-preview">
          {workflowStageItems.map((item) => (
            <div
              key={item.key}
              className={cn(
                "wg-flow-step flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[12px]",
                activeWorkflowStage === item.key ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 bg-black/16 text-slate-500"
              )}
              data-workbench-flow-step={item.label}
              data-workbench-flow-state={activeWorkflowStage === item.key ? "active" : "idle"}
              data-workbench-flow-key={item.key}
            >
              <span className="font-semibold text-slate-300">{item.label}</span>
              <span className="max-w-[72px] truncate">{item.value}</span>
            </div>
          ))}
        </div>
        <div className="hidden items-center gap-2 text-micro text-slate-400 sm:flex" data-top-status-group="true">
          <span className="wg-topbar-status-pill rounded border border-slate-800 bg-slate-900 px-2 py-0.5">{workspaceStateLabel}</span>
          <span className="wg-topbar-status-pill rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5">系统：{status.includes("就绪") ? "就绪" : "处理中"}</span>
          <span className="wg-topbar-status-pill rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5">节点：{plannedNodes.length}</span>
        </div>
        <div className="wg-topbar-actions ml-auto flex items-center gap-1.5" data-top-action-density="compact-icons">
          <div className="wg-action-group hidden items-center gap-1 lg:flex">
            <button className="wg-top-action wg-btn-soft" onClick={() => void loadWorkspace()} title="刷新工作区" aria-label="刷新工作区" data-top-action="refresh" data-top-action-mode="icon">
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="wg-top-action-label">刷新</span>
            </button>
            <button className="wg-top-action wg-btn-soft disabled:opacity-50" onClick={() => void autoLayoutGraph()} title="自动重排图谱" aria-label="自动重排图谱" disabled={busy || !plannedNodes.length} data-自动-layout-graph="true" data-top-action="layout" data-top-action-mode="icon">
              <Layers3 className="h-3.5 w-3.5" />
              <span className="wg-top-action-label">重排</span>
            </button>
          </div>
          <div className="wg-view-mode-group flex items-center gap-0.5" data-top-view-mode-group="true" data-top-view-mode-active={activeViewMode}>
            {viewModeItems.map(({ key, label, icon: Icon, title }) => (
              <button
                key={key}
                className={cn("wg-view-mode-button wg-top-action wg-btn-soft", activeViewMode === key && "is-active")}
                onClick={() => setViewMode(key)}
                title={title}
                aria-label={`切换到${label}视图`}
                aria-pressed={activeViewMode === key}
                data-top-view-mode={key}
                data-top-action={viewModeTopAction[key]}
                data-top-action-mode={key === "focus" ? "label" : "icon"}
                data-reset-studio-layout={key === "full" ? "true" : undefined}
                data-enter-focus-mode={key === "focus" ? "true" : undefined}
              >
                <Icon className="pointer-events-none h-3.5 w-3.5" />
                <span className={cn("wg-top-action-label", key === "focus" && "wg-top-action-label-primary")}>{label}</span>
              </button>
            ))}
          </div>
          <div className="wg-action-group flex items-center gap-1">
            <button className="wg-top-action wg-btn-soft disabled:opacity-50" title="上传素材" aria-label="上传素材" onClick={() => fileInputRef.current?.click()} disabled={busy} data-top-action="upload" data-top-action-mode="icon">
              <Upload className="h-3.5 w-3.5" />
              <span className="wg-top-action-label">上传</span>
            </button>
            <button className="wg-top-action wg-btn-soft" onClick={() => void openSkillManager()} title="Pi 技能" aria-label="打开 Pi 技能管理" data-top-action="skill" data-top-action-mode="icon">
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="wg-top-action-label">技能</span>
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,.svg,.ttf,.otf,.woff,.woff2,.doc,.docx,.txt,.md"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadAssetFile(file);
          }}
        />
      </header>

      <section
        className="wg-workspace-grid wg-workbench-contract grid h-[calc(100vh-44px)] min-h-0 grid-rows-[minmax(0,1fr)_224px] overflow-hidden"
        data-workspace-node-count={plannedNodes.length}
        data-active-node-id={canvasActiveNodeId}
        data-workspace-load-state={workspaceLoadState}
        data-inspector-collapsed={inspectorCollapsed ? "true" : "false"}
        data-resource-collapsed={resourceCollapsed ? "true" : "false"}
        data-preview-expanded={previewExpanded ? "true" : "false"}
        data-right-surface={skillDrawerOpen ? "skill-drawer" : inspectorCollapsed ? "none" : "inspector"}
      >
        <aside className="row-span-2 flex min-h-0 flex-col overflow-hidden border-r border-white/10 bg-slate-900/70 wg-panel" data-resource-panel="true" data-resource-panel-layout="column">
          <div className="wg-resource-header flex h-9 shrink-0 items-center gap-2 border-b border-white/12 px-3 text-[12.5px] font-semibold text-slate-200">
            <Database className="h-3.5 w-3.5 text-cyan-300" />
            {!resourceCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px]">工作库</div>
                <div className="truncate text-micro font-normal text-slate-500">素材 / 技能 / 模型</div>
              </div>
            )}
            <button
              className="ml-auto grid h-5 w-5 place-items-center rounded border border-white/10 text-slate-400 hover:text-cyan-200"
              title={resourceCollapsed ? "展开资源栏" : "收起资源栏"}
              aria-label={resourceCollapsed ? "展开资源栏" : "收起资源栏"}
              onClick={() => setResourceCollapsed((value) => !value)}
              data-toggle-resource-rail="true"
            >
              {resourceCollapsed ? <PanelLeftOpen className="pointer-events-none h-3 w-3" /> : <PanelLeftClose className="pointer-events-none h-3 w-3" />}
            </button>
          </div>
          {resourceCollapsed ? (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-auto p-1.5" data-resource-rail-collapsed="true">
              {primaryObjectTabs.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-md border transition-colors",
                    activeObjectType === type ? "border-cyan-300/80 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-black/15 text-slate-500 hover:text-slate-300"
                  )}
                  onClick={() => setActiveObjectType(type)}
                  title={label}
                  aria-label={`切换到${label}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          ) : (
            <>
          <div className="shrink-0 border-b border-white/10 p-2" data-resource-launcher-density="compact">
            <div className="wg-library-mode-card mb-2 rounded-md border border-white/10 bg-black/16 p-2" data-library-mode-card="true" data-library-mode-active={activeObjectType}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-slate-200">工作库入口</div>
                  <div className="truncate text-[12px] text-slate-500">素材、技能、模型、结果分层管理</div>
                </div>
                <span className="shrink-0 rounded border border-cyan-300/20 bg-cyan-300/8 px-1.5 py-0.5 text-[12px] text-cyan-100">{displayObjectType(activeObjectType)}</span>
              </div>
              <div className="wg-library-mode-actions grid grid-cols-2 gap-1" data-library-mode-actions="true">
                <button className="wg-library-action" onClick={() => fileInputRef.current?.click()} disabled={busy} title="上传素材" aria-label="上传素材" data-library-action="upload">
                  <Upload className="h-3.5 w-3.5" />
                  <span>上传</span>
                </button>
                <button className="wg-library-action" onClick={() => void openSkillManager()} title="打开 Pi 技能管理" aria-label="打开 Pi 技能管理" data-library-action="skill-manager">
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>技能</span>
                </button>
              </div>
            </div>
            <div className="wg-resource-primary-tabs grid gap-1" data-resource-primary-tabs-layout="segmented">
              {primaryObjectTabs.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  className={cn(
                    "flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium transition-colors",
                    activeObjectType === type ? "border-cyan-300/70 bg-cyan-300/12 text-cyan-100" : "border-white/8 bg-black/12 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  )}
                  onClick={() => setActiveObjectType(type)}
                  data-resource-primary-tab={type}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                  <span className="shrink-0 text-micro text-slate-600">
                    {type === "asset" ? assets.length : type === "skill" ? skills.length : type === "model" ? models.length : workspace?.results?.length ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-5 gap-1" data-resource-secondary-tabs="true">
              {objectTabs.filter(({ type }) => !primaryObjectTabs.some((tab) => tab.type === type)).map(({ type, label }) => (
                <button
                  key={type}
                  className={cn(
                    "h-6 rounded-md border px-1 text-[12px]",
                    activeObjectType === type ? "border-cyan-400/70 bg-cyan-400/8 text-cyan-200" : "border-white/8 text-slate-500 hover:text-slate-300"
                  )}
                  onClick={() => setActiveObjectType(type)}
                  title={label}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="wg-resource-submenu mt-2 rounded-md border border-white/10 bg-black/12 p-1.5" data-resource-submenu="true" data-resource-submenu-mode={activeObjectType}>
              {activeObjectType === "skill" ? (
                <div className="grid grid-cols-3 gap-1" data-resource-skill-submenu="true">
                  <button className="wg-resource-subaction" onClick={() => void searchSkillForNode()} disabled={busy} title="搜索本地技能" aria-label="搜索本地技能" data-resource-subaction="skill-search">
                    <Search className="h-3.5 w-3.5" />
                    <span>搜索</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => void createDraftSkillForNode()} disabled={busy || !activeNode} title="按当前节点创建草稿技能" aria-label="按当前节点创建草稿技能" data-resource-subaction="skill-create">
                    <Plus className="h-3.5 w-3.5" />
                    <span>新建</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => void openSkillManager()} title="打开技能文件管理" aria-label="打开技能文件管理" data-resource-subaction="skill-open">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>文件</span>
                  </button>
                </div>
              ) : activeObjectType === "asset" ? (
                <div className="grid grid-cols-3 gap-1" data-resource-asset-submenu="true">
                  <button className="wg-resource-subaction" onClick={() => fileInputRef.current?.click()} disabled={busy} title="上传素材" aria-label="上传素材" data-resource-subaction="asset-upload">
                    <Upload className="h-3.5 w-3.5" />
                    <span>上传</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => openNodeModule("asset")} disabled={!activeNode} title="绑定到当前节点" aria-label="绑定素材到当前节点" data-resource-subaction="asset-bind">
                    <Layers3 className="h-3.5 w-3.5" />
                    <span>绑定</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => void loadWorkspace()} title="刷新素材库" aria-label="刷新素材库" data-resource-subaction="asset-refresh">
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>刷新</span>
                  </button>
                </div>
              ) : activeObjectType === "model" ? (
                <div className="grid grid-cols-3 gap-1" data-resource-model-submenu="true">
                  <button className="wg-resource-subaction" onClick={() => openNodeModule("model")} disabled={!activeNode} title="选择当前节点模型" aria-label="选择当前节点模型" data-resource-subaction="model-select">
                    <Settings2 className="h-3.5 w-3.5" />
                    <span>选择</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => void loadWorkspace()} title="刷新模型列表" aria-label="刷新模型列表" data-resource-subaction="model-refresh">
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>刷新</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => openNodeModule("params")} disabled={!activeNode} title="打开节点参数" aria-label="打开节点参数" data-resource-subaction="model-params">
                    <Brain className="h-3.5 w-3.5" />
                    <span>参数</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1" data-resource-result-submenu="true">
                  <button className="wg-resource-subaction" onClick={() => setBottomTab("预览")} title="打开预览" aria-label="打开结果预览" data-resource-subaction="result-preview">
                    <Image className="h-3.5 w-3.5" />
                    <span>预览</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => void copyPreviewText()} disabled={!previewText && !previewUrl} title="复制结果" aria-label="复制结果" data-resource-subaction="result-copy">
                    <FileText className="h-3.5 w-3.5" />
                    <span>复制</span>
                  </button>
                  <button className="wg-resource-subaction" onClick={() => setBottomTab("反馈")} title="写入反馈" aria-label="写入反馈" data-resource-subaction="result-feedback">
                    <MessageSquareText className="h-3.5 w-3.5" />
                    <span>反馈</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0 border-b border-white/10 px-2 py-1.5" data-resource-toolbar="true" data-resource-toolbar-density="compact">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-slate-300">资源</div>
                <div className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-500" data-resource-current-summary="true">
                  <span className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5" data-resource-active-type="true">{displayObjectType(activeObjectType)}</span>
                  <span className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5" data-resource-result-count="true">{filteredObjects.length}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className="grid h-7 w-7 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70 disabled:opacity-50" title="上传素材" aria-label="上传素材到工作库" onClick={() => fileInputRef.current?.click()} disabled={busy} data-resource-action="upload">
                  <Upload className="h-3.5 w-3.5" />
                </button>
                <button className="grid h-7 w-7 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70" title="刷新资源" aria-label="刷新工作库资源" onClick={() => void loadWorkspace()} data-resource-action="refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <input
              className="mt-1.5 w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[12px] text-slate-200 placeholder:text-slate-500 outline-none"
              value={objectSearchTerm}
              onChange={(event) => setObjectSearchTerm(event.target.value)}
              placeholder="搜索素材 / 技能 / 模型 / 结果"
              data-resource-search-input="true"
            />
          </div>
          <div className="wg-resource-list min-h-0 flex-1 overflow-auto p-2" data-resource-object-list="true" data-resource-list-density="compact-workbench">
            {filteredObjects.length ? filteredObjects.map((object) => (
              <button
                key={object.id}
                draggable={object.type === "asset"}
                onDragStart={(event) => {
                  if (object.type !== "asset") return;
                  const assetId = object.id.replace(/^asset:/, "");
                  event.dataTransfer.setData("application/x-workgraph-asset", assetId);
                  event.dataTransfer.setData("text/plain", assetId);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="wg-resource-object mb-1 grid w-full rounded-md border border-white/10 bg-black/15 p-1.5 text-left transition hover:border-cyan-500/50 hover:bg-cyan-400/5"
                onClick={() => object.type === "skill" ? void openSkill(object.id) : undefined}
                data-resource-object-type={object.type}
                data-resource-object-interaction={object.type === "asset" ? "drag" : object.type === "skill" ? "open" : "inspect"}
                data-resource-object-density="compact"
                data-resource-object-layout="scan-row"
                data-resource-object-role="workbench-row"
              >
                <span className="wg-resource-object-rail" aria-hidden="true" data-resource-object-rail="true" />
                <div className="wg-resource-object-main min-w-0" data-resource-object-main="true">
                <div className="flex items-center justify-between gap-2" data-resource-object-metadata="true">
                  <span className="wg-resource-type-badge truncate text-[12px] font-semibold text-slate-500">{displayObjectType(object.type)}</span>
                  <span className="wg-resource-id truncate text-[12px] text-cyan-200" title={object.id}>{displayShortId(object.id)}</span>
                </div>
                <div className="mt-0.5 truncate text-[12px] font-medium text-slate-100" data-resource-object-title="true">{displayTextAlias(object.title) || object.id}</div>
                <div className="mt-0.5 line-clamp-1 text-[12px] leading-5 text-slate-500" data-resource-object-summary="true">{displayTextAlias(object.summary) || object.id}</div>
                </div>
                <div className="wg-resource-object-action flex items-center justify-between gap-2 text-[12px] text-slate-600" data-resource-object-affordance="true" data-resource-object-action-zone="true">
                  <span className="truncate" data-resource-drag-hint={object.type === "asset" ? "true" : undefined}>
                    {object.type === "asset" ? "拖到节点绑定素材" : object.type === "skill" ? "打开技能详情" : "用于当前工作图"}
                  </span>
                  <span className="wg-resource-action-pill shrink-0 rounded border border-white/8 bg-white/5 px-1.5 py-0.5" data-resource-action-pill="true" data-resource-primary-action={object.type === "asset" ? "drag" : object.type === "skill" ? "open" : "reference"}>{object.type === "asset" ? "拖拽" : object.type === "skill" ? "打开" : "引用"}</span>
                </div>
              </button>
            )) : (
              <div className="wg-empty-state wg-resource-empty-state rounded-md border border-dashed border-cyan-300/20 bg-slate-900/50 p-3 text-[12.5px] leading-5 text-slate-500" data-resource-empty-state="true" data-resource-empty-type={activeObjectType}>
                <div className="text-[12px] font-semibold text-slate-200" data-resource-empty-title="true">{displayObjectType(activeObjectType)}库为空</div>
                <div className="mt-1 text-[12.5px] leading-5 text-slate-500" data-resource-empty-copy="true">
                  {activeObjectType === "asset"
                    ? "上传或拖入图片、视频、文本后，可直接绑定到当前节点。"
                    : activeObjectType === "skill"
                    ? "打开 Pi 技能管理或保存当前节点，形成可复用技能。"
                    : "生成工作图后，这里会显示可引用对象。"}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1" data-resource-empty-actions="true">
                  <button className="grid h-8 place-items-center rounded border border-cyan-300/24 bg-cyan-300/8 text-cyan-100 hover:border-cyan-300/60 disabled:opacity-50" onClick={() => fileInputRef.current?.click()} disabled={busy} title="上传素材" aria-label="上传素材到资源库" data-resource-empty-action="upload">
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                  <button className="grid h-8 place-items-center rounded border border-white/10 bg-black/20 text-slate-300 hover:border-cyan-500/60 disabled:opacity-50" onClick={() => void planGoal()} disabled={busy} title="生成工作图" aria-label="根据底部目标生成工作图" data-resource-empty-action="plan">
                    <Wand2 className="h-3.5 w-3.5" />
                  </button>
                  <button className="grid h-8 place-items-center rounded border border-white/10 bg-black/20 text-slate-300 hover:border-cyan-500/60" onClick={() => void openSkillManager()} title="打开 Pi 技能" aria-label="打开 Pi 技能管理" data-resource-empty-action="skill">
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </aside>

        <section className="relative h-full min-h-0 overflow-hidden" data-workbench-center="execution-graph" data-workgraph-canvas="true">
          <div
            ref={reactFlowWrapperRef}
            className="wg-canvas-frame absolute inset-0 overflow-hidden rounded"
            onDragEnter={(event) => {
              event.preventDefault();
              setIsCanvasDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsCanvasDragOver(true);
            }}
            onDragLeave={(event) => {
              if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as globalThis.Node)) return;
              setIsCanvasDragOver(false);
            }}
            onDrop={(event) => void handleAssetDrop(event)}
            data-canvas-drop-zone="true"
            data-workgraph-canvas-frame="true"
            data-canvas-drag-over={isCanvasDragOver ? "true" : "false"}
          >
            <div className="wg-canvas-title-strip pointer-events-none absolute left-3 right-3 top-3 z-[8] flex items-center justify-between gap-3 rounded-md border border-white/8 bg-black/24 px-3 py-1.5 text-[12px] text-slate-500 backdrop-blur" data-canvas-status-bar="true" data-canvas-status-position="merged-title" data-canvas-status-layout="chips">
              <div className="wg-canvas-status-chips flex min-w-0 items-center gap-1.5" data-canvas-status-chips="true">
                <span className="shrink-0 font-semibold uppercase text-slate-300" data-canvas-status-title="true">执行图谱</span>
                <span className="wg-canvas-status-chip min-w-0 max-w-[190px] truncate" data-canvas-active-node="true" title={displayNodeTitle(activeNode)}>节点：{displayNodeTitle(activeNode)}</span>
                <span className="wg-canvas-status-chip hidden min-w-0 max-w-[120px] truncate md:inline" data-canvas-active-module="true">模块：{activeModuleLabel}</span>
                <span className="wg-canvas-status-chip hidden min-w-0 max-w-[104px] truncate lg:inline" data-canvas-active-status="true">状态：{activeNode?.status || "待处理"}</span>
              </div>
              <div className="wg-canvas-status-chips flex shrink-0 items-center gap-1.5">
                <span className="wg-canvas-status-chip" data-canvas-graph-count="true">{plannedNodes.length} 节点 / {plannedEdges.length} 连接</span>
                <span className="wg-canvas-status-chip truncate text-cyan-200" data-canvas-next-action="true">{busy ? "正在执行" : "运行或调整模块"}</span>
              </div>
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onInit={(instance) => {
                setReactFlowInstance(instance);
                void fitCanvasWithSafeTop(instance, 0);
              }}
              onNodeClick={(_, node) => activateNode(node.id)}
              fitView
              fitViewOptions={{ padding: 0.12, minZoom: 0.3 }}
              minZoom={0.28}
              maxZoom={1.35}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} size={1} color="rgba(148,163,184,0.18)" />
              <Controls position="bottom-left" />
            </ReactFlow>
          </div>
          <div className="wg-canvas-drop-hint pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-dashed border-cyan-300/24 bg-[#0c1116]/78 px-2.5 py-1.5 text-[12px] text-slate-500 backdrop-blur" data-canvas-file-drop-hint="true">
            拖入图片 / 视频 / 文本到节点，自动上传并绑定素材
          </div>
          {isCanvasDragOver && (
            <div className="wg-canvas-drop-overlay pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-lg border border-dashed border-cyan-300/70 bg-cyan-300/8 text-[13.5px] font-semibold text-cyan-100 backdrop-blur-[2px]" data-canvas-drop-overlay="true">
              松手上传并绑定到当前节点
            </div>
          )}
          {activeNode && (
            <div
              className="wg-canvas-node-toolbar absolute right-3 top-12 z-20 flex items-center gap-1.5 rounded-md border border-white/10 bg-[#111214]/94 px-1.5 py-1.5 shadow-2xl shadow-black/28 backdrop-blur"
              data-canvas-node-toolbar="true"
              data-canvas-node-toolbar-mode="focused"
              data-canvas-node-toolbar-position="below-title"
            >
              <div className="max-w-[154px] truncate px-1.5 text-[12.5px] text-slate-300" title={displayNodeTitle(activeNode)}>
                {displayNodeTitle(activeNode)}
              </div>
                <button className="grid h-7 w-7 place-items-center rounded-md bg-cyan-300 text-slate-950 disabled:opacity-50 wg-btn-soft" title="运行节点" aria-label="运行当前节点" onClick={() => void runNode()} disabled={busy}>
                  <Play className="h-3.5 w-3.5" />
                </button>
              <button className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-slate-300 disabled:opacity-50 wg-btn-soft" title="失败重试" aria-label="重试当前节点" onClick={() => void retryActiveNode()} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-slate-300 wg-btn-soft"
                title={inspectorCollapsed ? "展开节点检查器" : "收起节点检查器"}
                aria-label={inspectorCollapsed ? "展开节点检查器" : "收起节点检查器"}
                onClick={() => {
                  setInspectorCollapsed((value) => !value);
                  openNodeModule(nodeModuleDrawer || preferredNodeModuleDrawer(activeNode.type));
                }}
                data-toggle-inspector="true"
              >
                <Settings2 className="pointer-events-none h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </section>

        <aside className={cn("wg-inspector-panel min-h-0 overflow-hidden border-l border-white/10 bg-slate-950/74 wg-panel", inspectorCollapsed && "pointer-events-none opacity-0")} data-inspector-panel="true" data-inspector-layout="node-workbench">
          <div className="wg-inspector-header border-b border-white/12 p-2.5" data-inspector-header-density="compact">
            <div className="flex items-start gap-2">
              <div className="wg-inspector-icon grid h-7 w-7 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                <Settings2 className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-slate-100" data-inspector-node-title="true">{displayNodeTitle(activeNode)}</div>
                <div className="mt-1 flex min-w-0 items-center gap-1 text-micro text-slate-500" data-inspector-node-meta="true">
                  <span className="min-w-0 flex-1 truncate rounded border border-white/8 bg-black/18 px-1.5 py-0.5" title={activeNode?.id || "未选择节点"} data-inspector-node-id="true">{activeNode?.id || "未选择节点"}</span>
                  <span className="shrink-0 truncate rounded border border-cyan-300/16 bg-cyan-300/7 px-1.5 py-0.5 text-cyan-100" data-inspector-node-type="true">{displayNodeType(activeNode?.type)}</span>
                  <span className="shrink-0 truncate rounded border border-white/8 bg-white/5 px-1.5 py-0.5" data-inspector-node-status="true">{activeNode?.status || "待处理"}</span>
                </div>
              </div>
              <button
                className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-slate-400 hover:text-cyan-200"
                title="收起节点检查"
                aria-label="收起节点检查器"
                onClick={() => setInspectorCollapsed(true)}
              >
                <PanelRightClose className="pointer-events-none h-3 w-3" />
              </button>
            </div>
            <div className="wg-inspector-summary mt-1.5 flex min-w-0 items-center gap-1 text-[12px]" data-inspector-summary="true" data-inspector-summary-layout="node-instrument">
              <span className="min-w-0 flex-1 truncate rounded border border-white/10 bg-black/16 px-2 py-0.5" title={activeNode?.modelId || workspace?.activeModelId || "自动模型"} data-inspector-primary-stat="model">模型 {displayModelName(activeNode?.modelId || workspace?.activeModelId, models)}</span>
              <span className="shrink-0 rounded border border-white/10 bg-black/16 px-2 py-0.5" data-inspector-stat="asset">素材 {activeNode?.materialIds?.length ?? 0}</span>
              <span className="shrink-0 rounded border border-white/10 bg-black/16 px-2 py-0.5" data-inspector-stat="log">日志 {activeNodeLogs.length}</span>
            </div>
          </div>
          <div className="wg-inspector-body h-[calc(100%-68px)] space-y-2 overflow-auto p-2 text-[12.5px]" data-inspector-body="true">
            <div className="wg-inspector-tabs mb-2 flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1" data-inspector-tabs="true">
              {inspectorTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] font-medium",
                      inspectorTab === tab.id
                        ? "bg-cyan-400/20 text-cyan-200"
                        : "text-slate-500 hover:text-slate-300"
                    )}
                    onClick={() => setInspectorTab(tab.id)}
                    aria-pressed={inspectorTab === tab.id}
                    data-inspector-tab={tab.id}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className={cn("space-y-2", inspectorTab === "overview" ? "" : "hidden")} data-inspector-overview-console="true">
            <div className="wg-inspector-card rounded-md border border-white/10 bg-black/18 p-2.5" data-inspector-overview-card="true" data-inspector-overview-density="compact">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] uppercase text-slate-500">当前节点</div>
                  <input
                    className="mt-0.5 w-full border-0 bg-transparent p-0 text-[14px] font-semibold text-slate-100 outline-none"
                    value={activeNode?.title || ""}
                    onChange={(event) => void patchActiveNode({ title: event.target.value }, "node title saved")}
                    placeholder="节点标题"
                    disabled={!activeNode || busy}
                  />
                </div>
                <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-slate-400">{displayNodeType(activeNode?.type)}</span>
              </div>
              {activeOperationProfile && (
                <div className="mt-2 rounded-md border border-cyan-300/16 bg-cyan-300/6 p-2" data-node-inspector-operation-profile="true" data-node-inspector-operation-density="compact">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-cyan-100">{activeOperationProfile.role}</span>
                    <span className="text-[12px] text-slate-500">{activeNode?.status || "就绪"}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-slate-400">{activeOperationProfile.intent}</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-1 text-[12px] text-slate-500" data-inspector-operation-takeover="true">
                    {activeOperationProfile.takeover.slice(0, 3).map((item) => (
                      <span key={item} className="truncate rounded bg-black/18 px-1.5 py-1 text-center">{item}</span>
                    ))}
                  </div>
                </div>
              )}
              <textarea
                className="mt-2 h-20 w-full resize-none rounded-md border border-white/10 bg-black/25 p-2 text-[12px] leading-5 text-slate-300 outline-none focus:border-cyan-300/70"
                value={activeNode?.body || ""}
                onChange={(event) => void patchActiveNode({ body: event.target.value }, "node prompt saved")}
                placeholder="节点输入 / Prompt / 约束"
                disabled={!activeNode || busy}
              />
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[12px] text-slate-500">
                <span className="truncate rounded bg-white/5 px-2 py-1" title={activeNode?.modelId || workspace?.activeModelId || "自动模型"}>模型: {displayModelName(activeNode?.modelId || workspace?.activeModelId, models)}</span>
                <span className="truncate rounded bg-white/5 px-2 py-1">素材: {activeNode?.materialIds?.length ?? 0}</span>
                <span className="truncate rounded bg-white/5 px-2 py-1">日志: {activeNodeLogs.length}</span>
              </div>
            </div>
            <div className="wg-inspector-command-grid grid grid-cols-[1fr_1fr] gap-1" data-inspector-command-grid="true" data-inspector-command-scope="node-management" data-inspector-command-density="icon-label">
              <button className="wg-inspector-command" onClick={() => void openActiveSkillDrawer()} title="打开技能" aria-label="打开当前节点技能" data-inspector-command="skill" data-inspector-command-tone="primary">
                <span className="wg-inspector-command-icon"><FolderOpen className="h-3.5 w-3.5" /></span>
                <span className="wg-inspector-command-label">技能</span>
              </button>
              <button className="wg-inspector-command disabled:opacity-50" onClick={() => void addNodeAfterActive()} disabled={busy} title="新增节点" aria-label="在当前节点后插入节点" data-inspector-command="insert" data-inspector-command-tone="neutral">
                <span className="wg-inspector-command-icon"><Plus className="h-3.5 w-3.5" /></span>
                <span className="wg-inspector-command-label">插入</span>
              </button>
              <button className="wg-inspector-command disabled:opacity-50" onClick={() => void saveActiveNodeAsSkill()} disabled={busy || !activeNode} title="保存为技能" aria-label="保存当前节点为技能" data-inspector-command="save" data-inspector-command-tone="neutral">
                <span className="wg-inspector-command-icon"><Save className="h-3.5 w-3.5" /></span>
                <span className="wg-inspector-command-label">保存</span>
              </button>
              <button className="wg-inspector-command disabled:opacity-50" onClick={() => void deleteActiveNode()} disabled={busy || !activeNode} title="删除节点" aria-label="删除当前节点" data-inspector-command="delete" data-inspector-command-tone="danger">
                <span className="wg-inspector-command-icon"><Trash2 className="h-3.5 w-3.5" /></span>
                <span className="wg-inspector-command-label">删除</span>
              </button>
            </div>
            </div>
            <div className={cn("wg-module-property-panel space-y-2", inspectorTab === "modules" ? "" : "hidden")} data-inspector-modules-panel="true" data-workbench-details="node-drilldown" data-active-module={nodeModuleDrawer || "params"} data-property-panel-layout="designer">
              <div data-node-module-drawer-launcher="true">
              <div className="wg-property-panel-heading mb-1.5 flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/16 px-2 py-1.5" data-property-panel-heading="true" data-property-panel-heading-layout="module-context">
                <div className="min-w-0">
                  <div className="text-[12px] text-slate-500">节点模块</div>
                  <div className="truncate text-[12px] font-semibold text-slate-100" data-property-active-module-label="true">{activeModuleLabel} · {displayNodeTitle(activeNode)}</div>
                </div>
                <span className="shrink-0 rounded border border-cyan-300/20 bg-cyan-300/8 px-1.5 py-0.5 text-[12px] text-cyan-100" data-property-active-module-pill="true">{activeModuleLabel}</span>
              </div>
              <div className="wg-module-segmented flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-1" data-property-module-rail="true">
                {([
                  ["params", "参数", Settings2],
                  ["model", "模型", Brain],
                  ["skill", "技能", FolderOpen],
                  ["asset", "素材", Image],
                  ["brand", "品牌", Database]
                ] as Array<[Exclude<NodeModuleDrawer, null>, string, React.ElementType]>).map(([drawer, label, Icon]) => (
                  <button
                    key={drawer}
                    className={cn(
                      "inline-flex h-8 min-w-[58px] shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium",
                      nodeModuleDrawer === drawer ? "bg-cyan-400/16 text-cyan-100" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    )}
                    data-node-module-button={drawer}
                    data-property-module-state={nodeModuleDrawer === drawer ? "active" : "idle"}
                    aria-pressed={nodeModuleDrawer === drawer}
                    onClick={() => openNodeModule(drawer)}
                    title={`打开 ${label} 模块`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="wg-execution-flow mt-2 grid grid-cols-3 gap-1" data-execution-flow="true" data-execution-flow-scope="property-panel" data-execution-flow-density="inspector">
                {executionFlowSteps.map((step) => (
                  <button
                    key={step.key}
                    className="wg-execution-step min-w-0 rounded border px-2 py-1.5 text-left"
                    title={`${step.label}: ${step.value} · ${step.hint}`}
                    data-execution-step={step.key}
                    data-execution-step-state={step.state}
                    onClick={() => {
                      if (step.key === "skill") openNodeModule("skill");
                      else if (step.key === "model") openNodeModule("model");
                      else if (step.key === "asset") openNodeModule("asset");
                      else if (step.key === "feedback") setBottomTab("反馈");
                      else if (step.key === "result") setBottomTab("预览");
                      else openNodeModule("params");
                    }}
                  >
                    <span className="block truncate text-[12px] uppercase leading-none text-slate-500">{step.label}</span>
                    <span className="mt-1 block truncate text-[12.5px] leading-none text-slate-200">{step.value}</span>
                  </button>
                ))}
              </div>
              <div
                className="wg-module-state-grid mt-2 flex min-w-0 items-center gap-1 overflow-x-auto rounded-md border border-slate-800 bg-slate-950/45 p-1.5 text-micro text-slate-500"
                data-module-state-strip="true"
                data-module-state-layout="single-row"
                data-property-state-strip="true"
              >
                <span className="max-w-[128px] shrink-0 truncate rounded bg-white/5 px-2 py-1 text-cyan-100" data-module-state-current="true" title={activeModuleHint}>当前：{activeModuleLabel}</span>
                <span className="max-w-[148px] shrink-0 truncate rounded bg-white/5 px-2 py-1" data-module-state-node="true" title={displayNodeTitle(activeNode)}>节点：{displayNodeTitle(activeNode)}</span>
                <span className="max-w-[150px] shrink-0 truncate rounded bg-white/5 px-2 py-1" data-module-state-model="true" title={activeNode?.modelId || workspace?.activeModelId || "自动模型"}>模型：{displayModelName(activeNode?.modelId || workspace?.activeModelId, models)}</span>
                <span className="shrink-0 truncate rounded bg-white/5 px-2 py-1" data-module-state-assets="true">素材：{activeNode?.materialIds?.length ?? 0}</span>
                <span className="shrink-0 truncate rounded bg-white/5 px-2 py-1" data-module-state-logs="true">日志：{activeNodeLogs.length}</span>
                <span className="max-w-[112px] shrink-0 truncate rounded bg-white/5 px-2 py-1" data-module-state-params="true" title={formatRecord(activeNode?.params ?? {}) || "{}"}>参数：{Object.keys(activeNode?.params ?? {}).length}</span>
              </div>
              <div
                className="wg-module-action-grid mt-1.5 grid grid-cols-4 gap-1 rounded-md border border-slate-800 bg-slate-950/45 p-1"
                data-module-action-bar="true"
                data-module-action-density="icon-only"
                data-property-action-strip="true"
              >
                <button className="inline-flex h-7 items-center justify-center gap-1 rounded bg-cyan-300 px-1.5 text-[12px] font-semibold text-slate-950 disabled:opacity-60" onClick={() => void runNode()} disabled={busy || !activeNode} title="运行当前节点" aria-label="运行当前节点" data-module-action="run">
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex h-7 items-center justify-center gap-1 rounded border border-white/10 px-1.5 text-[12px] text-cyan-100 disabled:opacity-50" onClick={() => void retryActiveNode()} disabled={busy || !activeNode} title="重试当前节点" aria-label="重试当前节点" data-module-action="retry">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex h-7 items-center justify-center gap-1 rounded border border-white/10 px-1.5 text-[12px] text-slate-300" onClick={() => void openActiveSkillDrawer()} title="打开技能文件" aria-label="打开技能文件" data-module-action="open-skill">
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button className="inline-flex h-7 items-center justify-center gap-1 rounded border border-white/10 px-1.5 text-[12px] text-slate-300 disabled:opacity-50" onClick={() => void saveActiveNodeAsSkill()} disabled={busy || !activeNode} title="保存当前节点为技能" aria-label="保存当前节点为技能" data-module-action="save-skill">
                  <Save className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="wg-property-block mt-2 rounded-md border border-white/10 bg-black/14 p-2 text-[12.5px] leading-5 text-slate-400" data-active-module-summary="true" data-active-module-summary-tone="plain" data-property-block="intent">
                <div className="grid grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-1.5" data-module-operation-guide="true">
                  <div className="rounded border border-cyan-300/16 bg-cyan-300/6 px-2 py-1.5" data-module-current-operation="true">
                    <div className="text-[12px] uppercase text-cyan-200/80">当前操作</div>
                    <div className="mt-0.5 truncate text-[12px] font-semibold text-cyan-50">{activeModuleAction}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5" data-module-next-action="true">
                    <div className="text-[12px] uppercase text-slate-500">下一步</div>
                    <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-200">{activeModuleNext}</div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-slate-500" data-active-module-hint="true">{activeModuleHint}</p>
              </div>
              <div className="mt-2 space-y-1" data-node-native-module-drawers="true" data-property-module-drawers="true">
                <details open className={cn("wg-native-module rounded border border-slate-800 bg-slate-950/40", nodeModuleDrawer === "params" || !nodeModuleDrawer ? "" : "hidden")} data-node-native-module="params" data-module-open={nodeModuleDrawer === "params" || !nodeModuleDrawer} data-property-section="params">
                  <summary className="cursor-pointer px-2 py-1.5 text-[12px] font-semibold uppercase text-slate-300">参数</summary>
                  <div className="wg-property-section-body border-t border-slate-800 p-2" data-property-section-body="true">
                    {/video/i.test(activeNode?.type || "") && (
                      <div className="wg-property-grid grid grid-cols-3 gap-2" data-property-control-grid="video">
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="aspect">宽高比<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.宽高比 ?? "9:16")} onChange={(event) => void patchActiveNodeParams({ 宽高比: event.target.value })} disabled={!activeNode || busy}>{["9:16", "16:9", "1:1", "4:5"].map((宽高比) => <option key={宽高比} value={宽高比}>{宽高比}</option>)}</select></label>
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="duration">时长<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.duration ?? "8s")} onChange={(event) => void patchActiveNodeParams({ duration: event.target.value })} disabled={!activeNode || busy}>{["6s", "8s", "12s", "15s"].map((duration) => <option key={duration} value={duration}>{duration}</option>)}</select></label>
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="quality">清晰度<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.清晰度 ?? "预览")} onChange={(event) => void patchActiveNodeParams({ 清晰度: event.target.value })} disabled={!activeNode || busy}>{["预览", "720p", "1080p"].map((清晰度) => <option key={清晰度} value={清晰度}>{清晰度}</option>)}</select></label>
                      </div>
                    )}
                    {/image|预览/i.test(activeNode?.type || "") && !/video/i.test(activeNode?.type || "") && (
                      <div className="wg-property-grid grid grid-cols-3 gap-2" data-property-control-grid="image">
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="size">尺寸<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.尺寸 ?? "1024x1024")} onChange={(event) => void patchActiveNodeParams({ 尺寸: event.target.value })} disabled={!activeNode || busy}>{["1024x1024", "1024x1536", "1536x1024"].map((尺寸) => <option key={尺寸} value={尺寸}>{尺寸}</option>)}</select></label>
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="reference">引用源<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.referenceMode ?? "brand_assets")} onChange={(event) => void patchActiveNodeParams({ referenceMode: event.target.value })} disabled={!activeNode || busy}>{["brand_assets", "node_assets", "none"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="format">输出<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.format ?? "png")} onChange={(event) => void patchActiveNodeParams({ format: event.target.value })} disabled={!activeNode || busy}>{["png", "jpg", "webp"].map((format) => <option key={format} value={format}>{format}</option>)}</select></label>
                      </div>
                    )}
                    {/text|prompt|goal|brand_context|skill/i.test(activeNode?.type || "") && (
                      <div className="wg-property-grid grid grid-cols-2 gap-2" data-property-control-grid="text">
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="schema">输出结构<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.schema ?? "structured")} onChange={(event) => void patchActiveNodeParams({ schema: event.target.value })} disabled={!activeNode || busy}>{["structured", "script", "storyboard", "prompt_pack"].map((schema) => <option key={schema} value={schema}>{schema}</option>)}</select></label>
                        <label className="wg-property-row text-[12px] text-slate-500" data-property-row="language">语言<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={String(activeNode?.params?.语言 ?? "thai_first")} onChange={(event) => void patchActiveNodeParams({ 语言: event.target.value })} disabled={!activeNode || busy}>{["thai_first", "zh_cn", "en", "mixed"].map((语言) => <option key={语言} value={语言}>{语言}</option>)}</select></label>
                      </div>
                    )}
                  </div>
                </details>
                <details open className={cn("wg-native-module rounded border border-slate-800 bg-slate-950/40", nodeModuleDrawer === "model" ? "" : "hidden")} data-node-native-module="model" data-module-open={nodeModuleDrawer === "model"} data-property-section="model">
                  <summary className="cursor-pointer px-2 py-1.5 text-[12px] font-semibold uppercase text-slate-300">模型</summary>
                  <div className="wg-property-section-body space-y-2 border-t border-slate-800 p-2" data-model-policy-learning-panel="true" data-property-section-body="true">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="wg-property-row text-[12px] text-slate-500" data-property-row="model-id">模型<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-2 text-[12px] text-slate-300" value={activeNode?.modelId || workspace?.activeModelId || "自动"} onChange={(event) => void patchActiveNode({ modelId: event.target.value }, "node model saved")} disabled={!activeNode || busy}>{(models.length ? models : [{ id: "自动", name: "自动选择", provider: "custom" }]).map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</select></label>
                      <label className="wg-property-row text-[12px] text-slate-500" data-property-row="model-strategy">策略<select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-2 text-[12px] text-slate-300" value={activeNode?.modelStrategy || "balanced"} onChange={(event) => void patchActiveNode({ modelStrategy: event.target.value }, "node strategy saved")} disabled={!activeNode || busy}>{modelStrategies.map((strategy) => <option key={strategy.value} value={strategy.value}>{strategy.label}</option>)}</select></label>
                    </div>
                    <div className="wg-property-block rounded border border-slate-800 bg-slate-950/70 p-2 text-[12px] leading-5 text-slate-400" data-property-block="model-policy">
                      <div className="font-semibold uppercase text-cyan-200">反馈策略</div>
                      {activeNodeModelPolicy ? (
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <span className="truncate" title={activeNodeModelPolicy.modelId || "自动模型"}>模型: {displayModelName(activeNodeModelPolicy.modelId, models)}</span>
                          <span className="truncate">策略: {activeNodeModelPolicy.strategy || "balanced"}</span>
                          <span className="truncate">评分: {activeNodeModelPolicy.rating || "n/a"}</span>
                          <span className={activeNodeModelPolicy.avoid ? "truncate text-red-200" : "truncate text-emerald-200"}>{activeNodeModelPolicy.avoid ? "避用路径" : "复用路径"}</span>
                          <span className="col-span-2 line-clamp-2 text-slate-500">{activeNodeModelPolicy.note || "暂无反馈说明"}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-slate-600">暂无反馈策略</div>
                      )}
                    </div>
                  </div>
                </details>
                <details open className={cn("wg-native-module rounded border border-slate-800 bg-slate-950/40", nodeModuleDrawer === "skill" ? "" : "hidden")} data-node-native-module="skill" data-module-open={nodeModuleDrawer === "skill"} data-property-section="skill">
                  <summary className="cursor-pointer px-2 py-1.5 text-[12px] font-semibold uppercase text-slate-300">技能</summary>
                  <div className="wg-property-section-body space-y-2 border-t border-slate-800 p-2" data-node-skill-workbench="true" data-node-skill-search="true" data-property-section-body="true">
                    <div className="wg-skill-bind-card rounded border border-violet-400/18 bg-violet-400/6 p-2" data-skill-bind-card="true" data-skill-bound-state={activeNode?.skillId ? "bound" : "unbound"}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] uppercase text-violet-200/80">当前节点技能</div>
                          <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-100" title={activeNode?.skillId || "未绑定"}>
                            {activeNodeSkill ? displayTextAlias(activeNodeSkill.title) : activeNode?.skillId ? displayShortId(activeNode.skillId) : "未绑定，使用自动匹配"}
                          </div>
                        </div>
                        <span className="shrink-0 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[12px] text-slate-400" data-skill-search-count="true">{nodeSkillSearchCount} 结果</span>
                      </div>
                      <select className="mt-2 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={activeNode?.skillId || ""} onChange={(event) => void bindSkillToActiveNode(event.target.value)} disabled={!activeNode || busy} data-skill-bind-select="true">
                        <option value="">自动技能</option>
                        {skills.map((skill) => <option key={skill.id} value={skill.id}>{displayTextAlias(skill.title) || skill.id}</option>)}
                      </select>
                    </div>
                    <div className="wg-skill-search-console rounded border border-slate-800 bg-slate-950/60 p-2" data-skill-search-console="true">
                      <div className="mb-1 flex items-center justify-between gap-2 text-[12px] uppercase text-slate-500">
                        <span>本地技能搜索</span>
                        <button className="rounded border border-slate-800 px-1.5 py-0.5 text-[12px] text-slate-400 hover:border-cyan-500/60 hover:text-cyan-200" onClick={() => setNodeSkillQuery(nodeSkillSuggestedQuery)} disabled={!nodeSkillSuggestedQuery || busy} data-skill-query-use-node="true">用节点生成查询</button>
                      </div>
                      <div className="flex gap-1">
                        <input className="min-w-0 flex-1 rounded border border-slate-800 bg-black/30 px-2 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-300/70" value={nodeSkillQuery} onChange={(event) => setNodeSkillQuery(event.target.value)} placeholder="搜索本地技能、命令、能力类型" data-skill-search-input="true" />
                        <button className="rounded border border-cyan-700/70 bg-cyan-400/8 px-2 py-1.5 text-[12px] font-semibold text-cyan-100 disabled:opacity-50" onClick={() => void searchSkillForNode()} disabled={busy} data-skill-search-submit="true">搜索</button>
                      </div>
                    </div>
                    <div className="wg-skill-result-list max-h-32 overflow-auto rounded border border-slate-800 bg-slate-950/70 p-1" data-skill-result-list="true" data-skill-result-count={nodeSkillSearchCount}>
                      {nodeSkillSearchResults.length ? nodeSkillSearchResults.slice(0, 6).map((skill) => (
                        <button key={skill.id} className="wg-skill-result-item mb-1 block w-full rounded border border-transparent px-2 py-1.5 text-left text-[12px] text-slate-300 hover:border-violet-400/40 hover:bg-violet-400/6" onClick={() => void bindSkillToActiveNode(skill.id, "搜索技能已绑定")} data-skill-result-item="true" data-skill-result-bound={activeNode?.skillId === skill.id ? "true" : "false"}>
                          <span className="block truncate font-semibold">{displayTextAlias(skill.title) || skill.id}</span>
                          <span className="mt-0.5 block truncate text-micro text-slate-500">{skill.command || skill.id}</span>
                        </button>
                      )) : (
                        <div className="px-2 py-2 text-[12px] leading-5 text-slate-500" data-skill-empty-results="true">没有搜索结果。可以用当前节点创建草稿技能，再打开文件细化。</div>
                      )}
                    </div>
                    <div className="wg-skill-action-grid grid grid-cols-3 gap-1" data-skill-action-grid="true">
                      <button className="rounded border border-slate-700 px-2 py-1.5 text-slate-300 hover:border-cyan-500/60" onClick={() => void openActiveSkillDrawer()} data-skill-action="open-file">文件</button>
                      <button className="rounded border border-slate-700 px-2 py-1.5 text-slate-300 hover:border-cyan-500/60 disabled:opacity-50" onClick={() => void saveActiveNodeAsSkill()} disabled={!activeNode || busy} data-skill-action="save-node">保存</button>
                      <button className="rounded border border-cyan-700/70 bg-cyan-400/8 px-2 py-1.5 font-semibold text-cyan-100 disabled:opacity-50" onClick={() => void createDraftSkillForNode()} disabled={!activeNode || busy} data-skill-action="create-draft">草稿</button>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-micro text-slate-500" data-online-skill-search-state="reserved">在线技能搜索保留；当前只用本地 Pi/data 技能，避免不必要外部请求。</div>
                  </div>
                </details>
                <details open className={cn("wg-native-module rounded border border-slate-800 bg-slate-950/40", nodeModuleDrawer === "asset" ? "" : "hidden")} data-node-native-module="asset" data-module-open={nodeModuleDrawer === "asset"} data-property-section="asset">
                  <summary className="cursor-pointer px-2 py-1.5 text-[12px] font-semibold uppercase text-slate-300">素材</summary>
                  <div className="wg-property-section-body space-y-2 border-t border-slate-800 p-2" data-node-asset-workbench="true" data-property-section-body="true">
                    <div className="wg-asset-bind-card rounded border border-emerald-400/18 bg-emerald-400/6 p-2" data-asset-bind-card="true" data-asset-bound-state={activeNodeAssets.length ? "bound" : "empty"} data-property-row="asset-binding">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] uppercase text-emerald-200/80">当前节点素材</div>
                          <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-100" title={(activeNode?.materialIds ?? []).join(", ") || "未绑定"}>
                            {activeNodeAssets.length ? `${activeNodeAssets.length} 个已绑定` : "未绑定，可拖入或上传"}
                          </div>
                        </div>
                        <button className="shrink-0 rounded border border-emerald-400/28 bg-emerald-400/8 px-2 py-1 text-[12px] font-semibold text-emerald-100 disabled:opacity-50" onClick={() => fileInputRef.current?.click()} disabled={busy} data-asset-upload-inline="true">上传</button>
                      </div>
                      <select className="mt-2 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300" value={activeNode?.materialIds?.[0] || workspace?.activeMaterialId || ""} onChange={(event) => void patchActiveNode({ materialIds: event.target.value ? [event.target.value] : [] }, "节点素材已保存")} disabled={!activeNode || busy} data-asset-bind-select="true">
                        <option value="">无素材</option>
                        {assetLibraryCandidates.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || asset.id}</option>)}
                      </select>
                    </div>
                    <div className="wg-asset-bound-list rounded border border-slate-800 bg-slate-950/70 p-1" data-asset-bound-list="true" data-asset-bound-count={activeNodeAssets.length}>
                      {activeNodeAssets.length ? activeNodeAssets.map((asset) => (
                        <div key={asset.id} className="wg-asset-bound-item mb-1 grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-emerald-400/16 bg-emerald-400/5 p-1.5" data-asset-bound-item="true">
                          <div className="grid h-8 w-8 place-items-center overflow-hidden rounded border border-white/10 bg-black/24">
                            {asset.thumbnailUrl || asset.预览Url ? <img src={asset.thumbnailUrl || asset.预览Url} alt={asset.title || asset.id} className="h-full w-full object-cover" /> : <Image className="h-4 w-4 text-slate-500" />}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-semibold text-slate-100">{asset.title || displayShortId(asset.id)}</div>
                            <div className="truncate text-micro text-slate-500">{asset.kind || asset.fileName || asset.id}</div>
                          </div>
                          <button className="rounded border border-slate-700 px-1.5 py-1 text-[12px] text-slate-400 hover:border-red-400/60 hover:text-red-200" onClick={() => void unbindAssetFromNode(asset.id)} disabled={busy} data-asset-unbind="true">移除</button>
                        </div>
                      )) : (
                        <div className="px-2 py-2 text-[12px] leading-5 text-slate-500" data-asset-empty-bound="true">暂无绑定素材。可从左侧资源拖到节点、拖到底部输入区，或直接上传。</div>
                      )}
                    </div>
                    <div className="wg-asset-candidate-list max-h-32 overflow-auto rounded border border-slate-800 bg-slate-950/70 p-1" data-asset-candidate-list="true" data-asset-candidate-count={unboundAssetCandidates.length}>
                      {unboundAssetCandidates.length ? unboundAssetCandidates.slice(0, 8).map((asset) => (
                        <button key={asset.id} className="wg-asset-candidate-item mb-1 grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-transparent p-1.5 text-left hover:border-emerald-400/30 hover:bg-emerald-400/5" onClick={() => void bindAssetToNode(asset.id, activeNode?.id, "素材已绑定到节点")} disabled={busy || !activeNode} data-asset-candidate-item="true">
                          <div className="grid h-7 w-7 place-items-center overflow-hidden rounded border border-white/10 bg-black/24">
                            {asset.thumbnailUrl || asset.预览Url ? <img src={asset.thumbnailUrl || asset.预览Url} alt={asset.title || asset.id} className="h-full w-full object-cover" /> : <Image className="h-3.5 w-3.5 text-slate-500" />}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-semibold text-slate-200">{asset.title || displayShortId(asset.id)}</div>
                            <div className="truncate text-micro text-slate-500">{asset.kind || asset.fileName || asset.id}</div>
                          </div>
                          <span className="rounded border border-slate-700 px-1.5 py-1 text-[12px] text-emerald-100">绑定</span>
                        </button>
                      )) : (
                        <div className="px-2 py-2 text-[12px] leading-5 text-slate-500" data-asset-empty-candidates="true">素材库暂无未绑定候选。上传文件后会出现在这里。</div>
                      )}
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-micro text-slate-500" data-asset-drop-hint-panel="true">支持：左侧资源拖到画布节点、拖到底部目标输入、粘贴文件、上传后自动绑定当前节点。</div>
                  </div>
                </details>
                <details open className={cn("wg-native-module rounded border border-slate-800 bg-slate-950/40", nodeModuleDrawer === "brand" ? "" : "hidden")} data-node-native-module="brand" data-module-open={nodeModuleDrawer === "brand"} data-property-section="brand">
                  <summary className="cursor-pointer px-2 py-1.5 text-[12px] font-semibold uppercase text-slate-300">品牌</summary>
                  <div className="wg-property-section-body border-t border-slate-800 p-2 leading-5 text-slate-400" data-brand-learning-panel="true" data-property-section-body="true">
                    <div className="font-semibold text-slate-200">{dapot?.name || "DA POT HOT POT"}</div>
                    <p className="mt-1 line-clamp-5">{dapot?.context || "年轻、干净、可信、温暖、适合拍照传播；禁用廉价感、拼接感、文字太多、过度复杂。"}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                      <div className="rounded border border-red-900/40 bg-red-950/20 p-2">
                        <div className="mb-1 font-semibold uppercase text-red-200">已学习回避</div>
                        <div className="space-y-1">
                          {learnedForbiddenWords.length ? learnedForbiddenWords.slice(-6).map((item) => (
                            <div key={item} className="rounded bg-slate-950/80 px-1.5 py-1 text-red-100/80">{item}</div>
                          )) : <div className="text-slate-600">暂无反馈学习</div>}
                        </div>
                      </div>
                      <div className="rounded border border-emerald-900/40 bg-emerald-950/20 p-2">
                        <div className="mb-1 font-semibold uppercase text-emerald-200">可复用场景</div>
                        <div className="space-y-1">
                          {learnedSceneKeywords.length ? learnedSceneKeywords.slice(-6).map((item) => (
                            <div key={item} className="rounded bg-slate-950/80 px-1.5 py-1 text-emerald-100/80">{item}</div>
                          )) : <div className="text-slate-600">等待通过反馈</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </div>
            </div>
            <div className={cn("space-y-2", inspectorTab === "trace" ? "" : "hidden")} data-inspector-input-panel="true">
              <div>
              <div className="mb-1 text-micro uppercase text-slate-500">节点输入</div>
              <div className="grid gap-2">
                <div className="rounded border border-cyan-500/20 bg-slate-900/60 p-2" data-node-io-editor="true">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-micro uppercase text-slate-600">可编辑输入 / 提示词</div>
                    <span className="text-micro text-slate-600">{activeNode?.id || "no node"}</span>
                  </div>
                  <textarea
                    className="h-24 w-full resize-none rounded border border-slate-800 bg-slate-950/80 p-2 text-[12px] leading-5 text-slate-300 outline-none focus:border-cyan-500/60"
                    value={activeNode?.body || ""}
                    onChange={(event) => void patchActiveNode({ body: event.target.value }, "node input saved")}
                    disabled={!activeNode || busy}
                    placeholder={activePromptRecord?.sourcePrompt || "填写节点输入、提示词、约束或交接说明"}
                  />
                  <div className="mt-1 grid grid-cols-2 gap-1 text-micro text-slate-600">
                    <span className="truncate">参数：{formatRecord(activeNode?.params ?? {}) || "{}"}</span>
                    <span className="truncate">已保存到工作区节点正文</span>
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/60 p-2" data-inspector-input-source="true">
                  <div className="text-micro uppercase text-slate-600">输入来源</div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[12.5px] text-slate-500">
                    <span className="truncate rounded bg-slate-950/70 px-2 py-1">目标 {workspace?.prompt || prompt ? "已填写" : "空"}</span>
                    <span className="truncate rounded bg-slate-950/70 px-2 py-1">品牌 {activePromptRecord?.brandId || workspace?.activeBrandId || "自动"}</span>
                    <span className="truncate rounded bg-slate-950/70 px-2 py-1">技能 {activePromptRecord?.skillId || activeNode?.skillId || "自动"}</span>
                    <span className="truncate rounded bg-slate-950/70 px-2 py-1">素材 {activeNodeAssets.length}</span>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-micro uppercase text-slate-500">提示词上下文</div>
              <div className="rounded border border-slate-800 bg-slate-900/60 p-2" data-prompt-context-breakdown="true">
                <div className="grid grid-cols-2 gap-1 text-micro text-slate-500">
                  <span className="truncate">提示词ID: {activePromptRecord?.id || "无"}</span>
                  <span className="truncate">品牌: {activePromptRecord?.brandId || workspace?.activeBrandId || "自动"}</span>
                  <span className="truncate">技能: {activePromptRecord?.skillId || activeNode?.skillId || "自动"}</span>
                  <span className="truncate" title={activePromptRecord?.modelId || activeNode?.modelId || "自动模型"}>模型: {displayModelName(activePromptRecord?.modelId || activeNode?.modelId, models)}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    ["目标", activePromptRecord?.workspacePrompt || workspace?.prompt || prompt],
                    ["节点输入", activePromptRecord?.nodePrompt || activeNode?.body || ""],
                    ["有效来源", activePromptRecord?.sourcePrompt || activeNode?.body || workspace?.prompt || prompt],
                    ["最终提示词", activePromptRecord?.finalPrompt || activePromptRecord?.sourcePrompt || activeNode?.body || ""]
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded border border-slate-800 bg-slate-950/60 p-2" data-prompt-context-field={label.toLowerCase().replace(/\s+/g, "-")}>
                      <div className="mb-1 text-micro uppercase text-slate-600">{label}</div>
                      <pre className="max-h-20 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-slate-400">{value || "空"}</pre>
                    </div>
                  ))}
                </div>
                <pre className="mt-2 max-h-16 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/60 p-2 text-[12px] leading-5 text-slate-500">
                  {activePromptRecord?.brandContext || dapot?.context || "未加载品牌上下文"}
                </pre>
              </div>
            </div>
            <div>
              <div className="mb-1 text-micro uppercase text-slate-500">节点素材与日志</div>
              <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                <div className="space-y-1">
                  {activeNodeAssets.length ? activeNodeAssets.map((asset) => (
                    <div key={asset.id} className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-400">
                      {asset.title || asset.id} · {asset.kind || "asset"}
                    </div>
                  )) : <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-500">暂无节点素材</div>}
                </div>
                <div className="mt-2 space-y-1">
                  {activeNodeLogs.length ? activeNodeLogs.map((log) => (
                    <div key={log.id} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] leading-5 text-slate-400">
                      <span className="text-cyan-300">{log.step}</span> · {displayLogMessage(log)}
                      {log.payload && <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap text-slate-600">{formatRecord(log.payload)}</pre>}
                    </div>
                  )) : <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-500">暂无节点日志</div>}
                </div>
              </div>
            </div>
          </div>
          </div>
        </aside>

      <footer className="col-span-2 flex min-h-0 flex-col overflow-hidden border-t border-white/10 bg-slate-950/86 wg-bottom-panel">
          <div className="wg-bottom-commandbar flex h-10 items-center gap-2 border-b border-slate-800 px-2">
            <div className="wg-bottom-tabs flex shrink-0 items-center gap-1" data-bottom-mode-tabs="true">
              {bottomModeTabs.map(({ id, key, label, count }) => (
                <button
                  key={id}
                  className={cn("wg-bottom-tab inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] capitalize", bottomTab === id ? "bg-cyan-300/12 text-cyan-100" : "text-slate-500 hover:text-slate-300")}
                  onClick={() => setBottomTab(id as BottomTab)}
                  data-bottom-mode-tab={key}
                  data-bottom-mode-state={bottomTab === id ? "active" : "idle"}
                  aria-pressed={bottomTab === id}
                  title={`${label}: ${count}`}
                >
                  <span>{label}</span>
                  <span className="wg-bottom-tab-count rounded bg-white/5 px-1 text-[12px] text-slate-500" data-bottom-mode-count="true">{count}</span>
                </button>
              ))}
            </div>
            <div className="wg-node-step-rail flex min-w-0 flex-1 items-center gap-0 overflow-x-auto" data-bottom-node-switcher="true" data-bottom-node-rail-density="fit-seven">
              {plannedNodes.slice(0, 12).map((node, index) => (
                <button
                  key={node.id}
                  className={cn(
                    "wg-node-step-chip flex h-6 shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[12px] transition",
                    node.id === activeNode?.id
                      ? "border-cyan-300/70 bg-cyan-300/12 text-cyan-100"
                      : "border-white/10 bg-black/15 text-slate-500 hover:border-cyan-400/50 hover:text-slate-300"
                  )}
                  onClick={() => activateNode(node.id)}
                  title={`按 ${index + 1} 切换到 ${displayNodeTitle(node)} · ${displayNodeType(node.type)} · ${node.status || "待处理"}`}
                  data-bottom-node-switch={node.id}
                  data-bottom-node-active={node.id === activeNode?.id}
                  data-bottom-node-chip-state={node.id === activeNode?.id ? "active" : "idle"}
                >
                  <span className="wg-node-step-index text-slate-600" data-bottom-node-step="true">{index + 1}</span>
                  <span className="max-w-[58px] truncate" data-bottom-node-title="true">{displayNodeTitle(node)}</span>
                  <span className="sr-only" data-bottom-node-type="true">{displayNodeType(node.type)}</span>
                  <span className={cn("wg-node-step-status h-1.5 w-1.5 rounded-full", node.status === "失败" ? "bg-red-400" : node.status === "成功" ? "bg-emerald-400" : "bg-cyan-300")} data-bottom-node-status="true" data-bottom-node-status-tone={node.status === "失败" ? "failed" : node.status === "成功" ? "done" : "ready"} title={node.status || "待处理"} />
                </button>
              ))}
            </div>
            <div className="wg-bottom-status-strip hidden shrink-0 items-center gap-1 text-micro text-slate-600 xl:flex">
              <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5">节点 {plannedNodes.length}</span>
              <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5">{status}</span>
              <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5" title="/ 输入，1-9 切节点，M 模块，R 运行，F 专注，Esc 恢复">快捷键</span>
            </div>
          </div>
            <div className={cn("wg-bottom-layout grid min-h-0 flex-1 gap-1.5 overflow-hidden p-1.5 text-[12.5px] leading-5", previewExpanded ? "is-preview-expanded" : "is-preview-collapsed")} data-bottom-workbench="true" data-bottom-layout="three-zone" data-bottom-layout-density="production-console" data-bottom-layout-expanded={previewExpanded ? "true" : "false"} data-bottom-layout-priority="preview-and-input">
            <div
              className="wg-goal-composer wg-bottom-zone flex min-h-0 flex-col rounded-md border border-cyan-300/20 bg-[#10181d]/95 p-2"
              onDragEnter={handleGoalComposerDrag}
              onDragOver={handleGoalComposerDrag}
              onDragLeave={(event) => {
                if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as globalThis.Node)) return;
                setIsGoalDragOver(false);
              }}
              onDrop={(event) => void handleGoalComposerDrop(event)}
              data-bottom-goal-composer="true"
              data-bottom-goal-drop-zone="true"
              data-bottom-goal-drag-over={isGoalDragOver ? "true" : "false"}
              data-bottom-goal-density="primary-console"
              data-workbench-primary-input="bottom-goal"
              data-bottom-panel-role="input"
            >
              <div className="wg-current-node-header wg-bottom-zone-header mb-1 flex h-[20px] min-h-[20px] items-center justify-between gap-2 overflow-hidden">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-cyan-100">
                  <Sparkles className="h-4 w-4" />
                  目标命令
                </div>
                <div className="wg-composer-mode-tabs flex shrink-0 items-center gap-0.5 rounded-md border border-white/10 bg-black/22 p-0.5 text-[12px]" data-composer-mode-tabs="true" data-composer-mode={composerMode}>
                  {([
                    { key: "goal", label: "目标", title: "生成或重建完整工作图" },
                    { key: "node", label: "节点", title: "只更新当前绑定节点输入" }
                  ] as const).map(({ key, label, title }) => (
                    <button
                      key={key}
                      className={cn("h-[17px] rounded px-1.5 text-slate-500 transition", composerMode === key && "bg-cyan-300/12 text-cyan-100")}
                      onClick={() => setComposerMode(key)}
                      title={title}
                      aria-label={`切换到底部${label}输入模式`}
                      aria-pressed={composerMode === key}
                      data-composer-mode-option={key}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="hidden shrink-0 items-center gap-1 text-micro text-slate-500 xl:flex">
                  <span>Ctrl/⌘ Enter</span>
                </div>
              </div>
              <div className="wg-goal-binding-strip mb-1 flex h-[18px] min-h-[18px] items-center gap-1.5 overflow-hidden rounded-md border border-white/10 bg-black/18 px-2 text-[12px] leading-none text-slate-500" data-bottom-goal-binding-strip="true" data-bottom-goal-bound-node-id={activeNode?.id || "none"}>
                <span className="shrink-0 text-slate-600" data-bottom-goal-binding-label="true">绑定</span>
                <span className="min-w-0 flex-1 truncate text-cyan-100" title={displayNodeTitle(activeNode)} data-bottom-goal-bound-node="true">{displayNodeTitle(activeNode) || "未选择节点"}</span>
                <span className="hidden shrink-0 rounded border border-white/8 bg-white/5 px-1.5 py-0 text-slate-400 xl:inline" data-bottom-goal-draft-source="true">{composerMode === "node" ? "节点草稿" : "全局目标"}</span>
                <span className="shrink-0 overflow-hidden rounded border border-white/8 bg-white/5 px-1.5 py-0 text-slate-400" data-bottom-goal-bound-type="true">{displayNodeType(activeNode?.type)}</span>
                <span className="shrink-0 overflow-hidden rounded border border-white/8 bg-white/5 px-1.5 py-0 text-slate-400" data-bottom-goal-bound-assets="true">{activeNodeAssets.length} 素材</span>
                <button
                  className="ml-0.5 inline-flex h-3.5 shrink-0 items-center gap-1 rounded border border-cyan-300/25 bg-cyan-300/8 px-1.5 text-cyan-100 hover:border-cyan-300/60"
                  onClick={() => openNodeModule("params")}
                  disabled={!activeNode}
                  title="打开当前节点参数"
                  aria-label="打开当前绑定节点参数"
                  data-bottom-goal-open-bound-node="true"
                >
                  <Settings2 className="h-3 w-3" />
                  <span>参数</span>
                </button>
              </div>
              <textarea
                ref={goalInputRef}
                className="wg-goal-textarea min-h-0 flex-1 resize-none rounded-md border border-white/10 bg-black/30 p-2 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/80"
                value={composerMode === "node" ? nodeComposerDraft : goalComposerDraft}
                onChange={(event) => {
                  if (composerMode === "node") {
                    setNodeComposerDraft(event.target.value);
                    return;
                  }
                  goalComposerDirtyRef.current = true;
                  setGoalComposerDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || busy) return;
                  if (!(event.metaKey || event.ctrlKey)) return;
                  event.preventDefault();
                  void submitComposer();
                }}
                onPaste={(event) => void handleGoalInputPaste(event)}
                placeholder={composerMode === "node" ? "写当前节点要怎么改。Shift+Enter 换行，⌘/Ctrl+Enter 写入节点。" : "写清目标、素材、风格、输出格式和限制条件。Shift+Enter 换行，⌘/Ctrl+Enter 生成流程。"}
                data-bottom-goal-input="true"
                data-bottom-goal-paste-upload="true"
                data-bottom-goal-shortcut="/"
                data-bottom-goal-input-density="command"
                data-composer-input-mode={composerMode}
                data-composer-draft-source={composerMode === "node" ? "active-node" : "workspace-goal"}
              />
              <div className="wg-goal-asset-strip mt-1 flex h-[16px] min-h-[16px] items-center gap-1 overflow-hidden text-micro leading-none text-slate-500" data-bottom-goal-asset-strip="true">
                <span className="shrink-0 text-slate-600">素材</span>
                {activeNodeAssets.length ? activeNodeAssets.slice(0, 3).map((asset) => (
                  <span key={asset.id} className="min-w-0 truncate rounded border border-white/8 bg-black/24 px-1.5 py-0.5 text-slate-300" title={asset.title || asset.id} data-bottom-goal-asset-chip="true">
                    {asset.title || displayShortId(asset.id)}
                  </span>
                )) : (
                  <span className="truncate rounded border border-dashed border-white/10 px-1.5 py-0.5 text-slate-600" data-bottom-goal-asset-empty="true">拖入或粘贴素材</span>
                )}
                {activeNodeAssets.length > 3 && <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-slate-500" data-bottom-goal-asset-more="true">+{activeNodeAssets.length - 3}</span>}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <button
                  className={cn("wg-goal-primary-action wg-loading-action flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md bg-cyan-300 px-3 text-[12px] font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60", busy && "is-loading")}
                  onClick={() => void submitComposer()}
                  disabled={busy}
                  data-bottom-plan-goal-primary="true"
                  data-bottom-goal-primary-action={composerMode === "node" ? "apply-node" : "plan"}
                  data-loading-action={composerMode === "node" ? "apply-node" : "plan-goal"}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {composerMode === "node" ? "写入节点" : "生成工作图"}
                </button>
                <button
                  className="grid h-6 w-6 place-items-center rounded-md border border-white/10 text-slate-300 hover:border-cyan-500/70 disabled:opacity-50 wg-btn-soft"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  title="拖入或上传素材"
                  aria-label="上传素材到目标输入"
                  data-bottom-upload-asset="true"
                >
                  <Upload className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="wg-current-node-card wg-bottom-zone min-h-0 flex flex-col overflow-hidden rounded-md border border-white/10 bg-[#111418]/90 p-1.5" data-bottom-current-node="true" data-bottom-active-node-card="true" data-current-node-console="true" data-current-node-card-density="compact" data-bottom-panel-role="node">
              <div className="wg-current-node-scroll min-h-0 flex-1 overflow-auto pr-0.5">
              <div className="wg-bottom-zone-header mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-slate-100">{displayNodeTitle(activeNode)}</div>
                  <div className="mt-0.5 truncate text-micro text-slate-500">{displayNodeType(activeNode?.type)} · {activeNode?.status || "待处理"}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className="max-w-[76px] truncate rounded border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-micro text-amber-100"
                    title={activeModuleHint}
                    data-current-node-active-module="true"
                  >
                    {activeModuleLabel}
                  </span>
                  <span className="max-w-[86px] truncate rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-micro text-cyan-100" title={activeNode?.modelId || workspace?.activeModelId || "自动模型"}>{displayModelName(activeNode?.modelId || workspace?.activeModelId, models)}</span>
                </div>
              </div>
              <p className="line-clamp-1 min-h-[18px] text-[12px] leading-5 text-slate-400" data-current-node-module-hint="true">{activeModuleHint} · {activeNode?.body || "选择节点后，这里显示当前节点的输入、状态和模型策略。"}</p>
              <div className="wg-current-node-metrics sr-only grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-1 text-[12px] text-slate-500" aria-hidden="true">
                <span data-current-node-stat="model" title={activeNode?.modelId || workspace?.activeModelId || "自动模型"}>{displayModelName(activeNode?.modelId || workspace?.activeModelId, models)}</span>
                <span data-current-node-stat="asset">{(activeNode?.materialIds ?? []).length} 素材</span>
                <span data-current-node-stat="log">{activeNodeLogs.length} 日志</span>
              </div>
              <div className="wg-execution-flow mt-1 grid grid-cols-6 gap-0.5 rounded-md border border-white/10 bg-black/18 px-1 py-0.5" data-execution-flow="true" data-execution-flow-scope="active-node" data-execution-flow-density="quiet">
                {executionFlowSteps.map((step) => (
                  <button
                    key={step.key}
                    className="wg-execution-step min-w-0 rounded px-1 py-0.5 text-left"
                    title={`${step.label}: ${step.value} · ${step.hint}`}
                    data-execution-step={step.key}
                    data-execution-step-state={step.state}
                    onClick={() => {
                      if (step.key === "skill") openNodeModule("skill");
                      else if (step.key === "model") openNodeModule("model");
                      else if (step.key === "asset") openNodeModule("asset");
                      else if (step.key === "feedback") setBottomTab("反馈");
                      else if (step.key === "result") setBottomTab("预览");
                      else openNodeModule("params");
                    }}
                  >
                    <span className="sr-only">{step.label}</span>
                    <span className="block truncate text-[12px] leading-none text-slate-200">{step.value}</span>
                  </button>
                ))}
              </div>
              <div
                className="wg-node-module-shortcuts mt-1 grid grid-cols-4 gap-0.5 text-micro"
                data-bottom-node-module-shortcuts="true"
                data-bottom-node-module-density="icon-pills"
                onPointerDown={(event) => {
                  const button = (event.target as HTMLElement).closest("[data-bottom-node-module]") as HTMLButtonElement | null;
                  const drawer = button?.dataset.bottomNodeModule as Exclude<NodeModuleDrawer, null> | undefined;
                  if (!drawer || button?.disabled) return;
                  event.preventDefault();
                  openNodeModule(drawer);
                }}
              >
                {([
                  { drawer: "params", label: "参数", icon: Settings2 },
                  { drawer: "model", label: "模型", icon: Brain },
                  { drawer: "skill", label: "技能", icon: Wand2 },
                  { drawer: "asset", label: "素材", icon: Image }
                ] as const).map(({ drawer, label, icon: Icon }) => (
                  <button
                    key={drawer}
                    className={cn(
                      "flex h-5 min-w-0 items-center justify-center gap-1 rounded border px-1 text-[12px] transition",
                      nodeModuleDrawer === drawer
                        ? "border-cyan-300/60 bg-cyan-300/12 text-cyan-100"
                        : "border-slate-800 bg-slate-950/70 text-slate-500 hover:border-cyan-500/70 hover:text-slate-200"
                    )}
                    onClick={() => openNodeModule(drawer)}
                    disabled={!activeNode || busy}
                    title={`打开当前节点${label}模块`}
                    data-bottom-node-module={drawer}
                    aria-pressed={nodeModuleDrawer === drawer}
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span className="truncate" data-bottom-node-module-label="true">{label}</span>
                  </button>
                ))}
              </div>
              </div>
              <div
                className="wg-current-node-actions mt-1 flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-slate-950/45 p-1"
                data-current-node-action-bar="true"
              >
                <button
                  className={cn("wg-loading-action flex h-6 flex-1 items-center justify-center gap-1.5 rounded bg-cyan-300 px-2 text-[12px] font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60", busy && "is-loading")}
                  onClick={() => void runNode()}
                  disabled={busy}
                  data-bottom-run-active-node-main="true"
                  data-current-node-primary-action="run"
                  data-loading-action="run-node"
                  title="运行当前选中节点"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  运行
                </button>
                <div className="wg-current-node-toolpack flex shrink-0 items-center gap-0.5" data-current-node-toolpack="true">
                  <button
                    className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70 disabled:opacity-50 wg-btn-soft"
                    onClick={() => void planGoal()}
                    disabled={busy || !activeNode}
                    title="重新生成流程"
                    aria-label="重新生成工作流程"
                    data-bottom-plan-goal="true"
                    data-current-node-secondary-action="plan"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70 disabled:opacity-50 wg-btn-soft"
                    onClick={() => void autoLayoutGraph()}
                    title="自动重排图谱"
                    aria-label="自动重排图谱"
                    disabled={busy || !plannedNodes.length}
                    data-current-node-secondary-action="layout"
                  >
                    <Layers3 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          <div className="wg-preview-panel wg-bottom-zone min-h-0 overflow-auto rounded-md border border-white/10 bg-black/14 p-1.5" data-bottom-preview-panel="true" data-bottom-result-preview="true" data-preview-panel="true" data-preview-panel-density="artifact-first" data-bottom-panel-role="preview">
            {bottomTab === "日志" && (
              <div className="grid gap-1.5">
                {latestLogs.length ? latestLogs.map((log) => (
                  <div key={log.id} className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[12px] text-slate-400">
                    <span className="text-cyan-300">{log.step}</span>
                    <span className="text-slate-600"> · {log.nodeId} · </span>
                    {displayLogMessage(log)}
                  </div>
                )) : (
                  <div className="wg-empty-state wg-empty-state-structured grid h-full min-h-[150px] place-items-center rounded-md border border-dashed border-white/15 bg-black/16 text-center" data-logs-empty-state="true">
                    <div className="max-w-[360px]">
                      <div className="text-[13.5px] font-semibold text-slate-200">等待第一次执行</div>
                      <div className="mt-1 text-[12.5px] leading-5 text-slate-500">生成工作图后，运行当前节点；这里会按时间记录技能、模型、素材和结果写入。</div>
                      <div className="mt-3 grid grid-cols-3 gap-1 text-[12px] text-slate-500">
                        <span className="rounded border border-white/10 bg-black/20 px-2 py-1">计划</span>
                        <span className="rounded border border-white/10 bg-black/20 px-2 py-1">执行</span>
                        <span className="rounded border border-white/10 bg-black/20 px-2 py-1">产物</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {bottomTab === "预览" && (
              <div className="grid h-full min-h-0 grid-cols-1 gap-2" data-preview-workbench="true">
                <div className="wg-current-preview wg-preview-artifact-frame min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[#121417]/90 p-2 text-slate-300" data-current-node-preview="true" data-preview-artifact-frame="true" data-preview-layout="artifact-first" data-preview-fit="no-default-overflow">
                  <div className="wg-bottom-zone-header mb-1 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-slate-100">{displayTextAlias(previewResult?.title) || displayNodeTitle(activeNode) || "当前节点预览"}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-micro text-slate-500" data-preview-artifact-meta="true">
                        <span className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0 text-slate-400" data-preview-artifact-type="true">{previewIsVideo ? "视频" : previewUrl ? "图片" : previewText ? "文本" : isPreviewRunning ? "执行中" : hasPreviewReceipt ? "结果记录" : "待输出"}</span>
                        <span className="min-w-0 truncate" data-preview-artifact-node="true">{displayNodeTitle(activeNode) || "未选择节点"}</span>
                        <span className="shrink-0 text-slate-700">/</span>
                        <span className="min-w-0 truncate" title={previewResult?.id || ""} data-preview-artifact-id="true">{previewResult?.id || "无产物"}</span>
                      </div>
                    </div>
                    <div
                      className="wg-preview-actions flex shrink-0 items-center gap-0.5 rounded-md border border-white/10 bg-slate-950/45 p-0.5"
                      data-preview-action-bar="true"
                      data-preview-action-density="icon-only"
                    >
                      <button
                        className="grid h-6 w-6 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70"
                        onClick={() => setPreviewExpanded(!previewExpanded)}
                        title={previewExpanded ? "收起预览" : "展开预览"}
                        aria-label={previewExpanded ? "收起结果预览" : "展开结果预览"}
                        data-preview-action="expand"
                        aria-pressed={previewExpanded}
                      >
                        {previewExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                      </button>
                      <a
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70",
                          previewUrl ? "" : "pointer-events-none opacity-40"
                        )}
                        href={previewUrl || "#"}
                        target="_blank"
                        rel="noreferrer"
                        title={previewUrl ? "打开结果" : "暂无可打开结果"}
                        aria-label={previewUrl ? "打开结果产物" : "暂无可打开结果"}
                        data-preview-action="open"
                        aria-disabled={!previewUrl}
                      >
                          <FolderOpen className="h-3.5 w-3.5" />
                      </a>
                      <button className="grid h-6 w-6 place-items-center rounded border border-white/10 text-slate-300 hover:border-cyan-500/70 disabled:opacity-50" onClick={() => void copyPreviewText()} disabled={!previewText && !previewUrl} title="复制结果" aria-label="复制结果文本或链接" data-copy-preview-result="true" data-preview-action="copy">
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="wg-preview-source-strip mb-1 flex min-h-[20px] items-center gap-1.5 overflow-hidden rounded-md border border-white/10 bg-black/16 px-2 text-[12px] text-slate-500" data-preview-source-strip="true" data-preview-source-tone={previewSourceTone}>
                    <span className="shrink-0 text-slate-600">来源</span>
                    <span className="shrink-0 rounded border border-cyan-300/20 bg-cyan-300/8 px-1.5 py-0 text-cyan-100" data-preview-source-kind="true">{previewSourceKind}</span>
                    <span className="min-w-0 flex-1 truncate" title={displayNodeTitle(activeNode)} data-preview-source-node="true">{displayNodeTitle(activeNode) || "未选择节点"}</span>
                    <span className="shrink-0 rounded border border-white/8 bg-white/5 px-1.5 py-0 text-slate-400" data-preview-source-result="true">{previewResult?.id || "无结果"}</span>
                  </div>
                  <div className="wg-preview-process-chain mb-1 grid grid-cols-6 gap-1" data-preview-process-chain="true" data-execution-flow="true" data-execution-flow-scope="preview" data-execution-flow-density="receipt">
                    {executionFlowSteps.map((step) => (
                      <button
                        key={step.key}
                        className="wg-execution-step min-w-0 rounded border px-1.5 py-1 text-left"
                        title={`${step.label}: ${step.value} · ${step.hint}`}
                        data-preview-process-step={step.key}
                        data-preview-process-action={step.key === "skill" ? "open-skill" : step.key === "model" ? "open-model" : step.key === "asset" ? "open-asset" : step.key === "result" ? "open-preview" : step.key === "feedback" ? "open-feedback" : "edit-input"}
                        data-execution-step={step.key}
                        data-execution-step-state={step.state}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openPreviewProcessStep(step.key);
                        }}
                      >
                        <span className="block truncate text-micro text-slate-500">{step.label}</span>
                        <span className="block truncate text-[12px] font-semibold text-slate-200">{step.value}</span>
                      </button>
                    ))}
                  </div>
                  {previewUrl ? (
                    <div className="wg-preview-stage mb-1 grid h-[64px] place-items-center overflow-hidden rounded-md border border-white/10 bg-black/35 p-1" data-preview-media-stage="true" data-preview-priority="media-first" data-preview-stage-size="compact">
                      {previewIsVideo ? (
                        <video controls className="h-full max-h-[56px] w-full rounded-md border border-white/10 bg-black object-contain">
                          <source src={previewUrl} type="video/mp4" />
                        </video>
                      ) : (
                        <img src={previewUrl} alt="结果预览" className="h-full max-h-[56px] w-full rounded-md border border-white/10 object-contain" />
                      )}
                    </div>
                  ) : isPreviewRunning ? (
                    <div className="wg-preview-running flex h-[64px] items-center justify-between gap-2 overflow-hidden rounded-md border border-cyan-300/22 bg-cyan-300/8 px-2.5" data-preview-running-state="true" data-preview-priority="media-first" data-preview-stage-size="compact">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-cyan-100">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span className="truncate">正在执行当前节点</span>
                        </div>
                        <div className="mt-0.5 truncate text-[12.5px] leading-5 text-slate-500" data-preview-running-node="true">{displayNodeTitle(activeNode)} / {runningNodeId}</div>
                      </div>
                      <div className="grid shrink-0 grid-cols-3 gap-1 text-center text-[12px]" data-preview-running-steps="true">
                        {["技能", "模型", "产物"].map((label) => (
                          <span key={label} className="rounded border border-cyan-300/18 bg-black/20 px-2 py-1 text-cyan-100">{label}</span>
                        ))}
                      </div>
                    </div>
                  ) : hasPreviewReceipt ? (
                    <div className="wg-preview-receipt flex h-[64px] items-center justify-between gap-2 overflow-hidden rounded-md border border-emerald-300/22 bg-emerald-300/7 px-2.5" data-preview-result-receipt="true" data-preview-priority="media-first" data-preview-stage-size="compact">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-emerald-100">结果记录已生成</div>
                        <div className="mt-0.5 truncate text-[12.5px] leading-5 text-slate-500" data-preview-receipt-id="true">{previewResult?.id}</div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1" data-preview-receipt-next-actions="true">
                          <button className="rounded border border-emerald-300/18 bg-black/20 px-1.5 py-0.5 text-[12px] text-emerald-100 hover:border-emerald-300/60 disabled:opacity-50" onClick={() => fileInputRef.current?.click()} disabled={busy} data-preview-receipt-next-action="upload">上传素材</button>
                          <button className="rounded border border-emerald-300/18 bg-black/20 px-1.5 py-0.5 text-[12px] text-emerald-100 hover:border-emerald-300/60" onClick={() => openNodeModule("asset")} data-preview-receipt-next-action="asset">绑定素材</button>
                          <button className="rounded border border-emerald-300/18 bg-black/20 px-1.5 py-0.5 text-[12px] text-emerald-100 hover:border-emerald-300/60" onClick={() => setBottomTab("反馈")} data-preview-receipt-next-action="feedback">写反馈</button>
                        </div>
                      </div>
                      <div className="grid shrink-0 grid-cols-3 gap-1 text-center text-[12px]" data-preview-receipt-stats="true">
                        <button className="rounded border border-emerald-300/18 bg-black/20 px-2 py-1 text-emerald-100 hover:border-emerald-300/60" onClick={() => openPreviewTraceTarget("node", traceNodeId)} disabled={!traceNodeId} data-preview-receipt-action="node">{previewResult?.status || activeNode?.status || "完成"}</button>
                        <button className="rounded border border-emerald-300/18 bg-black/20 px-2 py-1 text-emerald-100 hover:border-emerald-300/60" onClick={() => openPreviewTraceTarget("logs")} data-preview-receipt-action="logs">{resultLogs.length || activeNodeLogs.length} 日志</button>
                        <button className="rounded border border-emerald-300/18 bg-black/20 px-2 py-1 text-emerald-100 hover:border-emerald-300/60" onClick={() => openPreviewTraceTarget("feedback")} data-preview-receipt-action="feedback">{previewResult?.piSessionId || previewResult?.trace?.piSessionId ? "Pi" : "反馈"}</button>
                      </div>
                    </div>
                  ) : !previewText ? (
                    <div className="wg-empty-state wg-empty-state-structured flex h-[64px] items-center justify-between gap-2 rounded-md border border-dashed border-cyan-300/22 bg-cyan-300/5 px-2.5" data-preview-empty-state="true" data-preview-priority="media-first" data-preview-empty-layout="actionable" data-preview-stage-size="compact">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-slate-200">预览区已就绪</div>
                        <div className="mt-0.5 truncate text-[12.5px] leading-5 text-slate-500">等待节点输出，输出后可复制或打开产物。</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1" data-preview-empty-actions="true">
                        <button
                          type="button"
                          className="inline-flex h-7 items-center gap-1 rounded bg-cyan-300 px-2 text-[12px] font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-60"
                          onClick={() => void runNode()}
                          disabled={busy || !activeNode}
                          data-preview-empty-action="run-node"
                        >
                          <Wand2 className="h-3 w-3" />
                          运行
                        </button>
                        <button
                          type="button"
                          className="grid h-7 w-7 place-items-center rounded border border-cyan-300/24 bg-cyan-300/8 text-cyan-100 hover:border-cyan-300/60 disabled:opacity-60"
                          onClick={() => openNodeModule("asset")}
                          disabled={!activeNode}
                          title="打开素材模块"
                          aria-label="打开素材模块"
                          data-preview-empty-action="open-asset"
                        >
                          <Image className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {previewText && (
                    <pre className="wg-preview-text mt-1 max-h-8 overflow-auto whitespace-pre-wrap rounded-md border border-white/8 bg-black/16 px-2 py-1 text-[12.5px] leading-5 text-slate-300" data-preview-text-result="true" data-preview-text-density="compact" data-preview-summary-line="true">{previewText}</pre>
                  )}
                  {previewGalleryItems.length > 0 && (
                    <div className="wg-preview-gallery mt-1 grid grid-cols-3 gap-1" data-preview-gallery="true" data-preview-gallery-count={previewGalleryItems.length}>
                      {previewGalleryItems.slice(0, 3).map((item) => (
                        <a
                          key={`${item.source}:${item.id}`}
                          className="group grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-1 rounded-md border border-white/10 bg-black/18 p-1 text-left hover:border-cyan-400/60"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          title={item.title}
                          data-preview-gallery-item="true"
                          data-preview-gallery-kind={item.kind}
                        >
                          <span className="grid h-8 w-8 place-items-center overflow-hidden rounded border border-white/10 bg-black/30">
                            {/video|mp4|mov|webm/i.test(item.kind) ? <Film className="h-3.5 w-3.5 text-cyan-100" /> : <img src={item.url} alt={item.title} className="h-full w-full object-cover" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-slate-200">{item.title}</span>
                            <span className="block truncate text-micro text-slate-600">{item.source === "result" ? "结果产物" : "输入素材"}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                  {variantGroup.length > 1 && (
                    <div className="wg-variant-compare mt-1 rounded-md border border-white/10 bg-black/16 p-1" data-variant-compare="true" data-variant-count={variantGroup.length}>
                      <div className="mb-1 flex items-center justify-between text-micro text-slate-500">
                        <span>变体并排 · {variantGroup.length}</span>
                        <span className="truncate text-slate-600">{latestResult?.variantGroupId}</span>
                      </div>
                      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(variantGroup.length, 4)}, minmax(0, 1fr))` }}>
                        {variantGroup.slice(0, 4).map((variant) => (
                          <div
                            key={variant.id}
                            className={cn("min-w-0 rounded border bg-black/24 p-1", variant.variantRole === "primary" ? "border-cyan-400/60" : "border-white/10")}
                            data-variant-item="true"
                            data-variant-index={variant.variantIndex ?? 0}
                            data-variant-role={variant.variantRole || "variant"}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-[12px] font-semibold text-slate-200" title={variant.modelId}>{variant.modelId || "model"}</span>
                              {variant.variantRole === "primary" ? (
                                <span className="shrink-0 rounded bg-cyan-400/15 px-1 text-micro text-cyan-100">主</span>
                              ) : (
                                <button type="button" className="shrink-0 rounded border border-white/10 px-1 text-micro text-slate-300 hover:border-cyan-400/60" data-variant-select="true" onClick={() => void selectVariantAsMain(variant.id)}>选为主</button>
                              )}
                            </div>
                            <pre className="mt-1 max-h-10 overflow-hidden whitespace-pre-wrap text-micro leading-[1.45] text-slate-500">{String(variant.output || variant.输出 || variant.预览 || "").slice(0, 120) || "(预览待生成)"}</pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {resultVersions.length > 0 && (
                    <details className="wg-version-history mt-1 rounded-md border border-white/10 bg-black/16" data-version-history="true" data-version-count={resultVersions.length}>
                      <summary className="cursor-pointer px-2 py-1 text-micro text-slate-400">版本历史 · {resultVersions.length}</summary>
                      <div className="max-h-16 overflow-auto px-1 pb-1">
                        {resultVersions.slice(0, 8).map((entry) => (
                          <div key={entry.version} className="flex items-center justify-between gap-1 border-t border-white/5 px-1 py-0.5 text-micro text-slate-500" data-version-item="true" data-version-number={entry.version}>
                            <span className="truncate">v{entry.version} · {String(entry.createdAt).slice(11, 19)} · {entry.reason}</span>
                            <button type="button" className="shrink-0 rounded border border-white/10 px-1 text-slate-300 hover:border-cyan-400/60" data-version-rollback="true" onClick={() => void rollbackResultToVersion(entry.object?.payload)}>回滚</button>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {previewExpanded && (
                  <details className="wg-preview-trace-drawer mt-1 rounded-md border border-white/10 bg-black/16" data-preview-trace-drawer="true" data-preview-trace-level="secondary" data-preview-trace-default="collapsed">
                    <summary className="flex cursor-pointer items-center justify-between gap-2 px-2 py-0.5 text-[12px] text-slate-500">
                      <span>追踪信息</span>
                      <span className="text-cyan-200">{previewResult?.status || activeNode?.status || "待运行"}</span>
                    </summary>
                    <div className="border-t border-white/8 p-1.5">
                      <div className="mb-1 flex gap-1 overflow-x-auto" data-preview-process-summary="true" data-preview-summary-layout="single-row">
                        {previewProcessSummary.map(({ label, value }) => (
                          <div key={label} className="min-w-[72px] shrink-0 rounded-md border border-white/10 bg-black/18 px-2 py-0.5">
                            <span className="text-[12.5px] uppercase text-slate-600">{label}</span>
                            <span className="ml-1 truncate text-[12.5px] font-medium text-slate-300">{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mb-1 flex gap-1 overflow-x-auto" data-preview-context-chips="true" data-preview-context-layout="secondary">
                        {previewContextChips.slice(0, 5).map(({ label, value, action }) => (
                          <button
                            key={`${label}:${value}`}
                            type="button"
                            className="shrink-0 rounded-md border border-white/10 bg-black/18 px-2 py-0.5 text-left text-[12px] text-slate-400 hover:border-cyan-500/70 hover:text-cyan-100"
                            onClick={() => action && value ? openPreviewTraceTarget(action, value) : undefined}
                            title={`${label}: ${value}`}
                            data-preview-context-chip={label}
                          >
                            <span className="text-slate-600">{label}</span>
                            <span className="ml-1 max-w-[74px] truncate align-bottom text-slate-300">{value}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>
                  )}
                  {previewExpanded && (
                  <details className="mt-2 rounded-md border border-white/10 bg-black/20" data-preview-expanded-trace-context="true">
                    <summary className="cursor-pointer px-2 py-1 text-[12.5px] font-semibold text-cyan-100">追踪 / Pi 上下文</summary>
                    <div className="grid max-h-28 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-auto border-t border-white/10 p-2 text-[12.5px] leading-5 text-slate-400">
                      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1.5" data-pi-session-trace-summary="true">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-cyan-200">Pi 会话</span>
                          <span className="shrink-0 text-slate-500">{piSessionDetail?.status || previewResult?.status || "待处理"}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-1 gap-1">
                          <span className="truncate">ID: {piSessionDetail?.id || previewResult?.piSessionId || previewResult?.trace?.piSessionId || "-"}</span>
                          <span className="truncate">节点: {piSessionDetail?.nodeId || previewResult?.nodeId || previewResult?.trace?.nodeId || activeNode?.id || "-"}</span>
                          <span className="truncate">技能: {piSessionDetail?.skillId || previewResult?.skillId || previewResult?.trace?.skillId || activeNode?.skillId || "-"}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-1" data-预览-trace-links="true">
                        {预览TraceRows.slice(0, 5).map(({ label, value, action }) => {
                          const content = (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-micro uppercase text-slate-600">{label}</span>
                                {action && value && <span className="text-micro text-cyan-400">打开</span>}
                              </div>
                              <div className={cn("truncate", action && value ? "text-cyan-100" : "text-slate-300")}>{value || "-"}</div>
                            </>
                          );
                          return action && value ? (
                            <button
                              key={label}
                              type="button"
                              className="cursor-pointer rounded-md border border-white/10 bg-black/20 px-2 py-1 text-left transition hover:border-cyan-500/70 hover:bg-cyan-500/10 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                              data-预览-trace-action={action}
                              onClick={() => openPreviewTraceTarget(action, value)}
                            >
                              {content}
                            </button>
                          ) : (
                            <div key={label} className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                  )}
                </div>
                <div className="hidden min-h-0 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 text-[12.5px] leading-5 text-slate-400">
                  <div className="mb-2 text-[12px] font-semibold text-cyan-100">追踪</div>
                  <div className="mb-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1.5" data-pi-session-trace-summary="true">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-cyan-200">Pi 会话</span>
                      <span className="shrink-0 text-slate-500">{piSessionDetail?.status || previewResult?.status || "待处理"}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-1 gap-1 text-[12.5px]">
                      <span className="truncate">ID: {piSessionDetail?.id || previewResult?.piSessionId || previewResult?.trace?.piSessionId || "-"}</span>
                      <span className="truncate">节点: {piSessionDetail?.nodeId || previewResult?.nodeId || previewResult?.trace?.nodeId || activeNode?.id || "-"}</span>
                      <span className="truncate">技能: {piSessionDetail?.skillId || previewResult?.skillId || previewResult?.trace?.skillId || activeNode?.skillId || "-"}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-1" data-预览-trace-links="true">
                    {预览TraceRows.slice(0, 8).map(({ label, value, action }) => {
                      const content = (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-micro uppercase text-slate-600">{label}</span>
                            {action && value && <span className="text-micro text-cyan-400">打开</span>}
                          </div>
                          <div className={cn("truncate", action && value ? "text-cyan-100" : "text-slate-300")}>{value || "-"}</div>
                        </>
                      );
                      return action && value ? (
                        <button
                          key={label}
                          type="button"
                          className="cursor-pointer rounded-md border border-white/10 bg-black/20 px-2 py-1 text-left transition hover:border-cyan-500/70 hover:bg-cyan-500/10 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                          data-预览-trace-action={action}
                          onClick={() => openPreviewTraceTarget(action, value)}
                        >
                          {content}
                        </button>
                      ) : (
                        <div key={label} className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
                          {content}
                        </div>
                      );
                    })}
                  </div>
                  <details className="mt-2 rounded-md border border-white/10 bg-black/20" data-预览-prompt-trace="true">
                    <summary className="cursor-pointer px-2 py-1.5 text-[12.5px] font-semibold text-slate-400">提示词追踪</summary>
                    <div className="grid grid-cols-1 gap-1 border-t border-white/10 p-1.5">
                    {[
                      ["工作区", previewPromptRecord?.workspacePrompt || workspace?.prompt || prompt],
                      ["节点输入", previewPromptRecord?.nodePrompt || activeNode?.body || ""],
                      ["生效来源", previewPromptRecord?.sourcePrompt || previewPromptRecord?.nodePrompt || activeNode?.body || workspace?.prompt || prompt],
                      ["最终提示词", previewPromptRecord?.finalPrompt || previewPromptRecord?.sourcePrompt || "暂无提示词记录"]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded bg-black/20 p-2" data-预览-prompt-field={label.toLowerCase().replace(/\s+/g, "-")}>
                        <div className="text-micro uppercase text-slate-600">{label}</div>
                        <pre className="mt-1 max-h-12 overflow-auto whitespace-pre-wrap text-[12.5px] leading-5 text-slate-400">{value || "-"}</pre>
                      </div>
                    ))}
                    </div>
                  </details>
                  <details className="mt-2 rounded-md border border-white/10 bg-black/20" data-pi-session-context-panel="true">
                    <summary className="cursor-pointer px-2 py-1.5 text-[12.5px] font-semibold text-slate-400">Pi 上下文</summary>
                  <div className="border-t border-white/10 p-2">
                    {piSessionDetail ? (
                      <div className="space-y-1">
                        <div className="grid grid-cols-2 gap-1">
                          {[
                            ["会话", piSessionDetail.id],
                            ["执行", piSessionDetail.executionId],
                            ["节点", piSessionDetail.nodeId],
                            ["技能", piSessionDetail.skillId],
                            ["结果", piSessionDetail.resultId],
                            ["提示词", piSessionDetail.promptRecordId]
                          ].map(([label, value]) => (
                            <div key={label} className="truncate rounded bg-slate-900/80 px-2 py-1">
                              <span className="text-slate-600">{label}: </span>{value || "-"}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <div className="truncate rounded bg-slate-900/80 px-2 py-1">来源: {piSessionDetail.input?.piContext?.source || "pi-adapter"}</div>
                          <div className="truncate rounded bg-slate-900/80 px-2 py-1">品牌: {piSessionDetail.input?.brandId || "-"}</div>
                          <div className="truncate rounded bg-slate-900/80 px-2 py-1">技能目录: {piSessionDetail.input?.piContext?.localPaths?.skillDir || "-"}</div>
                          <div className="truncate rounded bg-slate-900/80 px-2 py-1">结果文件: {piSessionDetail.输出?.artifactPaths?.resultJson || "-"}</div>
                        </div>
                        <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded bg-slate-900/80 p-2">{piSessionDetail.输出?.输出 || "暂无 Pi 输出"}</pre>
                      </div>
                    ) : (
                      <div className="text-slate-500">运行节点后从 Pi adapter 读取 session context。</div>
                    )}
                  </div>
                  </details>
                </div>
              </div>
            )}
            {bottomTab === "队列" && (
              <div className="grid min-w-[1100px] grid-cols-4 gap-3" data-queue-dashboard="true">
                <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                  <div className="mb-2 text-micro uppercase text-slate-500">执行队列</div>
                  <div className="space-y-1">
                    {(workspace?.jobs ?? []).length ? (workspace?.jobs ?? []).map((job) => (
                      <div key={job.id} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-slate-400">{job.status} · {job.title}</div>
                    )) : <div className="wg-empty-state rounded border border-slate-800 bg-slate-950/70 px-2 py-2 text-slate-500" data-queue-empty-state="true">队列空闲，下一次运行节点会写入任务记录。</div>}
                  </div>
                  <div className="mt-3 text-micro uppercase text-slate-500">历史</div>
                  <div className="mt-1 space-y-1">
                    {historyEntries.length ? historyEntries.map((entry) => (
                      <div key={entry.id} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[12px] text-slate-400">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-cyan-300">{entry.reason || "手动"}</span>
                          <span className="shrink-0 text-slate-600">{entry.createdAt?.slice(11, 19) || ""}</span>
                        </div>
                        <div className="truncate">{entry.prompt || "无提示词"}</div>
                      </div>
                    )) : <div className="wg-empty-state rounded border border-slate-800 bg-slate-950/70 px-2 py-2 text-slate-500" data-history-empty-state="true">暂无历史，生成或运行后会显示最近操作。</div>}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                  <div className="mb-2 text-micro uppercase text-slate-500">SQLite 存储</div>
                  <div className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[12px] text-slate-500">
                    {sqliteStatus?.storage || "待加载"} · {sqliteStatus?.dbFile || "data/db/workgraph-os.sqlite"}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {Object.entries(sqliteStatus?.rowCounts ?? {}).map(([name, count]) => (
                      <div key={name} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-400">
                        <div className="truncate text-slate-600">{name}</div>
                        <div className="font-semibold text-cyan-200">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                  <div className="mb-2 text-micro uppercase text-slate-500">数据快照</div>
                  <div className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[12px] text-slate-500">
                    {snapshotStatus?.storage?.exists ? "快照已写入" : "快照未写入"} · {snapshotStatus?.storage?.file || "data/workgraph-os-object-snapshots.json"}
                  </div>
                  <div className="mt-2 max-h-36 space-y-1 overflow-auto">
                    {(snapshotStatus?.snapshots ?? []).filter((item) => ["goals", "brands", "assets", "skills", "models", "workflows", "nodes", "results", "feedback", "memory", "prompts", "logs", "db"].includes(item.type)).map((item) => (
                      <div key={item.type} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-400">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-cyan-300">{item.type}</span>
                          <span className={item.exists ? "text-emerald-300" : "text-slate-600"}>{item.exists ? "就绪" : "缺失"}</span>
                        </div>
                        <div className="truncate text-slate-600">{item.indexes.join(", ") || `${item.files.length} 个文件`}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/60 p-2" data-pi-session-list="true">
                  <div className="mb-2 text-micro uppercase text-slate-500">Pi 会话</div>
                  <div className="max-h-40 space-y-1 overflow-auto">
                    {piSessions.length ? piSessions.map((session) => (
                      <div key={session.id} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-[12px] text-slate-400">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-cyan-300">{session.id}</span>
                          <span className="shrink-0 text-slate-600">{session.createdAt?.slice(11, 19) || ""}</span>
                        </div>
                        <div className="truncate">节点: {session.nodeId || "-"} · 结果: {session.resultId || "-"}</div>
                        <div className="truncate text-slate-600">{session.sessionJson || ".pi/sessions"}</div>
                      </div>
                    )) : <div className="wg-empty-state rounded border border-slate-800 bg-slate-950/70 px-2 py-2 text-slate-500" data-pi-session-empty-state="true">暂无 Pi 会话，节点执行后自动关联 session context。</div>}
                  </div>
                </div>
              </div>
            )}
            {bottomTab === "反馈" && (
              <div className="grid min-w-[900px] grid-cols-[minmax(0,1fr)_300px] gap-3" data-feedback-workbench="true">
                <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                  <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] gap-2">
                    <label className="text-[12px] text-slate-500">
                      目标
                      <select
                        className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300 outline-none"
                        value={feedbackTargetValue || (feedbackTargets[0] ? `${feedbackTargets[0].type}:${feedbackTargets[0].id}` : "")}
                        onChange={(event) => setFeedbackTargetValue(event.target.value)}
                      >
                        {feedbackTargets.map((target) => (
                          <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>{target.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[12px] text-slate-500">
                      评分
                      <select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300 outline-none" value={feedbackRating} onChange={(event) => setFeedbackRating(event.target.value as typeof feedbackRating)}>
                        <option value="accepted">通过</option>
                        <option value="needs_revision">需修订</option>
                        <option value="failed">失败</option>
                      </select>
                    </label>
                    <label className="text-[12px] text-slate-500">
                      操作
                      <select className="mt-1 w-full rounded border border-slate-800 bg-slate-950 p-1.5 text-[12px] text-slate-300 outline-none" value={feedbackAction} onChange={(event) => setFeedbackAction(event.target.value as typeof feedbackAction)}>
                        <option value="reuse">复用</option>
                        <option value="revise">重写</option>
                        <option value="avoid">避开</option>
                      </select>
                    </label>
                  </div>
                  <textarea className="mt-2 h-20 w-full resize-none rounded border border-slate-800 bg-slate-950 p-2 text-[12px] text-slate-300 outline-none" value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="truncate text-[12px] text-slate-500">
                      写入反馈会同步记忆、品牌学习、模型策略与素材标签
                    </div>
                    <button className="rounded bg-cyan-400 px-3 py-2 text-[12px] font-semibold text-slate-950 disabled:opacity-50" onClick={() => void recordFeedback()} disabled={busy || !feedbackTargets.length}>
                      写入反馈记忆
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-2" data-feedback-learning-summary="true">
                    <div className="mb-1 text-micro uppercase text-slate-500">学习汇总</div>
                    {lastFeedbackLearning ? (
                      <div className="space-y-1 text-[12px] text-slate-400">
                        <div className="truncate text-cyan-200">{lastFeedbackLearning.feedback?.targetType || "反馈"} · {lastFeedbackLearning.feedback?.id || "已保存"}</div>
                        <div className="truncate">记忆: {lastFeedbackLearning.memory?.id || "已创建"} · 可复用: {String(lastFeedbackLearning.appliedLearning?.memoryReusable ?? lastFeedbackLearning.memory?.reusable ?? false)}</div>
                        <div className="truncate">品牌回避词: {(lastFeedbackLearning.appliedLearning?.brandForbiddenWords ?? []).slice(0, 2).join(" / ") || "-"}</div>
                        <div className="truncate">模型策略: {lastFeedbackLearning.appliedLearning?.modelPolicyId || "-"} · {lastFeedbackLearning.appliedLearning?.modelPolicyStrategy || "-"}</div>
                        <div className="truncate">素材标签: {(lastFeedbackLearning.appliedLearning?.assetTags ?? []).join(", ") || "-"}</div>
                      </div>
                    ) : (
                      <div className="text-[12px] text-slate-500">写入反馈后显示品牌、模型、素材和记忆学习结果。</div>
                    )}
                  </div>
                  <div className="max-h-28 space-y-1 overflow-auto">
                    {latestMemories.map((memory) => (
                      <div key={memory.id} className="rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-slate-400">
                        {displayTextAlias(memory.title) || memory.id}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
        </footer>
      </section>
      </div>

      {skillDrawerOpen && (
        <div className="fixed inset-y-0 right-0 z-20 w-[520px] border-l border-slate-700 bg-slate-950 shadow-2xl" data-skill-drawer="true" data-skill-drawer-open="true">
          <div className="flex h-12 items-center justify-between border-b border-slate-800 px-3">
              <div>
              <div className="text-xs font-semibold">Pi 技能管理</div>
              <div className="text-micro text-slate-500">在线技能搜索：已启用 / 已禁用</div>
            </div>
            <button className="rounded border border-slate-700 px-2 py-1 text-[12px]" onClick={() => setSkillDrawerOpen(false)}>关闭</button>
          </div>
          <div className="grid h-[calc(100%-48px)] grid-cols-[180px_1fr]">
            <div className="border-r border-slate-800 p-2">
              {skills.map((skill) => (
                <button key={skill.id} className="mb-1 block w-full rounded border border-slate-800 bg-slate-900/70 p-2 text-left text-[12px] hover:border-cyan-500" onClick={() => void openSkill(skill.id)}>
                  <div className="truncate font-semibold text-slate-200">{displayTextAlias(skill.title) || skill.id}</div>
                  <div className="truncate text-micro text-slate-500">{skill.version || "草稿"}</div>
                </button>
              ))}
            </div>
            <div className="overflow-auto p-3 text-[12px]">
              {skillDetail ? (
                <div className="space-y-3">
                  {activeNode?.skillId === skillDetail.skill.id && (
                    <div className="rounded border border-cyan-500/30 bg-cyan-400/8 p-2" data-skill-draft-followup="true">
                      <div className="text-[12px] font-semibold uppercase text-cyan-200">节点技能跟进</div>
                      <div className="mt-1 text-[12px] leading-5 text-slate-400">
                        当前技能已绑定到节点 {displayNodeTitle(activeNode)}。检查文件后可直接用下方提示词生成差异，确认后再写入版本。
                      </div>
                    </div>
                  )}
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-100">{displayTextAlias(skillDetail.skill.title)}</div>
                        <div className="text-slate-500">{skillDetail.folder}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button className="rounded border border-slate-700 px-2 py-1 text-[12px] text-slate-300 disabled:opacity-50" onClick={() => void copySkill()} disabled={busy}>
                          复制
                        </button>
                        <button className="rounded bg-cyan-400 px-2 py-1 text-[12px] font-semibold text-slate-950 disabled:opacity-50" onClick={() => void testSkill()} disabled={busy}>
                          测试
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[12px]">
                      {[
                        ["状态", skillDetail.skill.evolution?.status || "草稿"],
                        ["运行", skillDetail.skill.evolution?.runCount ?? 0],
                        ["成功", skillDetail.skill.evolution?.成功Count ?? 0],
                        ["失败", skillDetail.skill.evolution?.failureCount ?? 0]
                      ].map(([label, value]) => (
                        <div key={label} className="rounded border border-slate-800 bg-slate-950/70 px-1 py-1">
                          <div className="text-slate-500">{label}</div>
                          <div className="truncate font-semibold text-cyan-200">{String(value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-[150px_1fr] gap-2">
                    <div className="space-y-1">
                      {skillDetail.files.map((file) => (
                        <button
                          key={file.path}
                          className={cn(
                            "block w-full rounded border px-2 py-1.5 text-left text-[12px]",
                            activeSkillFilePath === file.path ? "border-cyan-400 bg-cyan-400/10 text-cyan-100" : "border-slate-800 bg-slate-900/70 text-slate-400"
                          )}
                          onClick={() => selectSkillFile(file)}
                        >
                          {file.path}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/70 px-2 py-1.5">
                        <span className="font-semibold text-cyan-200">{activeSkillFilePath}</span>
                        <button className="rounded bg-cyan-400 px-2 py-1 text-[12px] font-semibold text-slate-950 disabled:opacity-50" onClick={() => void saveSkillFile()} disabled={busy}>
                          保存文件
                        </button>
                      </div>
                      <textarea
                        className="h-64 w-full resize-none rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[12px] leading-5 text-slate-300 outline-none"
                        value={skillFileDraft}
                        onChange={(event) => setSkillFileDraft(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                    <div className="mb-2 text-micro uppercase text-slate-500">自然语言技能优化</div>
                    <textarea
                      className="h-16 w-full resize-none rounded border border-slate-800 bg-slate-950 p-2 text-[12px] leading-5 text-slate-300 outline-none"
                      value={skillOptimizePrompt}
                      onChange={(event) => setSkillOptimizePrompt(event.target.value)}
                    />
                    <div className="mt-2 flex gap-2">
                      <button className="rounded border border-slate-700 px-2 py-1.5 text-[12px] text-slate-300 disabled:opacity-50" onClick={() => void 预览SkillOptimization()} disabled={busy}>
                        预览差异
                      </button>
                      <button className="rounded bg-cyan-400 px-2 py-1.5 text-[12px] font-semibold text-slate-950 disabled:opacity-50" onClick={() => void applySkillOptimization()} disabled={busy || !skillOptimizePreview}>
                        应用确认
                      </button>
                    </div>
                    {skillOptimizePreview && (
                      <div className="mt-2 rounded border border-slate-800 bg-slate-950">
                        <div className="border-b border-slate-800 px-2 py-1.5 text-cyan-200">{skillOptimizePreview.message}</div>
                        <pre className="max-h-52 overflow-auto whitespace-pre-wrap p-2 font-mono text-[12px] leading-5 text-slate-400">{skillOptimizePreview.diffPreview || skillOptimizePreview.plan?.join("\n")}</pre>
                      </div>
                    )}
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                    <div className="mb-2 text-micro uppercase text-slate-500">技能测试与执行历史</div>
                    {skillTestResult && (
                      <div className="mb-2 rounded border border-slate-800 bg-slate-950/70 p-2">
                        <div className="flex items-center justify-between gap-2 text-cyan-200">
                          <span>{skillTestResult.testId || "本地技能测试"}</span>
                          <span>{skillTestResult.routingDecision?.selectedModelId || "自动模型"}</span>
                        </div>
                        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-slate-400">{skillTestResult.预览 || "未返回预览"}</pre>
                      </div>
                    )}
                    <div className="space-y-1">
                      {(skillDetail.skill.evolution?.history ?? []).slice(0, 6).map((entry, index) => (
                        <div key={String(entry.id ?? index)} className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[12px] text-slate-400">
                          <span className="text-cyan-300">{String(entry.type ?? "event")}</span>
                          {" · "}
                          {String(entry.status ?? "recorded")}
                          {" · "}
                          {String(entry.modelId ?? entry.testId ?? entry.executionId ?? entry.sourceSkillId ?? "")}
                        </div>
                      ))}
                      {!(skillDetail.skill.evolution?.history ?? []).length && <div className="text-slate-500">测试或运行技能后显示执行历史。</div>}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
                    <div className="mb-2 text-micro uppercase text-slate-500">技能版本与日志</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-1 text-[12px] text-slate-500">版本/</div>
                        <div className="max-h-24 space-y-1 overflow-auto">
                          {skillVersionDirs.length ? skillVersionDirs.slice(0, 8).map((entry) => (
                            <div key={entry.path} className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-400">{entry.name}</div>
                          )) : <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-500">暂无版本</div>}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-[12px] text-slate-500">日志/</div>
                        <div className="max-h-24 space-y-1 overflow-auto">
                          {skillLogFiles.length ? skillLogFiles.slice(0, 8).map((entry) => (
                            <div key={entry.path} className="truncate rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-400">{entry.name}</div>
                          )) : <div className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-[12px] text-slate-500">暂无日志</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded border border-slate-800 bg-slate-900/60 p-3 text-slate-500">选择技能后查看 SKILL.md、skill.json、guide、examples。scripts/run.ts 第一阶段只读。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
