import cors from "cors";
import express from "express";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { assetExtFromInput, assetKindFromMime, isPreviewableImageAsset, storeAssetBuffer } from "@sparkcanvas/asset-store";
import { syncBrandRecords } from "@sparkcanvas/brand-store";
import { workGraphCreateSql } from "@sparkcanvas/database";
import { buildWorkGraphFeedbackMemory, learnFromWorkGraphFeedback } from "@sparkcanvas/memory-engine";
import { routeWorkGraphModel, workGraphModelCatalog as buildWorkGraphModelCatalog } from "@sparkcanvas/model-router";
import {
  applyPiSkillOptimization,
  buildPiSkillDetail,
  buildPiExecutionContext,
  ensurePiAdapterSystem,
  ensurePiSkillFiles,
  listPiSessionRecords,
  piSkillFolderName,
  piSkillRelativePath,
  readPiSessionRecord,
  writePiSessionRecord,
  scanPiSkillDir,
  safePiSkillRelativePath,
  appendPiSkillLog,
  listPiWebModels,
  probePiWebBridge,
  resolvePiWebBridgeMode,
  runPiWebSession,
  type PiWebBridgeConfig
} from "@sparkcanvas/pi-adapter";
import { runWorkGraphSkill, evaluateWorkGraphSkillEvolution } from "@sparkcanvas/skill-runtime";
import { planWorkGraphWorkflow, workGraphOutputForPrompt as workflowOutputForPrompt, workGraphPromptTokens as workflowPromptTokens } from "@sparkcanvas/workflow-engine";
import PDFDocument from "pdfkit";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { objectField, objectString, objectStringArray } from "./object-access.js";
import { sqliteSqlValue, sqliteJson } from "./sqlite-literals.js";
import { safeWorkGraphRelativePath } from "./path-utils.js";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync, renameSync, watch as fsWatch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";

const DEMO_TOKEN = "demo-token";
const DEFAULT_DEMO_ACCOUNT = "shift";
const DEFAULT_DEMO_EMAIL = "shift@sparkcanvas.local";
const DEFAULT_DEMO_PASSWORD = "123456";

type Brand = {
  id: string;
  name: string;
  logoText: string;
  primaryColor: string;
  accentColor: string;
  tone: string;
  market: string;
  slogan: string;
  industry: string;
  targetAudience: string;
  brandStory: string;
  ipName: string;
  ipDescription: string;
  logoUsage: string;
  visualStyle: string;
  sceneKeywords: string[];
  forbiddenWords: string[];
  assetRoles: BrandAssetRole[];
  autoInject: boolean;
  active: boolean;
  archived?: boolean;
  updatedAt: string;
};

type BrandAssetRole = {
  role: "logo" | "ip" | "product" | "model" | "storefront" | "environment" | "menu" | "equipment" | "general";
  title: string;
  description: string;
  color?: string;
};

type EntityKind = "brand" | "product" | "asset" | "campaign" | "persona" | "document" | "workspace";

type AttributeValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[]
  | AttributeTree[]
  | AttributeTree;

type AttributeTree = {
  key: string;
  value?: AttributeValue;
  children?: AttributeTree[];
};

type Entity = {
  id: string;
  entityId: string;
  kind: EntityKind;
  entityKind: EntityKind;
  sourceType: "brand";
  sourceId: string;
  title: string;
  status: "active" | "archived";
  updatedAt: string;
  attributes: AttributeTree[];
};

type Asset = {
  id: string;
  title: string;
  type: "upload" | "logo" | "product" | "model" | "generated_image" | "generated_video";
  brandId: string;
  color: string;
  meta: string;
  imageUrl?: string;
  createdAt: string;
};

type CanvasFrame = {
  id: string;
  title: string;
  prompt: string;
  mode: "magic" | "template";
  status: "ready" | "generating" | "success" | "failed";
  x: number;
  y: number;
  w: number;
  h: number;
  cost: number;
  progress: number;
  modelId: string;
  modelName: string;
  settings: GenerationSettings;
  brandId: string;
  brandName: string;
  brandInjected: boolean;
  brandContext: string;
  finalPrompt: string;
  taskId?: string;
  steps: string[];
  workflowNodes: WorkflowNode[];
  outputs: Array<{ id: string; title: string; kind: OutputKind; gradient: string; copy: string; imageUrl?: string; fileUrl?: string; videoId?: string; videoUrl?: string }>;
  createdAt: string;
  updatedAt: string;
};

type OutputKind = "image" | "video" | "document";
type WorkflowOutputTarget = "jpg" | "png" | "poster" | "pdf" | "mp4" | "kit";
type WorkflowOrientation = "square" | "portrait" | "landscape";
const contentLanguageValues = ["auto", "none", "zh", "en", "th", "zh-en", "zh-th", "en-th", "zh-en-th"] as const;
type ContentLanguage = typeof contentLanguageValues[number];

type WorkflowNode = {
  id: string;
  type: "image" | "brand" | "prompt" | "model" | "output" | "reference" | "process" | "script" | "video" | "compose" | "audio";
  title: string;
  body: string;
  parentId?: string;
  inputIds?: string[];
  preview?: string;
  refs?: ReferenceItem[];
  imageUrl?: string;
  fileUrl?: string;
  videoId?: string;
  videoUrl?: string;
  edgeOffsetY?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

type ReferenceItem = {
  id: string;
  role: string;
  title: string;
  description: string;
  color: string;
  imageUrl?: string;
};

type ParsedAssetRef = {
  raw: string;
  symbol: "$";
  type: "image" | "text";
  brandKey: string;
  path: string;
  fullKey: string;
  explicitBrand: boolean;
};

type CalAst = {
  version: "cal/1.0";
  agents: string[];
  commands: string[];
  resources: ParsedAssetRef[];
  lockedTexts: string[];
  tags: string[];
  params: Record<string, string>;
  outputs: string[];
  pipelineSteps: number;
  warnings: string[];
};

type ResolvedPromptAssets = {
  prompt: string;
  imageReferences: ReferenceItem[];
  textReferences: Array<{ key: string; value: string; raw: string }>;
  lockedTexts: string[];
  tags: string[];
  params: Record<string, string>;
  outputs: string[];
  agents: string[];
  commands: string[];
  ast: CalAst;
  warnings: string[];
};

type ResolverResolvedKind = "entity" | "attribute" | "asset" | "text";

type ResolverBinding = {
  sourceRef: string;
  resolved: boolean;
  resolvedKind: ResolverResolvedKind;
  entityId?: string;
  entityKind?: EntityKind;
  brandId?: string;
  brandKey?: string;
  path: string;
  pathSegments: string[];
  title?: string;
  role?: string;
  description?: string;
  value?: string;
  imageUrl?: string;
  warnings: string[];
};

type ResolverGraph = {
  version: "resolver-graph/0.1";
  source: {
    originalPrompt: string;
    normalizedPrompt: string;
    expandedPrompt: string;
    cal: CalAst;
  };
  context: {
    brandId: string;
    brandKey: string;
    brandName: string;
    selection: "explicit" | "inferred" | "none";
    injected: boolean;
  };
  bindings: ResolverBinding[];
  warnings: string[];
};

type CreativeIRIntent = {
  summary: string;
  sourceText: string;
  agents: string[];
  commands: string[];
  tags: string[];
  lockedTexts: string[];
  params: Record<string, string>;
  executionText: string;
};

type CreativeIRContext = {
  brandId: string;
  brandKey: string;
  brandName: string;
  selection: "explicit" | "inferred" | "none";
  injected: boolean;
  brandContext: string;
  visualStyle: string;
  tone: string;
  market: string;
  slogan: string;
  audience: string;
  forbiddenWords: string[];
  sceneKeywords: string[];
};

type CreativeIRBinding = {
  kind: "image" | "text";
  key: string;
  raw: string;
  role?: string;
  title?: string;
  description?: string;
  value?: string;
  imageUrl?: string;
  resolved: boolean;
};

type CreativeIRStyle = {
  visualStyle: string;
  tone: string;
  primaryColor?: string;
  accentColor?: string;
  tags: string[];
  contentLanguage: ContentLanguage | "auto";
  orientation: WorkflowOrientation;
  ratioHint: string;
};

type CreativeIRConstraints = {
  lockedTexts: string[];
  forbiddenWords: string[];
  warnings: string[];
  contentLanguage: string;
  brandConsistency: string[];
};

type CreativeIRFlowStep = {
  id: string;
  title: string;
  detail: string;
};

type CreativeIROutput = {
  targets: string[];
  primary: WorkflowOutputTarget;
  kinds: OutputKind[];
  hints: Array<{
    target: string;
    kind: OutputKind;
    label: string;
  }>;
};

type CreativeIR = {
  version: "creative-ir/0.1";
  source: {
    originalPrompt: string;
    normalizedPrompt: string;
    expandedPrompt: string;
    cal: CalAst;
  };
  intent: CreativeIRIntent;
  context: CreativeIRContext;
  bindings: {
    assets: CreativeIRBinding[];
    references: CreativeIRBinding[];
  };
  style: CreativeIRStyle;
  constraints: CreativeIRConstraints;
  flow: CreativeIRFlowStep[];
  output: CreativeIROutput;
  warnings: string[];
};

type PlannerStage = "intent" | "context" | "references" | "generation" | "output";

type PlannerStep = {
  id: string;
  stage: PlannerStage;
  title: string;
  detail: string;
  dependsOn: string[];
  inputs: string[];
  outputs: string[];
  bindings: string[];
};

type PlannerPlan = {
  version: "planner-plan/0.1";
  source: {
    prompt: string;
    irVersion: CreativeIR["version"];
  };
  summary: string;
  context: {
    brandId: string;
    brandName: string;
    selection: CreativeIRContext["selection"];
    injected: boolean;
    primaryOutput: WorkflowOutputTarget;
    outputKinds: OutputKind[];
  };
  steps: PlannerStep[];
  warnings: string[];
};

type CanvasPlanNode = {
  id: string;
  type: "intent" | "context" | "reference" | "generation" | "output";
  title: string;
  body: string;
  stepId: string;
  stage: PlannerStage;
  x: number;
  y: number;
  w: number;
  h: number;
  inputIds?: string[];
};

type CanvasPlanEdge = {
  id: string;
  from: string;
  to: string;
};

type CanvasPlanGraph = {
  version: "canvas-plan/0.1";
  planVersion: PlannerPlan["version"];
  summary: string;
  nodes: CanvasPlanNode[];
  edges: CanvasPlanEdge[];
  warnings: string[];
};

type GenerationSettings = {
  ratio: string;
  width: number;
  height: number;
  count: number;
  quality: "standard" | "hd" | "ultra";
  strength: number;
  duration: number;
  brandInject: boolean;
  contentLanguage: ContentLanguage;
};

type GenerationTask = {
  id: string;
  frameId: string;
  prompt: string;
  finalPrompt: string;
  brandId: string;
  brandName: string;
  brandInjected: boolean;
  brandContext: string;
  status: "queued" | "routing" | "generating" | "completed" | "failed";
  progress: number;
  creditsCost: number;
  workflow: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type AuthProvider = "email" | "google";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  username?: string;
  plan: string;
  credits: number;
  provider: AuthProvider;
  passwordHash?: string;
  googleSub?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

type AuthSession = {
  token: string;
  userId: string;
  kind: "login" | "register" | "google";
  createdAt: string;
  lastSeenAt: string;
};

type PublicUser = Pick<AuthUser, "id" | "name" | "email" | "plan" | "credits" | "provider" | "avatarUrl"> & {
  username?: string;
};

type Db = {
  user?: {
    id: string;
    name: string;
    email: string;
    plan: string;
    credits: number;
  };
  users: AuthUser[];
  sessions: AuthSession[];
  brands: Brand[];
  assets: Asset[];
  frames: CanvasFrame[];
  tasks: GenerationTask[];
};

type WorkGraphOsWorkspace = {
  version: 1;
  goal?: unknown;
  workflow?: unknown;
  materials: unknown[];
  skills: unknown[];
  nodes: unknown[];
  activeBrandId: string;
  activeModelId: string;
  activeNodeId?: string;
  selectedIds: string[];
  prompt: string;
  activeMaterialId: string;
  jobs: unknown[];
  results: unknown[];
  promptRecords?: unknown[];
  modelPolicies?: unknown[];
  feedback: unknown[];
  memories: unknown[];
  executionLog: unknown[];
  updatedAt: string;
};

type WorkGraphOsObjectType = "goal" | "asset" | "brand" | "skill" | "model" | "model_policy" | "workflow" | "node" | "result" | "prompt" | "feedback" | "memory";

type WorkGraphOsObject = {
  id: string;
  type: WorkGraphOsObjectType;
  title: string;
  summary: string;
  source: "workspace" | "derived";
  updatedAt: string;
  payload: unknown;
};

type WorkGraphOsHistoryEntry = {
  id: string;
  createdAt: string;
  reason: "workspace-save" | "manual";
  prompt: string;
  counts: Record<string, number>;
  objectIds: string[];
  objects: WorkGraphOsObject[];
};

type WorkGraphOsEdge = {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  relation: "uses_brand" | "uses_model" | "uses_asset" | "uses_skill" | "uses_node" | "uses_prompt" | "produces_result" | "comments_on" | "remembers";
  updatedAt: string;
  payload: unknown;
};

type WorkGraphOsExecution = {
  id: string;
  mode: "workflow" | "node";
  nodeId: string;
  nodeTitle: string;
  workflowId: string;
  modelId: string;
  skillId: string;
  jobId: string;
  resultId: string;
  status: string;
  executor: "workgraph-os-backend" | "workgraph-skill-runtime" | "pi-web";
  simulated: boolean;
  bridge: WorkGraphOsBridgeInfo;
  createdAt: string;
};

type WorkGraphOsBridgeInfo = {
  mode: "pi-web" | "simulated";
  reachable: boolean;
  baseUrl: string;
  reason: string;
  piSessionId: string;
};

type WorkGraphOsRoutingDecision = {
  id: string;
  nodeId: string;
  nodeType: string;
  strategy: string;
  requestedModelId: string;
  selectedModelId: string;
  selectedCapability: "image" | "video" | "text" | "local";
  fallbackModelIds: string[];
  route: string;
  reason: string;
  createdAt: string;
};

type WorkGraphOsSkillFileTree = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: WorkGraphOsSkillFileTree[];
};

type WorkGraphOsSkillFile = {
  path: string;
  content: string;
};

type WorkGraphOsSqliteTable = {
  name: string;
  createSql: string;
  rows: Array<Record<string, unknown>>;
};

type WorkGraphOsSqliteExport = {
  dialect: "sqlite";
  generatedAt: string;
  migrationMode: "native-sqlite-sync" | "json-export";
  dbFile?: string;
  tables: WorkGraphOsSqliteTable[];
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      authSession?: AuthSession;
      authToken?: string;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const dataFile = process.env.SPARKCANVAS_DATA_FILE ?? path.join(dataDir, "sparkcanvas.json");
const workGraphOsDataFile = process.env.WORKGRAPH_OS_DATA_FILE ?? path.join(dataDir, "workgraph-os.json");
const workGraphOsHistoryFile = process.env.WORKGRAPH_OS_HISTORY_FILE ?? path.join(dataDir, "workgraph-os-history.json");
const projectRoot = path.resolve(__dirname, "../..");
const workGraphOsDbFile = process.env.WORKGRAPH_OS_DB_FILE ?? path.join(projectRoot, "data", "db", "workgraph-os.sqlite");
// Opt-in: serve the object index from SQLite (query source) instead of the JSON
// index. Default off so the JSON path stays authoritative and zero-regression.
const workGraphOsSqliteReadEnabled = (process.env.WGOS_SQLITE_READ ?? "off").trim().toLowerCase() === "on";
const workGraphOsBaseDataDir = path.dirname(workGraphOsDataFile);
const workGraphOsPiDir = process.env.WORKGRAPH_OS_PI_DIR ?? path.join(projectRoot, ".pi");
const workGraphOsGoalDataDir = process.env.WORKGRAPH_OS_GOAL_DIR ?? path.join(workGraphOsBaseDataDir, "goals");
const workGraphOsSkillDataDir = process.env.WORKGRAPH_OS_SKILL_DIR ?? path.join(projectRoot, "data", "skills");
const workGraphOsAssetDataDir = process.env.WORKGRAPH_OS_ASSET_DIR ?? path.join(projectRoot, "data", "assets");
const workGraphOsBrandDataDir = process.env.WORKGRAPH_OS_BRAND_DIR ?? path.join(projectRoot, "data", "brands");
const workGraphOsResultDataDir = process.env.WORKGRAPH_OS_RESULT_DIR ?? path.join(projectRoot, "data", "results");
const workGraphOsOutputDataDir = process.env.WORKGRAPH_OS_OUTPUT_DIR ?? path.join(projectRoot, "data", "outputs");
const workGraphOsOutputWatchDir = process.env.WGOS_OUTPUT_WATCH_DIR ?? workGraphOsOutputDataDir;
const workGraphOsOutputWatchEnabled = (process.env.WGOS_OUTPUT_WATCH ?? "on").trim().toLowerCase() !== "off";

// Directories the output watcher monitors so generated media flows back as Assets.
// Includes the configured output dir and the real pi-web working dir (where the
// agent writes outputs), but never the repo root — watching the whole project
// recursively would register every source file as an asset.
function workGraphOsWatchDirs() {
  const dirs = new Set([path.resolve(workGraphOsOutputWatchDir)]);
  const piWebCwd = process.env.WGOS_PIWEB_CWD;
  if (piWebCwd && path.resolve(piWebCwd) !== path.resolve(projectRoot)) {
    dirs.add(path.resolve(piWebCwd));
  }
  return [...dirs];
}
const workGraphOsLogDataDir = process.env.WORKGRAPH_OS_LOG_DIR ?? path.join(projectRoot, "data", "logs");
const workGraphOsWorkflowDataDir = process.env.WORKGRAPH_OS_WORKFLOW_DIR ?? path.join(projectRoot, "data", "workflows");
const workGraphOsNodeDataDir = process.env.WORKGRAPH_OS_NODE_DIR ?? path.join(projectRoot, "data", "nodes");
const workGraphOsPromptDataDir = process.env.WORKGRAPH_OS_PROMPT_DIR ?? path.join(projectRoot, "data", "prompts");
const workGraphOsFeedbackDataDir = process.env.WORKGRAPH_OS_FEEDBACK_DIR ?? path.join(projectRoot, "data", "feedback");
const workGraphOsMemoryDataDir = process.env.WORKGRAPH_OS_MEMORY_DIR ?? path.join(projectRoot, "data", "memory");
const workGraphOsModelDataDir = process.env.WORKGRAPH_OS_MODEL_DIR ?? path.join(projectRoot, "data", "models");
const workGraphOsSnapshotFile = process.env.WORKGRAPH_OS_SNAPSHOT_FILE ?? path.join(workGraphOsBaseDataDir, "workgraph-os-object-snapshots.json");
const frontendPublicDir = path.join(projectRoot, "frontend", "public");
const generatedDir = process.env.SPARKCANVAS_GENERATED_DIR ?? path.join(frontendPublicDir, "generated");
const brandUploadDir = path.join(generatedDir, "brand-assets");
const defaultVideoGenBaseUrl = "https://api.yijiarj.cn/v1";
const defaultVdamoBaseUrl = "https://api.vdamo.com/v1";
const isProduction = process.env.NODE_ENV === "production";
const demoAuthEnabled = !isProduction || process.env.SPARKCANVAS_DEMO_AUTH === "true";
const authToken = process.env.SPARKCANVAS_AUTH_TOKEN || (demoAuthEnabled ? DEMO_TOKEN : "");
const adminAccount = process.env.SPARKCANVAS_ADMIN_ACCOUNT;
const adminPassword = process.env.SPARKCANVAS_ADMIN_PASSWORD;
const registrationEnabled = !isProduction || process.env.SPARKCANVAS_REGISTRATION_ENABLED === "true" || localAuthValue("SPARKCANVAS_REGISTRATION_ENABLED") === "true";
const defaultImageModelId = process.env.SPARKCANVAS_DEFAULT_IMAGE_MODEL_ID || localAuthValue("SPARKCANVAS_DEFAULT_IMAGE_MODEL_ID");
const allowedOrigins = (process.env.SPARKCANVAS_ALLOWED_ORIGINS || (isProduction ? "https://xmanx.com,https://www.xmanx.com" : ""))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const templates = [
  { id: "tpl_amazon", title: "Amazon 主图", category: "电商", cost: 8, ratio: "1:1", intent: "white background product hero with logo-safe margin" },
  { id: "tpl_xhs", title: "小红书种草", category: "社媒", cost: 12, ratio: "3:4", intent: "lifestyle poster with product benefits and warm scene" },
  { id: "tpl_video", title: "15 秒带货视频", category: "视频", cost: 36, ratio: "9:16", intent: "short product video storyboard with model and brand ending card" },
  { id: "tpl_batch", title: "批量换背景", category: "效率", cost: 18, ratio: "multi", intent: "remove background and generate three campaign scenes" },
  { id: "tpl_brandkit", title: "品牌套装维护", category: "品牌", cost: 10, ratio: "kit", intent: "refresh brand system with logo lockup, color cards, campaign copy and reusable scenes" }
];

const models = orderModelsByDefault([
  { id: "vdamo-gpt-image-2", provider: "vdamo-openai", group: "openai", model: "gpt-image-2", name: "VDAMO · GPT Image 2", type: "image", costMultiplier: 1, reasoningEffort: "high", route: "/v1/images/generations", description: "默认图片模型；VDAMO OpenAI 分组；/v1/images/generations；已通过真实 PNG 出图测试" },
  { id: "vdamo-gpt-image-1-5", provider: "vdamo-openai", group: "openai", model: "gpt-image-1.5", name: "VDAMO · GPT Image 1.5", type: "image", costMultiplier: 1, reasoningEffort: "high", route: "/v1/images/generations", description: "VDAMO OpenAI 分组图片模型；已通过真实 PNG 出图测试，可作为 gpt-image-2 回退候选" },
  { id: "vdamo-gpt-image-1", provider: "vdamo-openai", group: "openai", model: "gpt-image-1", name: "VDAMO · GPT Image 1", type: "image", costMultiplier: 1, reasoningEffort: "high", route: "/v1/images/generations", description: "VDAMO OpenAI 分组图片模型；已通过真实 PNG 出图测试" },
  { id: "vdamo-gemini-3-1-flash-image", provider: "vdamo-google", group: "google", model: "gemini-3.1-flash-image", name: "VDAMO · Gemini 3.1 Flash Image", type: "image", costMultiplier: 1, reasoningEffort: "medium", enabled: false, availability: "probe_failed", route: "/v1/responses", description: "VDAMO Google 分组列出该图片模型，但当前探测未返回可用图片，暂不开放生产选择" },
  { id: "vdamo-gemini-2-5-flash-image", provider: "vdamo-google", group: "google", model: "gemini-2.5-flash-image", name: "VDAMO · Gemini 2.5 Flash Image", type: "image", costMultiplier: 1, reasoningEffort: "medium", enabled: false, availability: "probe_failed", route: "/v1/responses", description: "VDAMO Google 分组列出该图片模型，但当前探测返回账号不可用/接口不可用，暂不开放生产选择" },
  { id: "vdamo-gpt-5-4-mini", provider: "vdamo-openai", group: "openai", model: "gpt-5.4-mini", name: "VDAMO · GPT 5.4 Mini", type: "text", costMultiplier: 1, reasoningEffort: "medium", route: "/v1/chat/completions", description: "默认文本/脚本优化模型；VDAMO OpenAI 分组；已通过 OK 探测" },
  { id: "vdamo-gpt-5-4", provider: "vdamo-openai", group: "openai", model: "gpt-5.4", name: "VDAMO · GPT 5.4", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO OpenAI 分组文本模型" },
  { id: "vdamo-gpt-5-5", provider: "vdamo-openai", group: "openai", model: "gpt-5.5", name: "VDAMO · GPT 5.5", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO OpenAI 分组高阶文本模型" },
  { id: "vdamo-gpt-5-3-codex", provider: "vdamo-openai", group: "openai", model: "gpt-5.3-codex", name: "VDAMO · GPT 5.3 Codex", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO OpenAI 分组代码/工作流文本模型" },
  { id: "vdamo-gpt-5-3-codex-spark", provider: "vdamo-openai", group: "openai", model: "gpt-5.3-codex-spark", name: "VDAMO · GPT 5.3 Codex Spark", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO OpenAI 分组代码/工作流文本模型" },
  { id: "vdamo-gpt-5-2", provider: "vdamo-openai", group: "openai", model: "gpt-5.2", name: "VDAMO · GPT 5.2", type: "text", costMultiplier: 1, reasoningEffort: "medium", route: "/v1/chat/completions", description: "VDAMO OpenAI 分组文本模型" },
  { id: "vdamo-gemini-2-5-flash", provider: "vdamo-google", group: "google", model: "gemini-2.5-flash", name: "VDAMO · Gemini 2.5 Flash", type: "text", costMultiplier: 1, reasoningEffort: "medium", route: "/v1/chat/completions", description: "VDAMO Google 分组文本模型；已通过 OK 探测" },
  { id: "vdamo-gemini-2-0-flash", provider: "vdamo-google", group: "google", model: "gemini-2.0-flash", name: "VDAMO · Gemini 2.0 Flash", type: "text", costMultiplier: 1, reasoningEffort: "medium", route: "/v1/chat/completions", description: "VDAMO Google 分组文本模型" },
  { id: "vdamo-gemini-2-5-pro", provider: "vdamo-google", group: "google", model: "gemini-2.5-pro", name: "VDAMO · Gemini 2.5 Pro", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO Google 分组文本模型" },
  { id: "vdamo-gemini-3-5-flash", provider: "vdamo-google", group: "google", model: "gemini-3.5-flash", name: "VDAMO · Gemini 3.5 Flash", type: "text", costMultiplier: 1, reasoningEffort: "medium", route: "/v1/chat/completions", description: "VDAMO Google 分组文本模型" },
  { id: "vdamo-gemini-3-flash-preview", provider: "vdamo-google", group: "google", model: "gemini-3-flash-preview", name: "VDAMO · Gemini 3 Flash Preview", type: "text", costMultiplier: 1, reasoningEffort: "medium", route: "/v1/chat/completions", description: "VDAMO Google 分组预览文本模型" },
  { id: "vdamo-gemini-3-pro-preview", provider: "vdamo-google", group: "google", model: "gemini-3-pro-preview", name: "VDAMO · Gemini 3 Pro Preview", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO Google 分组预览文本模型" },
  { id: "vdamo-gemini-3-1-pro-preview", provider: "vdamo-google", group: "google", model: "gemini-3.1-pro-preview", name: "VDAMO · Gemini 3.1 Pro Preview", type: "text", costMultiplier: 1, reasoningEffort: "high", route: "/v1/chat/completions", description: "VDAMO Google 分组预览文本模型" },
  { id: "yijiarj-grok-video-super", provider: "yijiarj", model: "grok-imagine-1.0-video-super", name: "yijiarj · grok video super", type: "video", costMultiplier: 4, unitCostCny: 0.38, reasoningEffort: "medium", description: "最低成本视频模型；yijiarj /v1/videos；付费生成默认禁用，必须显式设置 SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1；参考图必须传 input_reference 链接；竖屏用 size=720x1280；约 ¥0.38/次，模型池可能临时无可用账号" },
  { id: "yijiarj-grok-video-720p", provider: "yijiarj", model: "grok-imagine-1.0-video-super-720p", name: "yijiarj · grok video 720p", type: "video", costMultiplier: 4, unitCostCny: 0.58, reasoningEffort: "medium", description: "yijiarj /v1/videos；付费生成默认禁用，必须显式设置 SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1；参考图必须传 input_reference 链接；竖屏用 size=720x1280；约 ¥0.58/次" },
  { id: "yijiarj-veo-3-1-fast", provider: "yijiarj", model: "veo_3_1-fast", name: "yijiarj · veo_3_1-fast", type: "video", costMultiplier: 4, unitCostCny: 0.437, reasoningEffort: "medium", description: "VEO 文生/图生；付费生成默认禁用，必须显式设置 SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1；传图时 ad 分组只支持横屏，自动使用 size=1920x1080；链接约 6 小时过期，完成后需下载本地；约 ¥0.437/次" },
  { id: "yijiarj-veo-3-1-fast-fl", provider: "yijiarj", model: "veo_3_1-fast-fl", name: "yijiarj · veo_3_1-fast-fl", type: "video", costMultiplier: 4, reasoningEffort: "medium", description: "VEO 首尾帧模型；付费生成默认禁用，必须显式设置 SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1；不支持纯文生，必须传 input_reference，支持多图用 | 分隔" }
]);

function orderModelsByDefault<T extends { id: string; type: string; enabled?: boolean }>(items: T[]) {
  if (!defaultImageModelId) return items;
  const preferred = items.find((item) => item.id === defaultImageModelId && item.type === "image" && item.enabled !== false);
  if (!preferred) return items;
  return [preferred, ...items.filter((item) => item.id !== preferred.id)];
}

function providerGroupForModel(modelName?: string) {
  const normalized = String(modelName ?? "").toLowerCase();
  return normalized.startsWith("gemini-") ? "google" : "openai";
}

function providerForModel(modelName?: string) {
  return providerGroupForModel(modelName) === "google" ? "vdamo-google" : "vdamo-openai";
}

function publicModels() {
  return models.filter((item) => item.enabled !== false);
}

function findModelById(modelId?: string) {
  return publicModels().find((item) => item.id === modelId);
}

function defaultImageModel() {
  return publicModels().find((item) => item.type === "image") ?? models[0];
}

function defaultTextModel() {
  return publicModels().find((item) => item.type === "text")?.model ?? "gpt-5.4-mini";
}

function openAiCompatibleBaseUrl(value: string, defaultBaseUrl = defaultVdamoBaseUrl) {
  const normalized = (value || defaultBaseUrl)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|images\/generations|responses|models)$/i, "");
  return /\/v\d+(?:beta)?$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

const assetRoleSchema = z.object({
  role: z.enum(["logo", "ip", "product", "model", "storefront", "environment", "menu", "equipment", "general"]),
  title: z.string().min(1),
  description: z.string().min(1),
  color: z.string().optional()
});
const contentLanguageSchema = z.enum(contentLanguageValues);

const generationSettingsPatchSchema = z.object({
  ratio: z.string().optional(),
  width: z.number().min(256).max(4096).optional(),
  height: z.number().min(256).max(4096).optional(),
  count: z.number().min(1).max(6).optional(),
  quality: z.enum(["standard", "hd", "ultra"]).optional(),
  strength: z.number().min(0).max(100).optional(),
  duration: z.number().min(0).max(60).optional(),
  brandInject: z.boolean().optional(),
  contentLanguage: contentLanguageSchema.optional()
});

const brandDetailSchema = z.object({
  name: z.string().min(1).optional(),
  logoText: z.string().min(1).max(8).optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  tone: z.string().optional(),
  market: z.string().optional(),
  slogan: z.string().optional(),
  industry: z.string().optional(),
  targetAudience: z.string().optional(),
  brandStory: z.string().optional(),
  ipName: z.string().optional(),
  ipDescription: z.string().optional(),
  logoUsage: z.string().optional(),
  visualStyle: z.string().optional(),
  sceneKeywords: z.array(z.string()).optional(),
  forbiddenWords: z.array(z.string()).optional(),
  assetRoles: z.array(assetRoleSchema).optional(),
  autoInject: z.boolean().optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional()
});

const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "brand", "prompt", "model", "output", "reference", "process", "script", "video", "compose", "audio"]),
  title: z.string().min(1),
  body: z.string(),
  parentId: z.string().optional(),
  inputIds: z.array(z.string()).optional(),
  preview: z.string().optional(),
  imageUrl: z.string().optional(),
  fileUrl: z.string().optional(),
  videoId: z.string().optional(),
  videoUrl: z.string().optional(),
  edgeOffsetY: z.number().optional(),
  refs: z.array(z.object({
    id: z.string(),
    role: z.string(),
    title: z.string(),
    description: z.string(),
    color: z.string(),
    imageUrl: z.string().optional()
  })).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional()
});

const outputSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  kind: z.enum(["image", "video", "document"]),
  gradient: z.string(),
  copy: z.string(),
  imageUrl: z.string().optional(),
  fileUrl: z.string().optional(),
  videoId: z.string().optional(),
  videoUrl: z.string().optional()
});

const workGraphOsWorkspaceSchema = z.object({
  version: z.literal(1),
  goal: z.unknown().optional(),
  workflow: z.unknown().optional(),
  materials: z.array(z.unknown()).default([]),
  skills: z.array(z.unknown()).default([]),
  nodes: z.array(z.unknown()).default([]),
  activeBrandId: z.string().default("dapot"),
  activeModelId: z.string().default("imgen"),
  activeNodeId: z.string().default(""),
  selectedIds: z.array(z.string()).default([]),
  prompt: z.string().default(""),
  activeMaterialId: z.string().default(""),
  jobs: z.array(z.unknown()).default([]),
  results: z.array(z.unknown()).default([]),
  promptRecords: z.array(z.unknown()).default([]),
  modelPolicies: z.array(z.unknown()).default([]),
  feedback: z.array(z.unknown()).default([]),
  memories: z.array(z.unknown()).default([]),
  executionLog: z.array(z.unknown()).default([]),
  updatedAt: z.string().default(now)
});

const workGraphOsRunSchema = z.object({
  nodeId: z.string().optional(),
  mode: z.enum(["workflow", "node"]).default("node"),
  note: z.string().optional(),
  // Per-run pi-web bridge override. Defaults to the server WGOS_PIWEB_ENABLED
  // mode; "off" forces a simulated, no-cost run (used by smoke and preview-only).
  bridge: z.enum(["auto", "on", "off"]).optional(),
  // Number of output variants to produce for side-by-side comparison (1-4).
  variants: z.number().int().min(1).max(4).optional()
});

const workGraphOsPlanSchema = z.object({
  prompt: z.string().optional(),
  brandId: z.string().optional(),
  activeModelId: z.string().optional(),
  selectedIds: z.array(z.string()).optional()
});

const workGraphOsFeedbackSchema = z.object({
  id: z.string().optional(),
  targetId: z.string().min(1),
  targetType: z.enum(["workflow", "skill", "result", "model", "brand", "node", "asset"]),
  rating: z.enum(["accepted", "needs_revision", "failed"]).default("needs_revision"),
  action: z.enum(["reuse", "revise", "avoid"]).optional(),
  note: z.string().min(1),
  memoryId: z.string().optional(),
  sourceResultId: z.string().optional(),
  sourceWorkflowId: z.string().optional(),
  brandId: z.string().optional()
});

const workGraphOsSkillInputSchema = z.object({
  title: z.string().min(1),
  command: z.string().min(1),
  output: z.string().default("PNG"),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  capabilityType: z.string().optional(),
  runtime: z.string().optional(),
  skillMdPath: z.string().optional()
});

const workGraphOsSkillOptimizeSchema = z.object({
  prompt: z.string().min(1),
  files: z.array(z.string()).optional()
});

const workGraphOsSkillOptimizeApplySchema = z.object({
  prompt: z.string().min(1)
});

const workGraphOsSkillCopySchema = z.object({
  title: z.string().optional(),
  command: z.string().optional()
});

const workGraphOsSkillTestSchema = z.object({
  prompt: z.string().optional(),
  nodeId: z.string().optional()
});

const workGraphOsSkillFileSaveSchema = z.object({
  path: z.enum(["SKILL.md", "skill.json", "resources/guide.md", "examples/input.json", "examples/output.json"]),
  content: z.string(),
  reason: z.string().optional()
});

let db: Db = undefined as unknown as Db;
let persistDbQueue = Promise.resolve();
const runningTimers = new Map<string, NodeJS.Timeout>();
const autoCoreNodeIds = new Set(["input-image", "brand", "prompt", "output", "model"]);

function now() {
  return new Date().toISOString();
}

function workGraphPiAdapterConfig() {
  return {
    piDir: workGraphOsPiDir,
    skillDataDir: workGraphOsSkillDataDir,
    now
  };
}

function workGraphPiWebConfig(): PiWebBridgeConfig {
  return {
    baseUrl: process.env.WGOS_PIWEB_BASE_URL ?? "http://localhost:30141",
    mode: resolvePiWebBridgeMode(process.env.WGOS_PIWEB_ENABLED),
    timeoutMs: Number(process.env.WGOS_PIWEB_TIMEOUT_MS ?? 120000) || 120000,
    cwd: process.env.WGOS_PIWEB_CWD ?? projectRoot,
    provider: process.env.WGOS_PIWEB_PROVIDER || undefined,
    modelId: process.env.WGOS_PIWEB_MODEL || undefined
  };
}

function isEmptyAutoWorkflowFrame(frame: CanvasFrame) {
  if (frame.prompt.trim()) return false;
  if (!frame.workflowNodes?.length) return true;
  return frame.workflowNodes.every((node) => autoCoreNodeIds.has(node.id));
}

function defaultBrandDetails(brand: Partial<Brand> & Pick<Brand, "id" | "name" | "logoText" | "primaryColor" | "accentColor" | "tone" | "market">): Brand {
  const isXmanx = brand.id === "brand_xmanx" || brand.name.toLowerCase().includes("xmanx");
  const isDapot = brand.id === "brand_dapot" || /\bdapot\b|da pot/i.test(brand.name);
  const slogan = isXmanx ? "AI-native brand operations for xmanx.com" : isDapot ? "Eat the World in One Hot Pot" : `${brand.name} reusable AI brand kit`;
  const industry = isXmanx ? "AI commerce, brand operation, product launch creative" : isDapot ? "new-generation Thai hot pot buffet and social dining" : "commercial content and ecommerce creative";
  const targetAudience = isXmanx ? "xmanx.com 运营、设计、投放和品牌维护团队" : isDapot ? "泰国年轻女性、朋友聚餐用户、爱拍照且重视干净可信门店体验的顾客" : "brand operators, designers and campaign teams";
  const brandStory = isXmanx
    ? "XMANX 将品牌资产、商品素材、IP 形象和投放场景沉淀为可复用的 AI 工作流，帮助团队快速生成一致的电商视觉、社媒内容和维护素材。"
    : isDapot
      ? "DAPOT 是 CHINDA HOTPOT 旗下年轻化自助火锅品牌，主打 299/399/499 套餐、饮料甜品与自助酱料台，适合开业、短视频和门店屏幕推广。"
    : `${brand.name} 需要把品牌识别、素材角色和营销语气整理为可重复调用的 AI 生成上下文。`;
  const ipName = isXmanx ? "XM Navigator" : isDapot ? "Dapot Buddy" : `${brand.logoText} Brand IP`;
  const ipDescription = isXmanx
    ? "冷静、直接、懂电商增长的品牌助理 IP，可出现在教程、片尾和运营物料中。"
    : isDapot
      ? "高质量 3D 卡通女性虚拟店长，棕色头发、小金牛角、黑色 DAPOT 制服和红围裙，服务感温暖但画面干净。"
    : "可在海报、短视频、说明卡和品牌维护素材中复用的品牌角色。";
  const logoUsage = isXmanx
    ? "优先使用黑底白字或黑橙组合，Logo 保持安全边距，不压住商品主体，片尾或角标露出。"
    : isDapot
      ? "DAPOT Logo 必须清晰出现在红、黑、白或暖色餐厅背景上，不拉伸、不模糊、不遮挡、不随意改色。"
    : "Logo 应保持清晰、安全边距和品牌色一致，可用于角标、片尾、包装与背景水印。";
  const visualStyle = isXmanx
    ? "黑白基础、橙色强调，清晰商品层级，少装饰，偏高效商业视觉；适合主图、社媒海报、品牌维护画布。"
    : isDapot
      ? "red-black-gold young clean trustworthy restaurant visuals, appetizing hot pot closeups, social dining energy, clear logo and low text density"
    : brand.tone;
  const sceneKeywords = isXmanx ? ["studio product hero", "ecommerce launch", "clean black-orange set", "AI workflow dashboard"] : isDapot ? ["Thai hot pot buffet", "clean restaurant", "sauce station", "friends dining", "opening campaign"] : ["product hero", "lifestyle scene", "social campaign"];
  const forbiddenWords = isXmanx ? ["cheap", "low quality", "fake logo", "cluttered layout"] : isDapot ? ["cheap collage", "dirty restaurant", "too much text", "blurred logo", "off-brand color"] : ["off-brand color", "blurred logo", "messy composition"];
  const assetRoles: BrandAssetRole[] = isXmanx ? [
    { role: "logo", title: "XMANX Logo", description: "黑白/黑橙 Logo，用于角标、片尾和品牌水印。", color: brand.primaryColor },
    { role: "ip", title: "XM Navigator", description: "品牌助理 IP，负责解释 AI 工作流、活动和维护建议。", color: brand.accentColor },
    { role: "product", title: "核心商品素材", description: "需要保持真实比例、材质和卖点层级的商品参考。", color: brand.accentColor },
    { role: "model", title: "固定 AI 模特", description: "用于服装、穿搭、生活方式和社媒场景的可复用模特设定。", color: "#111827" },
    { role: "storefront", title: "xmanx.com 店铺视觉", description: "页面首屏、活动 banner、店铺入口和品牌专区素材。", color: "#f8fafc" },
    { role: "environment", title: "黑橙商业场景", description: "干净棚拍、运动街区、科技电商操作台等背景。", color: "#334155" }
  ] : isDapot ? [
    { role: "logo", title: "DAPOT Logo", description: "红黑金餐饮品牌 Logo，用于角标、片尾、菜单和门店画面。", color: brand.primaryColor },
    { role: "ip", title: "Dapot Buddy", description: "年轻、干净、可信的虚拟店长 IP。", color: brand.accentColor },
    { role: "product", title: "Hot Pot Buffet Product", description: "火锅锅底、肉类、菜品、饮料甜品与套餐卖点。", color: brand.primaryColor },
    { role: "menu", title: "Buffet Menu 299 399 499", description: "299/399/499 自助火锅套餐、饮料甜品和酱料台。", color: brand.accentColor },
    { role: "environment", title: "Clean Hot Pot Restaurant", description: "年轻干净的门店环境、聚餐桌面和开业氛围。", color: "#1f2937" }
  ] : [
    { role: "logo", title: `${brand.name} Logo`, description: "透明底 Logo 和品牌角标。", color: brand.primaryColor },
    { role: "product", title: "商品参考", description: "主商品、包装、卖点和材质参考。", color: brand.accentColor },
    { role: "general", title: "通用品牌素材", description: "可复用背景、口号、图形和活动视觉。", color: "#e2e8f0" }
  ];

  return {
    slogan,
    industry,
    targetAudience,
    brandStory,
    ipName,
    ipDescription,
    logoUsage,
    visualStyle,
    sceneKeywords,
    forbiddenWords,
    assetRoles,
    autoInject: true,
    active: false,
    updatedAt: now(),
    ...brand
  };
}

function createSeedDb(): Db {
  const timestamp = now();
  const brands: Brand[] = [
    {
      id: "brand_xmanx",
      name: "XMANX",
      logoText: "XM",
      primaryColor: "#111827",
      accentColor: "#f97316",
      tone: "bold black-orange ecommerce visuals, crisp product hierarchy, premium but direct",
      market: "xmanx.com brand operations and AI marketing content",
      active: true,
      updatedAt: timestamp
    } as Brand,
    {
      id: "brand_dapot",
      name: "DAPOT",
      logoText: "DP",
      primaryColor: "#E60012",
      accentColor: "#FFB400",
      tone: "red-black-gold young clean trustworthy Thai hot pot buffet visuals",
      market: "DAPOT under CHINDA HOTPOT, opening campaigns, TikTok videos, restaurant screens",
      active: false,
      updatedAt: timestamp
    } as Brand,
    {
      id: "brand_boost",
      name: "BoostHub Studio",
      logoText: "BH",
      primaryColor: "#111827",
      accentColor: "#0ea5e9",
      tone: "clean commercial visuals, sharp product focus, premium yet practical",
      market: "cross-border fashion and lifestyle ecommerce",
      active: false,
      updatedAt: timestamp
    } as Brand,
    {
      id: "brand_senge",
      name: "Senge AI Lab",
      logoText: "SG",
      primaryColor: "#14532d",
      accentColor: "#f97316",
      tone: "creator workflow, energetic scenes, short video first",
      market: "AI creators and social commerce teams",
      active: false,
      updatedAt: timestamp
    } as Brand
  ].map((brand) => defaultBrandDetails(brand));

  const seed: Db = {
    users: [defaultAuthUser(1260)],
    sessions: [],
    brands,
    assets: [
      createAsset("XMANX Logo 透明底", "logo", "brand_xmanx", "#111827", "XM · transparent", "/brand-assets/optimized/xmanx-logo.jpg"),
      createAsset("黑橙首发运动鞋", "product", "brand_xmanx", "#f97316", "product · launch hero", "/brand-assets/optimized/xmanx-product.jpg"),
      createAsset("XM Navigator IP", "model", "brand_xmanx", "#f97316", "IP · brand assistant", "/brand-assets/optimized/xmanx-ip.jpg"),
      createAsset("固定 AI 模特", "model", "brand_xmanx", "#111827", "model · urban sport", "/brand-assets/optimized/xmanx-model.jpg"),
      createAsset("xmanx.com 店铺视觉", "upload", "brand_xmanx", "#f8fafc", "storefront · campaign landing", "/brand-assets/optimized/xmanx-storefront.jpg"),
      createAsset("DAPOT Logo", "logo", "brand_dapot", "#E60012", "$dapot.logo · red black gold restaurant logo", "/brand-assets/generated/xmanx-logo.png"),
      createAsset("Dapot Buddy IP", "model", "brand_dapot", "#FFB400", "$dapot.ip · young clean virtual store manager", "/brand-assets/generated/xmanx-ip.png"),
      createAsset("DAPOT Hot Pot Buffet", "product", "brand_dapot", "#E60012", "$dapot.product · hot pot buffet product image", "/brand-assets/generated/xmanx-product.png"),
      createAsset("DAPOT Buffet Menu 299 399 499", "upload", "brand_dapot", "#FFB400", "$dapot.menu.buffet · self-service buffet menu sets 299 399 499 drinks desserts sauce station", "/brand-assets/generated/xmanx-product.png"),
      createAsset("DAPOT Clean Restaurant", "upload", "brand_dapot", "#1f2937", "$dapot.environment · clean young hot pot restaurant opening scene", "/brand-assets/generated/xmanx-storefront.png")
    ],
    frames: [],
    tasks: []
  };

  db = seed;
  return seed;
}

function createAsset(title: string, type: Asset["type"], brandId: string, color: string, meta: string, imageUrl?: string): Asset {
  return { id: nanoid(8), title, type, brandId, color, meta, imageUrl, createdAt: now() };
}

function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  const iterations = 120000;
  const derived = pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${derived}`;
}

function verifyPassword(password: string, encoded?: string) {
  if (!encoded) return false;
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const expected = Buffer.from(parts[3], "hex");
  const actual = Buffer.from(pbkdf2Sync(password, parts[2], iterations, expected.length, "sha512").toString("hex"), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: user.plan,
    credits: user.credits,
    provider: user.provider,
    avatarUrl: user.avatarUrl,
    ...(user.username ? { username: user.username } : {})
  };
}

function defaultAuthUser(credits = 1260): AuthUser {
  const timestamp = now();
  return {
    id: "user_shift",
    name: "Shift",
    username: DEFAULT_DEMO_ACCOUNT,
    email: DEFAULT_DEMO_EMAIL,
    plan: "Pro",
    credits,
    provider: "email",
    passwordHash: passwordHash(DEFAULT_DEMO_PASSWORD),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeAuthUser(user: Partial<AuthUser> & Pick<AuthUser, "id" | "name" | "email" | "plan" | "credits">): AuthUser {
  const timestamp = now();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username ?? user.email.split("@")[0] ?? user.name.toLowerCase().replace(/\s+/g, ""),
    plan: user.plan,
    credits: user.credits,
    provider: user.provider ?? "email",
    passwordHash: user.passwordHash,
    googleSub: user.googleSub,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt ?? timestamp,
    updatedAt: user.updatedAt ?? timestamp
  };
}

function authSessionToken(user: AuthUser, kind: AuthSession["kind"]) {
  if (kind === "login" && user.email === DEFAULT_DEMO_EMAIL && user.username === DEFAULT_DEMO_ACCOUNT) {
    return DEMO_TOKEN;
  }
  if (kind === "login" && adminAccount && adminPassword && user.email === adminAccount && process.env.SPARKCANVAS_AUTH_TOKEN) {
    return process.env.SPARKCANVAS_AUTH_TOKEN;
  }
  return `sc_${nanoid(30)}`;
}

function upsertSession(user: AuthUser, kind: AuthSession["kind"]) {
  const token = authSessionToken(user, kind);
  const session: AuthSession = {
    token,
    userId: user.id,
    kind,
    createdAt: now(),
    lastSeenAt: now()
  };
  db.sessions = db.sessions.filter((item) => item.token !== token);
  db.sessions.unshift(session);
  return session;
}

function findAuthUser(accountOrEmail: string) {
  const normalized = accountOrEmail.trim().toLowerCase();
  return db.users.find((user) => user.email.toLowerCase() === normalized || user.username?.toLowerCase() === normalized);
}

function authUserFromToken(token?: string) {
  if (!token) return undefined;
  if (token === process.env.SPARKCANVAS_AUTH_TOKEN && process.env.SPARKCANVAS_AUTH_TOKEN) {
    const adminUser = adminAccount ? findAuthUser(adminAccount) : undefined;
    return adminUser ?? db.users[0];
  }
  const session = db.sessions.find((item) => item.token === token);
  return session ? db.users.find((user) => user.id === session.userId) : undefined;
}

function attrNode(key: string, value?: AttributeValue, children?: AttributeTree[]): AttributeTree {
  const node: AttributeTree = { key };
  if (typeof value !== "undefined") node.value = value;
  if (children?.length) node.children = children;
  return node;
}

function brandToEntity(brand: Brand): Entity {
  const relatedAssets = db.assets.filter((asset) => asset.brandId === brand.id);
  return {
    id: brand.id,
    entityId: brand.id,
    kind: "brand",
    entityKind: "brand",
    sourceType: "brand",
    sourceId: brand.id,
    title: brand.name,
    status: brand.archived ? "archived" : "active",
    updatedAt: brand.updatedAt,
    attributes: [
      attrNode("identity", undefined, [
        attrNode("name", brand.name),
        attrNode("logoText", brand.logoText),
        attrNode("slogan", brand.slogan),
        attrNode("industry", brand.industry),
        attrNode("market", brand.market),
        attrNode("targetAudience", brand.targetAudience),
        attrNode("brandStory", brand.brandStory),
        attrNode("active", brand.active),
        attrNode("autoInject", brand.autoInject)
      ]),
      attrNode("visual", undefined, [
        attrNode("primaryColor", brand.primaryColor),
        attrNode("accentColor", brand.accentColor),
        attrNode("visualStyle", brand.visualStyle),
        attrNode("logoUsage", brand.logoUsage),
        attrNode("sceneKeywords", brand.sceneKeywords)
      ]),
      attrNode("voice", undefined, [
        attrNode("tone", brand.tone)
      ]),
      attrNode("business", undefined, [
        attrNode("ipName", brand.ipName),
        attrNode("ipDescription", brand.ipDescription)
      ]),
      attrNode("rules", undefined, [
        attrNode("forbiddenWords", brand.forbiddenWords),
        attrNode("archived", Boolean(brand.archived))
      ]),
      attrNode("assets", undefined, [
        attrNode("roles", undefined, brand.assetRoles.map((role) => attrNode(role.role, undefined, [
          attrNode("title", role.title),
          attrNode("description", role.description),
          attrNode("color", role.color ?? null)
        ]))),
        attrNode("linked", undefined, relatedAssets.map((asset) => attrNode(asset.id, undefined, [
          attrNode("id", asset.id),
          attrNode("title", asset.title),
          attrNode("type", asset.type),
          attrNode("role", assetTypeToReferenceRole(asset.type, asset.title, asset.meta)),
          attrNode("color", asset.color),
          attrNode("meta", asset.meta),
          attrNode("imageUrl", asset.imageUrl ?? null),
          attrNode("createdAt", asset.createdAt)
        ])))
      ])
    ]
  };
}

function assetTypeToReferenceRole(type: Asset["type"], title = "", meta = ""): BrandAssetRole["role"] {
  const text = `${title} ${meta}`;
  if (type === "logo") return "logo";
  if (type === "product") return "product";
  if (type === "model" && /(?:^|[\s_$.-])ip(?:$|[\s_$.-])|navigator|mascot|角色|吉祥物|主理人/i.test(text)) return "ip";
  if (type === "model") return "model";
  if (/\$menu\b|\bmenu\b|菜单|菜品|汤底|soup|buffet|price|299|399|499/i.test(text)) return "menu";
  if (/\$equipment\b|\bequipment\b|设备|餐具|锅|drink station|sauce station|饮料|酱料/i.test(text)) return "equipment";
  if (type === "upload" && /store|storefront|店铺|门店|官网|直播间|电商页面/i.test(text)) return "storefront";
  if (type === "upload" && /environment|scene|background|环境|场景|背景|空间|氛围/i.test(text)) return "environment";
  if (type === "upload") return "general";
  return "general";
}

function assetReferencePath(asset: Pick<Asset, "meta">) {
  const match = asset.meta.match(/\$([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/u);
  return match ? normalizeRefPath(match[1]) : "";
}

function stripKnownBrandPrefix(pathKey: string) {
  const parts = pathKey.split(".").filter(Boolean);
  if (parts.length <= 1) return pathKey;
  const knownBrandKeys = new Set(db.brands.flatMap((brand) => [brandKey(brand), normalizeKey(brand.name), brand.id]));
  return knownBrandKeys.has(normalizeKey(parts[0])) ? normalizeRefPath(parts.slice(1).join(".")) : pathKey;
}

function normalizeKey(value = "") {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/\.(com|cn|net|ai|org)\b/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function brandKey(brand: Brand) {
  const nameKey = normalizeKey(brand.name);
  const marketKey = normalizeKey(brand.market.split(/\s+/)[0] ?? "");
  return nameKey || marketKey || brand.id;
}

function findBrandByKey(key: string) {
  const normalized = normalizeKey(key);
  return db.brands.find((brand) => brandKey(brand) === normalized || normalizeKey(brand.name) === normalized || brand.id === key);
}

function resolveWorkGraphBrandId(brandId: string | undefined, prompt = "") {
  const explicit = brandId ? findBrandByKey(brandId) ?? findBrandByKey(brandId.replace(/^brand_/, "")) : undefined;
  if (explicit) return explicit.id;
  const inferred = prompt ? inferBrandFromPrompt(prompt) : undefined;
  if (inferred) return inferred.id;
  return brandId ?? activeBrand()?.id ?? "brand_xmanx";
}

function resolveReferenceBrand(ref: ParsedAssetRef, currentBrand?: Brand) {
  if (ref.explicitBrand && currentBrand && brandReferenceKeys(currentBrand).includes(normalizeKey(ref.brandKey))) {
    return currentBrand;
  }
  return ref.explicitBrand ? findBrandByKey(ref.brandKey) : currentBrand;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandReferenceKeys(brand: Brand) {
  return Array.from(new Set([
    brandKey(brand),
    normalizeKey(brand.name),
    normalizeKey(brand.market.split(/\s+/)[0] ?? ""),
    normalizeKey(brand.id.replace(/^brand_/, "")),
    brand.id
  ].filter(Boolean)));
}

function inferBrandFromPrompt(prompt: string) {
  const normalized = normalizeKey(prompt.replace(/\$[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu, " "));
  return [...db.brands].sort((a, b) => Number(b.active) - Number(a.active)).find((brand) => brandReferenceKeys(brand).some((key) => key && normalized.includes(key)));
}

function promptRequestsWholeBrand(prompt: string, brand: Brand) {
  const explicitPackage = brandReferenceKeys(brand).some((key) => new RegExp(`\\$${escapeRegExp(key)}(?![\\w.-])`, "i").test(prompt));
  const withoutQualifiedRefs = normalizeKey(prompt.replace(/\$[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu, " "));
  const naturalMention = brandReferenceKeys(brand).some((key) => key && withoutQualifiedRefs.includes(key));
  return explicitPackage || naturalMention;
}

const promptRefAlias: Record<string, string> = {
  LOGO: "logo",
  logo: "logo",
  ip: "ip",
  IP: "ip",
  brand: "brand",
  brandName: "brand_name",
  brand_name: "brand_name",
  name: "brand_name",
  slogen: "slogan",
  slogan: "slogan",
  model: "model",
  product: "product",
  product_hero: "product.hero",
  产品: "product",
  模特: "model",
  店铺: "storefront",
  环境: "environment",
  素材: "asset",
  品牌: "brand",
  域名: "domain",
  视觉风格: "style",
  语气: "tone",
  场景: "scene",
  禁用项: "forbidden",
  scene: "scene",
  store: "storefront",
  storefront: "storefront",
  background: "background",
  environment: "environment",
  cta: "cta",
  promotion: "promotion"
};

function normalizeRefPath(path: string) {
  return path.split(".").map((part) => promptRefAlias[part] ?? promptRefAlias[part.toLowerCase()] ?? part.toLowerCase()).join(".");
}

function normalizeLegacyPromptRefs(prompt: string) {
  prompt = prompt.replace(/＠/g, "@").replace(/＃/g, "#").replace(/＄/g, "$").replace(/％/g, "%");
  const replacements: Array<[RegExp, string]> = [
    [/@LOGO\b/g, "$logo"],
    [/@logo\b/g, "$logo"],
    [/@IP\b/g, "$ip"],
    [/@ip\b/g, "$ip"],
    [/@产品/g, "$product"],
    [/@模特/g, "$model"],
    [/@店铺/g, "$storefront"],
    [/@环境/g, "$environment"],
    [/#slogen\b/g, "$copy.slogan"],
    [/#slogan\b/g, "$copy.slogan"],
    [/#brand_name\b/g, "$copy.brand_name"],
    [/#logo\b/g, "$brand.logo_text"],
    [/#ip\b/g, "$brand.ip"],
    [/#style\b/g, "$brand.style"],
    [/#tone\b/g, "$brand.tone"],
    [/#scene\b/g, "$brand.scene"],
    [/@品牌/g, "$copy.brand_name"],
    [/@域名/g, "$copy.domain"],
    [/@视觉风格/g, "$brand.style"],
    [/@语气/g, "$brand.tone"],
    [/@场景/g, "$brand.scene"],
    [/@禁用项/g, "$brand.forbidden"]
  ];
  return replacements
    .reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), prompt)
    .replace(/@((?!imgen\b)[\p{L}\p{N}_-]+\.[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu, "$$$1")
    .replace(/#([\p{L}\p{N}_-]+)\.([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu, (_match, brand, field) => {
      const normalizedField = normalizeRefPath(String(field));
      return normalizedField.startsWith("copy.") || normalizedField.startsWith("brand.")
        ? `$${brand}.${normalizedField}`
        : `$${brand}.copy.${normalizedField}`;
    });
}

function extractLockedTexts(input: string) {
  const lockedTexts: string[] = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    lockedTexts.push(match[1].replace(/\\"/g, "\""));
  }
  return lockedTexts;
}

function extractTags(input: string) {
  return Array.from(input.matchAll(/%([\p{L}\p{N}_\-.]+)/gu)).map((match) => match[1]);
}

function extractAgents(input: string) {
  return Array.from(input.matchAll(/@([\p{L}\p{N}_\-.]+)/gu)).map((match) => match[1]);
}

function extractCommands(input: string) {
  return Array.from(input.matchAll(/\/([\p{L}\p{N}_\-.]+)/gu)).map((match) => match[1]);
}

function extractOutputs(input: string) {
  return Array.from(input.matchAll(/->\s*([^|]+)/g))
    .flatMap((match) => splitOutputTargets(match[1]))
    .filter(Boolean);
}

function splitOutputTargets(value: string) {
  return value
    .replace(/[，、]/g, ",")
    .replace(/\b(and|plus)\b/gi, ",")
    .replace(/\s+(和|及|与)\s+/g, ",")
    .split(",")
    .map((item) => normalizeOutputTarget(item))
    .filter(Boolean);
}

function normalizeOutputTarget(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^输出/, "")
    .replace(/^export\s+/, "")
    .replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    海报: "poster",
    图片: "image",
    主图: "image",
    jpg: "jpg",
    jpeg: "jpg",
    png: "png",
    poster: "poster",
    image: "image",
    img: "image",
    视频: "mp4",
    短视频: "mp4",
    video: "mp4",
    mp4: "mp4",
    mo4: "mp4",
    文档: "pdf",
    教材: "pdf",
    手册: "pdf",
    pdf: "pdf"
  };
  return aliases[normalized] ?? normalized;
}

function outputKindForTarget(target: string): OutputKind {
  if (["mp4", "video", "mov"].includes(target)) return "video";
  if (["pdf", "doc", "docx", "deck", "ppt", "pptx"].includes(target)) return "document";
  return "image";
}

function labelForOutputTarget(target: string) {
  const labels: Record<string, string> = {
    poster: "海报",
    image: "图片",
    jpg: "JPG",
    png: "PNG",
    mp4: "MP4 视频",
    pdf: "PDF 文档"
  };
  return labels[target] ?? target.toUpperCase();
}

function outputTargetsForFinal(target: WorkflowOutputTarget) {
  if (target === "kit") return ["poster", "pdf", "mp4"];
  return [target];
}

function commandForFinalOutput(target: WorkflowOutputTarget) {
  if (target === "mp4") return "/generate-video";
  if (target === "pdf") return "/write-pdf-kit";
  return "/generate-poster";
}

function tagForOrientation(orientation: WorkflowOrientation) {
  if (orientation === "portrait") return "%vertical";
  if (orientation === "landscape") return "%landscape";
  return "%square";
}

function promptDurationSeconds(prompt: string) {
  const match = prompt.match(/(\d{1,2})\s*秒/) ?? prompt.match(/(\d{1,2})\s*(s|sec|secs|second|seconds)\b/i);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.max(1, Math.min(60, seconds));
}

function settingsForFinalOutput(target: WorkflowOutputTarget, orientation: WorkflowOrientation, settings?: Partial<GenerationSettings>, sourcePrompt = "") {
  const ratio = target === "mp4" || target === "kit"
    ? orientation === "portrait" ? "9:16" : "16:9"
    : settings?.ratio ?? "1:1";
  const inferredDuration = promptDurationSeconds(sourcePrompt);
  return {
    ...settings,
    ratio,
    width: settings?.width ?? (orientation === "portrait" ? 1080 : orientation === "landscape" ? 1920 : 1080),
    height: settings?.height ?? (orientation === "portrait" ? 1920 : orientation === "landscape" ? 1080 : 1080),
    count: 1,
    quality: settings?.quality ?? "hd",
    strength: settings?.strength ?? 70,
    duration: target === "mp4" || target === "kit" ? Math.max(settings?.duration || inferredDuration || 5, 5) : 0,
    contentLanguage: settings?.contentLanguage ?? "zh-en"
  };
}

function contentLanguageLabel(language?: ContentLanguage | string) {
  const value = language ?? "zh-en";
  const labels: Record<string, string> = {
    auto: "auto, follow the user's prompt language",
    none: "no text, no subtitles, no voice-over copy",
    zh: "Chinese",
    en: "English",
    th: "Thai",
    "zh-en": "Chinese + English",
    "zh-th": "Chinese + Thai",
    "en-th": "English + Thai",
    "zh-en-th": "Chinese + English + Thai"
  };
  return labels[value] ?? labels["zh-en"];
}

function contentLanguageInstruction(settings?: Partial<GenerationSettings> | { contentLanguage?: ContentLanguage | string }, target: "image" | "video" | "text" | "script" | "pdf" = "image") {
  const language = settings?.contentLanguage ?? "zh-en";
  const label = contentLanguageLabel(language);
  if (language === "none") {
    if (target === "video") return "Language rule: do not add subtitles, captions, voice-over copy, or on-screen text unless the user explicitly locks exact text.";
    if (target === "image") return "Language rule: text-free visual. Do not draw typography unless exact locked text is explicitly provided.";
    return "Language rule: keep generated copy minimal and avoid customer-facing text unless required by the node.";
  }
  if (target === "image") {
    return `Image text language: ${label}. Use only short, clean, legible copy when text is explicitly requested or locked. Avoid gibberish and do not invent extra wording.`;
  }
  if (target === "video") {
    return `Video language: ${label}. If subtitles, captions, voice-over, or on-screen text are needed, use this language setting and keep wording short.`;
  }
  if (target === "script") {
    return `Script language: ${label}. Write scene descriptions, subtitles, voice-over, and table fields in this language setting.`;
  }
  if (target === "pdf") {
    return `Document language: ${label}. Keep headings, body copy, CTA, and notes in this language setting.`;
  }
  return `Content language: ${label}.`;
}

function finalOutputFromPrompt(prompt: string): WorkflowOutputTarget {
  const outputs = extractOutputs(prompt);
  if (outputs.length > 1) return "kit";
  if (outputs.some((item) => outputKindForTarget(item) === "video")) return "mp4";
  if (outputs.some((item) => outputKindForTarget(item) === "document")) return "pdf";
  if (outputs.includes("png")) return "png";
  return "jpg";
}

function extractParams(input: string) {
  const params: Record<string, string> = {};
  const regex = /([\p{L}_][\p{L}\p{N}_\-.]*)\s*:\s*([^，,\n|]+?)(?=\s*->|[，,\n|]|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    params[match[1]] = match[2].trim();
  }
  return params;
}

function isTextResourcePath(path: string) {
  if (!path) return false;
  const head = path.split(".")[0];
  return head === "copy" || head === "brand" || ["brand_name", "slogan", "title", "subtitle", "promotion", "cta", "price", "address", "phone", "notice", "domain", "market", "tone", "style", "scene", "forbidden", "story", "audience"].includes(head);
}

function parsePromptAssetRefs(prompt: string, currentBrand?: Brand): ParsedAssetRef[] {
  prompt = normalizeLegacyPromptRefs(prompt);
  const currentKey = currentBrand ? brandKey(currentBrand) : "";
  const reservedRefHeads = new Set([
    "logo", "ip", "product", "model", "store", "storefront", "environment", "background", "scene", "menu", "equipment", "asset",
    "copy", "brand", "brand_name", "name", "slogan", "title", "subtitle", "promotion", "cta", "price", "address", "phone", "notice",
    "domain", "market", "tone", "style", "forbidden", "story", "audience", "guide", "logo_text", "color"
  ]);
  const refs: ParsedAssetRef[] = [];
  const regex = /(\$)([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prompt)) !== null) {
    const symbol = "$" as const;
    const parts = match[2].split(".");
    const first = normalizeKey(parts[0]);
    const explicitBrandMatch = (!reservedRefHeads.has(first) || parts.length === 1) ? findBrandByKey(first) : undefined;
    const hasBrandPrefix = Boolean(explicitBrandMatch) && (!reservedRefHeads.has(first) || parts.length === 1);
    const brand = hasBrandPrefix && explicitBrandMatch ? brandKey(explicitBrandMatch) : currentKey;
    const path = normalizeRefPath((hasBrandPrefix ? parts.slice(1) : parts).join("."));
    refs.push({
      raw: match[0],
      symbol,
      type: isTextResourcePath(path) ? "text" : "image",
      brandKey: brand,
      path,
      fullKey: path ? `${brand}.${path}` : brand,
      explicitBrand: hasBrandPrefix
    });
  }
  return refs.filter((ref, index, list) => list.findIndex((item) => item.raw === ref.raw && item.fullKey === ref.fullKey && item.symbol === ref.symbol) === index);
}

function textValueForPath(brand: Brand, pathKey: string) {
  const normalized = pathKey.startsWith("copy.") ? pathKey.slice(5) : pathKey.startsWith("brand.") ? pathKey.slice(6) : pathKey;
  const textMap: Record<string, string | undefined> = {
    brand: `${brand.name}: ${brand.slogan}`,
    brand_name: brand.name,
    name: brand.name,
    slogan: brand.slogan,
    title: brand.name,
    subtitle: brand.slogan,
    promotion: brand.slogan,
    cta: "立即了解",
    market: brand.market,
    domain: brand.market,
    tone: brand.tone,
    style: brand.visualStyle,
    ip: `${brand.ipName}: ${brand.ipDescription}`,
    logo: `${brand.logoText}: ${brand.logoUsage}`,
    story: brand.brandStory,
    audience: brand.targetAudience,
    logo_text: `${brand.logoText}: ${brand.logoUsage}`,
    color: `${brand.primaryColor}, ${brand.accentColor}`,
    guide: `${brand.visualStyle}; ${brand.tone}; 禁用: ${brand.forbiddenWords.join(", ")}`,
    forbidden: brand.forbiddenWords.join(", ")
  };
  return textMap[normalized] ?? textMap[normalized.split(".")[0]];
}

function assetMatchesPath(asset: Asset, pathKey: string) {
  pathKey = stripKnownBrandPrefix(pathKey);
  if (!pathKey) return true;
  const role = assetTypeToReferenceRole(asset.type, asset.title, asset.meta);
  const text = `${asset.title} ${asset.meta}`.toLowerCase();
  const explicitPath = stripKnownBrandPrefix(assetReferencePath(asset));
  if (explicitPath && pathKey === explicitPath) return true;
  const [head, ...rest] = pathKey.split(".");
  if (head === "brand") return role === "logo";
  if (head === "menu") return role === "menu" && (rest.length === 0 || rest.every((part) => text.includes(part.replace(/_/g, " "))));
  if (head === "equipment") return role === "equipment" && (rest.length === 0 || rest.every((part) => text.includes(part.replace(/_/g, " "))));
  if (head === "background" || head === "scene") return role === "environment" || role === "storefront" || role === "general";
  if (head !== role && !(head === "store" && role === "storefront")) return false;
  return rest.length === 0 || rest.every((part) => text.includes(part.replace(/_/g, " ")));
}

function replaceCalToken(prompt: string, raw: string, replacement: string) {
  const pattern = new RegExp(`${escapeRegExp(raw)}(?![\\p{L}\\p{N}_.-])`, "gu");
  return prompt.replace(pattern, replacement);
}

function buildBrandPackageValue(brand: Brand) {
  return [
    `${brand.name}: ${brand.slogan}`,
    brand.visualStyle,
    brand.tone,
    brand.sceneKeywords?.length ? `场景: ${brand.sceneKeywords.join(", ")}` : "",
    brand.forbiddenWords?.length ? `禁用: ${brand.forbiddenWords.join(", ")}` : ""
  ].filter(Boolean).join("；");
}

function buildResolverBindings(refs: ParsedAssetRef[], currentBrand?: Brand): ResolverBinding[] {
  return refs.map((ref) => {
    const brand = resolveReferenceBrand(ref, currentBrand);
    const pathSegments = ref.path ? ref.path.split(".").filter(Boolean) : [];
    const warnings: string[] = [];
    if (!brand) {
      warnings.push(ref.explicitBrand ? `未找到品牌 ${ref.brandKey}` : `当前项目未绑定品牌，无法解析 ${ref.raw}`);
      return {
        sourceRef: ref.raw,
        resolved: false,
        resolvedKind: ref.type === "text" ? "text" : "asset",
        brandKey: ref.brandKey,
        path: ref.path,
        pathSegments,
        warnings
      };
    }
    if (!ref.path) {
      return {
        sourceRef: ref.raw,
        resolved: true,
        resolvedKind: "entity",
        entityId: brand.id,
        entityKind: "brand",
        brandId: brand.id,
        brandKey: brandKey(brand),
        path: ref.path,
        pathSegments,
        title: brand.name,
        description: `完整品牌包 · ${brand.visualStyle}`,
        value: buildBrandPackageValue(brand),
        imageUrl: buildReferenceItems(brand, 1)[0]?.imageUrl,
        warnings
      };
    }
    if (ref.type === "text") {
      const value = textValueForPath(brand, ref.path);
      if (!value) {
        warnings.push(`未找到文本资源 $${ref.fullKey}`);
        return {
          sourceRef: ref.raw,
          resolved: false,
          resolvedKind: isTextResourcePath(ref.path) ? "attribute" : "text",
          entityId: brand.id,
          entityKind: "brand",
          brandId: brand.id,
          brandKey: brandKey(brand),
          path: ref.path,
          pathSegments,
          warnings
        };
      }
      return {
        sourceRef: ref.raw,
        resolved: true,
        resolvedKind: "attribute",
        entityId: brand.id,
        entityKind: "brand",
        brandId: brand.id,
        brandKey: brandKey(brand),
        path: ref.path,
        pathSegments,
        title: pathSegments[pathSegments.length - 1] ?? ref.path,
        value,
        warnings
      };
    }

    const assets = db.assets.filter((item) => item.brandId === brand.id && item.imageUrl);
    const asset = assets.find((item) => stripKnownBrandPrefix(assetReferencePath(item)) === stripKnownBrandPrefix(ref.path))
      ?? assets.find((item) => assetMatchesPath(item, ref.path));
    if (!asset?.imageUrl) {
      warnings.push(`未找到图片资源 $${ref.fullKey}`);
      return {
        sourceRef: ref.raw,
        resolved: false,
        resolvedKind: "asset",
        entityId: brand.id,
        entityKind: "brand",
        brandId: brand.id,
        brandKey: brandKey(brand),
        path: ref.path,
        pathSegments,
        warnings
      };
    }
    return {
      sourceRef: ref.raw,
      resolved: true,
      resolvedKind: "asset",
      entityId: asset.id,
      entityKind: "asset",
      brandId: brand.id,
      brandKey: brandKey(brand),
      path: ref.path,
      pathSegments,
      title: asset.title,
      role: assetTypeToReferenceRole(asset.type, asset.title, asset.meta),
      description: asset.meta,
      imageUrl: asset.imageUrl,
      warnings
    };
  });
}

function buildResolverGraph(prompt: string, options?: { brandId?: string | null; brandInject?: boolean }): ResolverGraph {
  const normalizedPrompt = normalizeLegacyPromptRefs(prompt).trim();
  const explicitBrand = options?.brandId === null ? undefined : options?.brandId ? findBrand(options.brandId) : undefined;
  const inferredBrand = explicitBrand ? undefined : inferBrandFromPrompt(normalizedPrompt);
  const brand = explicitBrand ?? inferredBrand;
  const resolved = resolvePromptAssets(normalizedPrompt, brand);
  const shouldInjectBrand = Boolean(brand && (options?.brandInject ?? promptRequestsWholeBrand(normalizedPrompt, brand)));
  const bindings = buildResolverBindings(resolved.ast.resources, brand);
  return {
    version: "resolver-graph/0.1",
    source: {
      originalPrompt: prompt,
      normalizedPrompt,
      expandedPrompt: resolved.prompt,
      cal: resolved.ast
    },
    context: {
      brandId: brand?.id ?? "",
      brandKey: brand ? brandKey(brand) : "",
      brandName: brand?.name ?? "无品牌",
      selection: explicitBrand ? "explicit" : brand ? "inferred" : "none",
      injected: shouldInjectBrand
    },
    bindings,
    warnings: Array.from(new Set([...resolved.warnings, ...bindings.flatMap((binding) => binding.warnings)]))
  };
}

function resolvePromptAssets(prompt: string, currentBrand?: Brand): ResolvedPromptAssets {
  prompt = normalizeLegacyPromptRefs(prompt);
  const refs = parsePromptAssetRefs(prompt, currentBrand);
  const lockedTexts = extractLockedTexts(prompt);
  const tags = extractTags(prompt);
  const params = extractParams(prompt);
  const outputs = extractOutputs(prompt);
  const agents = extractAgents(prompt);
  const commands = extractCommands(prompt);
  const imageReferences: ReferenceItem[] = [];
  const textReferences: Array<{ key: string; value: string; raw: string }> = [];
  const warnings: string[] = [];
  let expandedPrompt = prompt;

  for (const ref of refs) {
    const brand = resolveReferenceBrand(ref, currentBrand);
    if (!brand) {
      warnings.push(ref.explicitBrand ? `未找到品牌 ${ref.brandKey}` : `当前项目未绑定品牌，无法解析 ${ref.raw}`);
      continue;
    }
    if (!ref.path) {
      const brandRefs = buildReferenceItems(brand, 12);
      imageReferences.push(...brandRefs.map((reference) => ({
        ...reference,
        description: `${ref.fullKey}.${reference.role} · ${reference.description}`
      })));
      textReferences.push({ key: `${brandKey(brand)}.brand_package`, value: buildBrandPackageValue(brand), raw: ref.raw });
      expandedPrompt = replaceCalToken(expandedPrompt, ref.raw, `参考品牌 ${brand.name} 的完整品牌素材、视觉风格和文案约束`);
      continue;
    }
    if (ref.type === "text") {
      const value = textValueForPath(brand, ref.path);
      if (!value) {
        warnings.push(`未找到文本资源 $${ref.fullKey}`);
        continue;
      }
      textReferences.push({ key: ref.fullKey, value, raw: ref.raw });
      expandedPrompt = replaceCalToken(expandedPrompt, ref.raw, `"${value}"`);
      continue;
    }

    const assets = db.assets.filter((item) => item.brandId === brand.id && item.imageUrl);
    const asset = assets.find((item) => stripKnownBrandPrefix(assetReferencePath(item)) === stripKnownBrandPrefix(ref.path))
      ?? assets.find((item) => assetMatchesPath(item, ref.path));
    if (!asset?.imageUrl) {
      warnings.push(`未找到图片资源 $${ref.fullKey}`);
      continue;
    }
    imageReferences.push({
      id: `asset_${asset.id}`,
      role: assetTypeToReferenceRole(asset.type, asset.title, asset.meta),
      title: asset.title,
      description: `${ref.fullKey} · ${asset.meta}`,
      color: asset.color,
      imageUrl: asset.imageUrl
    });
    expandedPrompt = replaceCalToken(expandedPrompt, ref.raw, `参考图片 ${ref.fullKey}（${asset.title}）`);
  }

  const ast: CalAst = {
    version: "cal/1.0",
    agents,
    commands,
    resources: refs,
    lockedTexts,
    tags,
    params,
    outputs,
    pipelineSteps: prompt.split("|").length,
    warnings
  };

  return {
    prompt: expandedPrompt,
    imageReferences: imageReferences.filter((reference, index, list) => list.findIndex((item) => item.id === reference.id) === index),
    textReferences: textReferences.filter((reference, index, list) => list.findIndex((item) => item.key === reference.key && item.raw === reference.raw) === index),
    lockedTexts,
    tags,
    params,
    outputs,
    agents,
    commands,
    ast,
    warnings
  };
}

async function loadDb() {
  await mkdir(path.dirname(dataFile), { recursive: true });
  try {
    db = JSON.parse(await readFile(dataFile, "utf8")) as Db;
    await migrateAuthDb();
    await migrateDb();
  } catch {
    const backupFile = `${dataFile}.bak`;
    if (existsSync(backupFile)) {
      db = JSON.parse(await readFile(backupFile, "utf8")) as Db;
      await migrateAuthDb();
      await migrateDb();
      await persistDb();
      return;
    }
    db = createSeedDb();
    await migrateAuthDb();
    await migrateDb();
    await persistDb();
  }
}

async function migrateAuthDb() {
  let changed = false;
  const timestamp = now();
  const legacyUser = db.user;
  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  if (!Array.isArray(db.sessions)) {
    db.sessions = [];
    changed = true;
  }
  if (isProduction && !demoAuthEnabled) {
    const before = db.users.length;
    db.users = db.users.filter((user) => user.email !== DEFAULT_DEMO_EMAIL && user.username !== DEFAULT_DEMO_ACCOUNT);
    if (db.users.length !== before) changed = true;
  }
  if (legacyUser && !db.users.some((user) => user.id === legacyUser.id || user.email === legacyUser.email)) {
    db.users.unshift(normalizeAuthUser({
      ...legacyUser,
      username: DEFAULT_DEMO_ACCOUNT,
      provider: "email",
      passwordHash: passwordHash(DEFAULT_DEMO_PASSWORD),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    changed = true;
  }
  if (demoAuthEnabled) {
    const demoExisting = findAuthUser(DEFAULT_DEMO_ACCOUNT) ?? findAuthUser(DEFAULT_DEMO_EMAIL);
    if (demoExisting) {
      const demoPatch: Partial<AuthUser> = {};
      if (demoExisting.name !== "Shift") demoPatch.name = "Shift";
      if (demoExisting.username !== DEFAULT_DEMO_ACCOUNT) demoPatch.username = DEFAULT_DEMO_ACCOUNT;
      if (demoExisting.email !== DEFAULT_DEMO_EMAIL) demoPatch.email = DEFAULT_DEMO_EMAIL;
      if (demoExisting.provider !== "email") demoPatch.provider = "email";
      if (!verifyPassword(DEFAULT_DEMO_PASSWORD, demoExisting.passwordHash)) demoPatch.passwordHash = passwordHash(DEFAULT_DEMO_PASSWORD);
      if (Object.keys(demoPatch).length) {
        db.users = db.users.map((user) => user.id === demoExisting.id ? {
          ...user,
          ...demoPatch,
          updatedAt: timestamp
        } : user);
        changed = true;
      }
    } else {
      db.users.unshift(defaultAuthUser(1260));
      changed = true;
    }
  }
  if (adminAccount && adminPassword) {
    const adminExisting = findAuthUser(adminAccount);
    const adminUser: AuthUser = normalizeAuthUser({
      id: adminExisting?.id ?? `user_${nanoid(8)}`,
      name: adminExisting?.name ?? adminAccount,
      email: adminAccount,
      username: adminAccount.split("@")[0] ?? adminAccount,
      plan: adminExisting?.plan ?? "Pro",
      credits: adminExisting?.credits ?? 1260,
      provider: "email",
      passwordHash: passwordHash(adminPassword),
      avatarUrl: adminExisting?.avatarUrl,
      createdAt: adminExisting?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    if (adminExisting) {
      db.users = db.users.map((user) => user.id === adminExisting.id ? adminUser : user);
    } else {
      db.users.unshift(adminUser);
    }
    changed = true;
  }
  db.sessions = db.sessions.filter((session) => db.users.some((user) => user.id === session.userId));
  if (legacyUser) delete db.user;
  if (changed) await persistDb();
}

async function migrateDb() {
  let changed = false;
  const timestamp = now();
  const hasXmanx = db.brands.some((brand) => brand.id === "brand_xmanx");

  if (!hasXmanx) {
    db.brands.unshift(defaultBrandDetails({
      id: "brand_xmanx",
      name: "XMANX",
      logoText: "XM",
      primaryColor: "#111827",
      accentColor: "#f97316",
      tone: "bold black-orange ecommerce visuals, crisp product hierarchy, premium but direct",
      market: "xmanx.com brand operations and AI marketing content",
      active: true,
      updatedAt: timestamp
    }));
    db.brands.forEach((brand) => {
      if (brand.id !== "brand_xmanx") brand.active = false;
    });
    db.assets.unshift(createAsset("XMANX Logo 透明底", "logo", "brand_xmanx", "#111827", "XM · transparent"));
    db.assets.unshift(createAsset("黑橙首发运动鞋", "product", "brand_xmanx", "#f97316", "product · launch hero"));
    changed = true;
  }

  const xmanxBrand = db.brands.find((brand) => brand.id === "brand_xmanx");
  if (xmanxBrand && !xmanxBrand.active) {
    xmanxBrand.active = true;
    changed = true;
  }

  if (!db.brands.some((brand) => brand.id === "brand_dapot")) {
    db.brands.push(defaultBrandDetails({
      id: "brand_dapot",
      name: "DAPOT",
      logoText: "DP",
      primaryColor: "#E60012",
      accentColor: "#FFB400",
      tone: "red-black-gold young clean trustworthy Thai hot pot buffet visuals",
      market: "DAPOT under CHINDA HOTPOT, opening campaigns, TikTok videos, restaurant screens",
      active: false,
      updatedAt: timestamp
    }));
    changed = true;
  }

  const requiredXmanxAssets: Array<Pick<Asset, "title" | "type" | "brandId" | "color" | "meta" | "imageUrl">> = [
    { title: "XMANX Logo 透明底", type: "logo", brandId: "brand_xmanx", color: "#111827", meta: "XM · transparent", imageUrl: "/brand-assets/generated/xmanx-logo.png" },
    { title: "黑橙首发运动鞋", type: "product", brandId: "brand_xmanx", color: "#f97316", meta: "product · launch hero", imageUrl: "/brand-assets/generated/xmanx-product.png" },
    { title: "XM Navigator IP", type: "model", brandId: "brand_xmanx", color: "#f97316", meta: "IP · brand assistant", imageUrl: "/brand-assets/generated/xmanx-ip.png" },
    { title: "固定 AI 模特", type: "model", brandId: "brand_xmanx", color: "#111827", meta: "model · urban sport", imageUrl: "/brand-assets/generated/xmanx-model.png" },
    { title: "xmanx.com 店铺视觉", type: "upload", brandId: "brand_xmanx", color: "#f8fafc", meta: "storefront · campaign landing", imageUrl: "/brand-assets/generated/xmanx-storefront.png" }
  ];
  for (const required of requiredXmanxAssets) {
    const existing = db.assets.find((asset) => asset.title === required.title);
    if (existing) {
      if (existing.imageUrl !== required.imageUrl || existing.meta !== required.meta || existing.type !== required.type) {
        Object.assign(existing, required);
        changed = true;
      }
    } else {
      db.assets.unshift(createAsset(required.title, required.type, required.brandId, required.color, required.meta, required.imageUrl));
      changed = true;
    }
  }

  const requiredDapotAssets: Array<Pick<Asset, "title" | "type" | "brandId" | "color" | "meta" | "imageUrl">> = [
    { title: "DAPOT Logo", type: "logo", brandId: "brand_dapot", color: "#E60012", meta: "$dapot.logo · red black gold restaurant logo", imageUrl: "/brand-assets/generated/xmanx-logo.png" },
    { title: "Dapot Buddy IP", type: "model", brandId: "brand_dapot", color: "#FFB400", meta: "$dapot.ip · young clean virtual store manager", imageUrl: "/brand-assets/generated/xmanx-ip.png" },
    { title: "DAPOT Hot Pot Buffet", type: "product", brandId: "brand_dapot", color: "#E60012", meta: "$dapot.product · hot pot buffet product image", imageUrl: "/brand-assets/generated/xmanx-product.png" },
    { title: "DAPOT Buffet Menu 299 399 499", type: "upload", brandId: "brand_dapot", color: "#FFB400", meta: "$dapot.menu.buffet · self-service buffet menu sets 299 399 499 drinks desserts sauce station", imageUrl: "/brand-assets/generated/xmanx-product.png" },
    { title: "DAPOT Clean Restaurant", type: "upload", brandId: "brand_dapot", color: "#1f2937", meta: "$dapot.environment · clean young hot pot restaurant opening scene", imageUrl: "/brand-assets/generated/xmanx-storefront.png" }
  ];
  for (const required of requiredDapotAssets) {
    const existing = db.assets.find((asset) => asset.title === required.title);
    if (existing) {
      if (existing.imageUrl !== required.imageUrl || existing.meta !== required.meta || existing.type !== required.type || existing.brandId !== required.brandId) {
        Object.assign(existing, required);
        changed = true;
      }
    } else {
      db.assets.unshift(createAsset(required.title, required.type, required.brandId, required.color, required.meta, required.imageUrl));
      changed = true;
    }
  }

  if (!db.brands.some((brand) => brand.active) && db.brands[0]) {
    db.brands[0].active = true;
    changed = true;
  }

  db.brands = db.brands.map((brand) => {
    const normalized = defaultBrandDetails(brand);
    if (JSON.stringify(normalized) !== JSON.stringify(brand)) changed = true;
    return normalized;
  });

  const frameIds = new Set(db.frames.map((frame) => frame.id));
  const beforeTaskCount = db.tasks.length;
  db.tasks = db.tasks.filter((task) => frameIds.has(task.frameId));
  if (db.tasks.length !== beforeTaskCount) changed = true;

  for (const brand of db.brands) {
    const brandAssets = db.assets.filter((asset) => asset.brandId === brand.id && !asset.type.startsWith("generated_"));
    for (const role of brand.assetRoles) {
      const hasMaterial = brandAssets.some((asset) => asset.title === role.title || asset.type === role.role);
      if (!hasMaterial && ["logo", "product", "model"].includes(role.role)) {
        db.assets.unshift(createAsset(role.title, role.role as Asset["type"], brand.id, role.color ?? brand.accentColor, role.description));
        changed = true;
      }
    }
  }

  for (const asset of db.assets) {
    const nextImageUrl = await materializeAssetImageUrl(asset.imageUrl, asset.title);
    if (nextImageUrl !== asset.imageUrl) {
      asset.imageUrl = nextImageUrl;
      changed = true;
    }
  }

  for (const frame of db.frames) {
    const originalBrandId = frame.brandId;
    const materializedNodes = await materializeWorkflowNodeImages(frame.workflowNodes ?? []);
    if (JSON.stringify(materializedNodes) !== JSON.stringify(frame.workflowNodes ?? [])) {
      frame.workflowNodes = materializedNodes;
      changed = true;
    }
    const materializedOutputs = await materializeOutputImages(frame.outputs ?? []);
    if (JSON.stringify(materializedOutputs) !== JSON.stringify(frame.outputs ?? [])) {
      frame.outputs = materializedOutputs;
      changed = true;
    }
    const hasFrameBrand = Boolean(frame.brandId && db.brands.some((item) => item.id === frame.brandId));
    const brand = hasFrameBrand ? findBrand(frame.brandId) : undefined;
    const model = findModelById(frame.modelId) ?? defaultImageModel();
    if (!frame.settings) {
      frame.settings = defaultSettings(frame.prompt);
      changed = true;
    }
    if (typeof frame.settings.brandInject !== "boolean") {
      frame.settings.brandInject = true;
      changed = true;
    }
    if (!contentLanguageValues.includes(frame.settings.contentLanguage)) {
      frame.settings.contentLanguage = "zh-en";
      changed = true;
    }
    if (hasFrameBrand && brand && frame.brandName !== brand.name) {
      frame.brandName = brand.name;
      frame.brandInjected = frame.settings.brandInject;
      frame.brandContext = frame.brandInjected ? buildBrandContext(brand) : "";
      frame.finalPrompt = buildFinalPrompt(frame.prompt, buildBrandContext(brand), frame.brandInjected, brand);
      changed = true;
    }
    if (!hasFrameBrand && (originalBrandId || frame.brandName !== "无品牌" || frame.brandInjected || frame.brandContext || frame.settings.brandInject)) {
      frame.brandId = "";
      frame.brandName = "无品牌";
      frame.brandInjected = false;
      frame.settings.brandInject = false;
      frame.brandContext = "";
      frame.finalPrompt = buildFinalPrompt(frame.prompt, "", false, undefined);
      changed = true;
    }
    if (brand && frame.brandInjected && !frame.brandContext.startsWith("$copy.brand_name")) {
      frame.brandContext = buildBrandContext(brand);
      frame.finalPrompt = buildFinalPrompt(frame.prompt, frame.brandContext, frame.brandInjected, brand);
      changed = true;
    }
    if (!frame.modelId || !frame.modelName || !findModelById(frame.modelId)) {
      frame.modelId = model.id;
      frame.modelName = model.name;
      changed = true;
    }
    if (isEmptyAutoWorkflowFrame(frame)) {
      if (frame.workflowNodes.length || frame.outputs.length || frame.brandContext || frame.finalPrompt || frame.steps.length) {
        frame.workflowNodes = [];
        frame.outputs = [];
        frame.brandContext = "";
        frame.finalPrompt = "";
        frame.steps = [];
        frame.status = "ready";
        frame.progress = 0;
        frame.updatedAt = timestamp;
        changed = true;
      }
      continue;
    }
    if (!frame.workflowNodes) {
      frame.workflowNodes = buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext, frame.brandInjected);
      changed = true;
    }
    if (!frame.workflowNodes.some((node) => node.id === "brand")) {
      frame.workflowNodes = mergeWorkflowNodes(buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || (brand ? buildBrandContext(brand) : ""), frame.brandInjected), frame.workflowNodes);
      changed = true;
    }
    const referenceNodeTitles = frame.workflowNodes.filter((node) => node.type === "reference").map((node) => node.title);
    if (referenceNodeTitles.length > new Set(referenceNodeTitles).size) {
      frame.workflowNodes = buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || (brand ? buildBrandContext(brand) : ""), frame.brandInjected);
      changed = true;
    }
    const beforeAutoReferenceCleanup = frame.workflowNodes.length;
    frame.workflowNodes = frame.workflowNodes.filter((node) => !node.id.startsWith("ref-") && node.id !== "model");
    if (frame.workflowNodes.length !== beforeAutoReferenceCleanup) changed = true;
    if (frame.workflowNodes.some((node) => node.type === "output" && node.id !== "output") && frame.workflowNodes.some((node) => node.id === "output")) {
      frame.workflowNodes = frame.workflowNodes.filter((node) => node.id !== "output");
      changed = true;
    }
    const isVideoOnlyWorkflow = frame.outputs.length > 0 && frame.outputs.every((output) => output.kind === "video");
    if (isVideoOnlyWorkflow && frame.workflowNodes.some((node) => node.id === "visual-draft")) {
      frame.workflowNodes = frame.workflowNodes
        .filter((node) => node.id !== "visual-draft")
        .map((node) => node.parentId === "visual-draft" ? { ...node, parentId: "prompt" } : node);
      changed = true;
    }
    const outputNode = frame.workflowNodes.find((node) => node.id === "output");
    if (outputNode?.parentId === "model") {
      outputNode.parentId = "prompt";
      changed = true;
    }
    const brandNode = frame.workflowNodes.find((node) => node.id === "brand");
    if (brandNode && frame.brandInjected && brandNode.body !== frame.brandContext) {
      brandNode.body = frame.brandContext;
      changed = true;
    }
    const promptNode = frame.workflowNodes.find((node) => node.id === "prompt");
    if (promptNode && promptNode.body !== frame.finalPrompt) {
      promptNode.body = frame.finalPrompt;
      changed = true;
    }
    frame.workflowNodes = frame.workflowNodes.map((node, index) => {
      const complete = typeof node.x === "number" && typeof node.y === "number" && typeof node.w === "number" && typeof node.h === "number";
      if (complete) return node;
      changed = true;
      const fallback = buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || (brand ? buildBrandContext(brand) : ""), frame.brandInjected).find((item) => item.id === node.id);
      return { ...node, x: node.x ?? fallback?.x ?? 120 + index * 245, y: node.y ?? fallback?.y ?? 220, w: node.w ?? fallback?.w ?? 240, h: node.h ?? fallback?.h ?? 220 };
    });
    const inputNode = frame.workflowNodes.find((node) => node.id === "input-image");
    if (inputNode && brand && frame.brandInjected) {
      const brandRefs = buildReferenceItems(brand);
      const existingRefs = inputNode.refs ?? [];
      const nextRefs = [...existingRefs, ...brandRefs].filter((reference, index, list) => (
        list.findIndex((item) => item.id === reference.id || (item.imageUrl && item.imageUrl === reference.imageUrl)) === index
      ));
      if (JSON.stringify(existingRefs) !== JSON.stringify(nextRefs)) {
        inputNode.refs = nextRefs;
        if (!inputNode.body.trim() || inputNode.body === existingRefs.map((asset) => `${asset.role}: ${asset.title}`).join(" / ")) {
          inputNode.body = nextRefs.map((asset) => `${asset.role}: ${asset.title}`).join(" / ");
        }
        changed = true;
      }
    }
    const seenNodeIds = new Set<string>();
    frame.workflowNodes = frame.workflowNodes.map((node, index) => {
      if (!seenNodeIds.has(node.id)) {
        seenNodeIds.add(node.id);
        return node;
      }
      changed = true;
      const nextId = `${node.id}-${index}`;
      seenNodeIds.add(nextId);
      return { ...node, id: nextId };
    });
    if (frame.w < 900) {
      frame.w = 980;
      frame.h = Math.max(frame.h, 360);
      changed = true;
    }

    const nextSteps = frame.steps.map((step) => step.replace("Brand Agent 注入 BoostHub Studio 的色彩、Logo 与语气", "Brand Agent 注入 XMANX 的色彩、Logo 与语气"));
    if (nextSteps.some((step, index) => step !== frame.steps[index])) {
      frame.steps = nextSteps;
      frame.updatedAt = timestamp;
      changed = true;
    }

    for (const output of frame.outputs) {
      if (output.copy.startsWith("BH /")) {
        output.copy = output.copy.replace("BH /", "XM /");
        changed = true;
      }
    }
    const fallbackImages = ["/brand-assets/generated/xmanx-storefront.png", "/brand-assets/generated/xmanx-product.png", "/brand-assets/generated/xmanx-logo.png"];
    frame.outputs.forEach((output, index) => {
      if (output.kind === "image" && !output.imageUrl) {
        output.imageUrl = fallbackImages[index % fallbackImages.length];
        changed = true;
      }
    });
  }

  if (changed) await persistDb();
}

async function persistDb() {
  persistDbQueue = persistDbQueue.then(async () => {
    await mkdir(path.dirname(dataFile), { recursive: true });
    const payload = JSON.stringify(db, null, 2);
    const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpFile, payload);
    if (existsSync(dataFile)) renameSync(dataFile, `${dataFile}.bak`);
    renameSync(tmpFile, dataFile);
  });
  return persistDbQueue;
}

async function readWorkGraphOsWorkspace() {
  try {
    return workGraphOsWorkspaceSchema.parse(JSON.parse(await readFile(workGraphOsDataFile, "utf8")));
  } catch {
    return null;
  }
}

async function writeWorkGraphOsWorkspace(workspace: WorkGraphOsWorkspace) {
  const syncedWorkspace = syncNodeModelPolicies(workspace);
  await mkdir(path.dirname(workGraphOsDataFile), { recursive: true });
  const payload = JSON.stringify(syncedWorkspace, null, 2);
  const tmpFile = `${workGraphOsDataFile}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmpFile, payload);
  if (existsSync(workGraphOsDataFile)) renameSync(workGraphOsDataFile, `${workGraphOsDataFile}.bak`);
  renameSync(tmpFile, workGraphOsDataFile);
  await syncWorkGraphOsObjectSnapshots(syncedWorkspace);
  await syncWorkGraphOsSqlite(buildWorkGraphOsSqliteExport(syncedWorkspace, await readWorkGraphOsHistory()));
  return syncedWorkspace;
}

async function readWorkGraphOsHistory() {
  try {
    const entries = JSON.parse(await readFile(workGraphOsHistoryFile, "utf8")) as WorkGraphOsHistoryEntry[];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

async function writeWorkGraphOsHistory(entries: WorkGraphOsHistoryEntry[]) {
  await mkdir(path.dirname(workGraphOsHistoryFile), { recursive: true });
  const payload = JSON.stringify(entries.slice(0, 100), null, 2);
  const tmpFile = `${workGraphOsHistoryFile}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmpFile, payload);
  if (existsSync(workGraphOsHistoryFile)) renameSync(workGraphOsHistoryFile, `${workGraphOsHistoryFile}.bak`);
  renameSync(tmpFile, workGraphOsHistoryFile);
  await syncWorkGraphOsSqlite(buildWorkGraphOsSqliteExport(await readWorkGraphOsWorkspace(), entries.slice(0, 100)));
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmpFile, payload);
  renameSync(tmpFile, filePath);
}

async function writeTextAtomic(filePath: string, value: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmpFile, value.endsWith("\n") ? value : `${value}\n`);
  renameSync(tmpFile, filePath);
}

async function persistWorkGraphRunArtifacts(run: ReturnType<typeof buildWorkGraphOsExecution>) {
  const createdAt = objectString(run.result, "createdAt", now()).replace(/[:.]/g, "-");
  const resultId = objectString(run.result, "id", run.execution.resultId);
  const executionId = run.execution.id;
  const baseName = `${createdAt}-${safeWorkGraphRelativePath(resultId) || "result"}`;
  const resultDir = path.join(workGraphOsResultDataDir, baseName);
  const outputDir = path.join(workGraphOsOutputDataDir, baseName);
  const logDir = path.join(workGraphOsLogDataDir, executionId);
  const previewPath = path.join(outputDir, "preview.md");
  const resultPath = path.join(resultDir, "result.json");
  const promptPath = path.join(resultDir, "prompt.json");
  const logsPath = path.join(logDir, "logs.jsonl");
  const manifestPath = path.join(resultDir, "manifest.json");
  const artifactPaths = {
    resultDir,
    outputDir,
    logDir,
    resultJson: resultPath,
    preview: previewPath,
    promptJson: promptPath,
    logsJsonl: logsPath,
    manifest: manifestPath
  };
  const resultWithArtifacts = {
    ...(run.result as Record<string, unknown>),
    artifactPaths,
    piSessionId: objectString(run, "piSessionId", ""),
    trace: {
      ...(objectField(run.result, "trace") && typeof objectField(run.result, "trace") === "object" ? objectField(run.result, "trace") as Record<string, unknown> : {}),
      piSessionId: objectString(run, "piSessionId", "")
    }
  };
  const manifest = {
    id: resultId,
    executionId,
    workflowId: run.execution.workflowId,
    nodeId: run.execution.nodeId,
    skillId: run.execution.skillId,
    modelId: run.execution.modelId,
    promptRecordId: objectString(run.promptRecord, "id", ""),
    createdAt: objectString(run.result, "createdAt", now()),
    files: artifactPaths
  };
  await writeJsonAtomic(resultPath, resultWithArtifacts);
  await writeJsonAtomic(promptPath, run.promptRecord);
  await writeJsonAtomic(manifestPath, manifest);
  await writeTextAtomic(previewPath, objectString(run.result, "output", objectString(run.result, "preview", "")));
  await writeTextAtomic(logsPath, run.executionLog.map((entry) => JSON.stringify(entry)).join("\n"));
  return { artifactPaths, result: resultWithArtifacts };
}

// objectField / objectString / objectStringArray are imported from ./object-access (T10).

function workGraphResultKind(output: string) {
  const normalized = output.toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("video")) return "video";
  if (normalized.includes("zip") || normalized.includes("archive")) return "archive";
  if (normalized.includes("pdf") || normalized.includes("doc")) return "document";
  return "image";
}

function workGraphDefaultOutput(workspace: WorkGraphOsWorkspace, node: unknown) {
  const nodeType = objectString(node, "type", "");
  if (nodeType === "video") return "MP4";
  if (nodeType === "file") return "ZIP";
  const workflowOutput = objectString(workspace.workflow, "outputTarget", "");
  return workflowOutput ? workflowOutput.toUpperCase() : "PNG";
}

function workGraphFindSkillForNode(workspace: WorkGraphOsWorkspace, node: unknown) {
  const nodeTitle = objectString(node, "title", "").toLowerCase();
  const nodeBody = objectString(node, "body", "").toLowerCase();
  return workspace.skills.find((skill) => {
    const id = objectString(skill, "id", "").toLowerCase();
    const command = objectString(skill, "command", "").replace(/^\//, "").toLowerCase();
    const title = objectString(skill, "title", "").toLowerCase();
    return Boolean(id && nodeTitle.includes(id))
      || Boolean(command && (nodeTitle.includes(command) || nodeBody.includes(command)))
      || Boolean(title && (nodeTitle.includes(title) || nodeBody.includes(title)));
  }) ?? workspace.skills[0];
}

function workGraphModelCatalog(workspace: WorkGraphOsWorkspace) {
  return buildWorkGraphModelCatalog(workspace.activeModelId || "imgen", workGraphDefaultOutput(workspace, {}));
}

function workGraphFeedbackModelStrategy(workspace: WorkGraphOsWorkspace, node: unknown, output: string) {
  const nodeId = objectString(node, "id", "");
  const resultKind = workGraphResultKind(output);
  const relatedPolicy = (workspace.modelPolicies ?? []).find((item) => {
    const action = objectString(item, "action", "");
    const avoid = Boolean(objectField(item, "avoid"));
    if (!avoid && action !== "avoid") return false;
    const targetType = objectString(item, "targetType", "");
    const targetId = objectString(item, "targetId", "");
    if (targetType === "node" && targetId === nodeId) return true;
    if (targetType === "result") {
      const result = workspace.results.find((candidate) => objectString(candidate, "id", "") === targetId);
      if (result && objectString(result, "nodeId", "") === nodeId) return true;
      return !nodeId && workGraphResultKind(objectString(result, "output", objectString(result, "kind", ""))) === resultKind;
    }
    return false;
  });
  if (!relatedPolicy) return "";
  return resultKind === "video" ? "final_output" : "high_quality";
}

function buildWorkGraphModelRoutingDecision(workspace: WorkGraphOsWorkspace, node: unknown, output: string): WorkGraphOsRoutingDecision {
  const explicitStrategy = objectString(node, "modelStrategy", "");
  const feedbackStrategy = explicitStrategy ? "" : workGraphFeedbackModelStrategy(workspace, node, output);
  const decision = routeWorkGraphModel({
    activeModelId: objectString(node, "modelId", "") || workspace.activeModelId || "imgen",
    output,
    node: {
      id: objectString(node, "id", "workflow"),
      type: objectString(node, "type", "skill_execute"),
      modelStrategy: explicitStrategy || feedbackStrategy
    },
    now,
    idFactory: () => `route-${Date.now().toString(36)}-${nanoid(6)}`
  });
  return feedbackStrategy
    ? {
        ...decision,
        reason: `${decision.reason}; feedback model policy upgraded strategy to ${feedbackStrategy}`
      }
    : decision;
}

function modelProviderFromRoute(decision: WorkGraphOsRoutingDecision) {
  if (decision.route.includes("ollama") || decision.selectedCapability === "local") return "ollama";
  if (/gemini|google/i.test(decision.selectedModelId)) return "google";
  if (/claude|anthropic/i.test(decision.selectedModelId)) return "anthropic";
  if (/flux/i.test(decision.selectedModelId)) return "local_flux";
  if (decision.route.includes("/v1/videos") || decision.selectedCapability === "video") return "custom";
  if (/gpt|openai|imgen|vdamo/i.test(decision.selectedModelId)) return "openai";
  return "custom";
}

function workGraphModelPolicyFromDecision(input: {
  decision: WorkGraphOsRoutingDecision;
  node?: unknown;
  targetType?: string;
  targetId?: string;
  feedbackId?: string;
  note?: string;
  updatedAt: string;
}) {
  const nodeId = objectString(input.node, "id", input.decision.nodeId);
  const id = nodeId ? `node-${nodeId}` : input.decision.id;
  return {
    id,
    type: "model_policy",
    nodeId,
    nodeType: objectString(input.node, "type", input.decision.nodeType),
    targetType: input.targetType ?? "node",
    targetId: input.targetId ?? nodeId,
    feedbackId: input.feedbackId ?? "",
    action: input.feedbackId ? "learned" : "route",
    strategy: input.decision.strategy,
    provider: modelProviderFromRoute(input.decision),
    modelId: input.decision.selectedModelId,
    requestedModelId: input.decision.requestedModelId,
    fallbackModelIds: input.decision.fallbackModelIds,
    route: input.decision.route,
    routingDecisionId: input.decision.id,
    note: input.note ?? input.decision.reason,
    avoid: false,
    updatedAt: input.updatedAt
  };
}

function syncNodeModelPolicies(workspace: WorkGraphOsWorkspace) {
  const updatedAt = workspace.updatedAt || now();
  const nodePolicies = workspace.nodes.map((node) => {
    const output = workGraphDefaultOutput(workspace, node);
    const decision = buildWorkGraphModelRoutingDecision(workspace, node, output);
    return workGraphModelPolicyFromDecision({ decision, node, updatedAt });
  });
  const nodePolicyIds = new Set(nodePolicies.map((policy) => objectString(policy, "id", "")));
  return {
    ...workspace,
    modelPolicies: [
      ...nodePolicies,
      ...(workspace.modelPolicies ?? []).filter((item) => !nodePolicyIds.has(objectString(item, "id", "")))
    ].slice(0, 200)
  };
}

function workGraphSkillEvolution(skill: unknown) {
  const evolution = objectField(skill, "evolution");
  const runCount = Number(objectField(evolution, "runCount") ?? 0);
  const successCount = Number(objectField(evolution, "successCount") ?? 0);
  const failureCount = Number(objectField(evolution, "failureCount") ?? 0);
  return {
    ...(evolution && typeof evolution === "object" ? evolution as Record<string, unknown> : {}),
    status: objectString(evolution, "status", "created"),
    runCount: Number.isFinite(runCount) ? runCount : 0,
    successCount: Number.isFinite(successCount) ? successCount : 0,
    failureCount: Number.isFinite(failureCount) ? failureCount : 0,
    testPlan: objectStringArray(evolution, "testPlan").length ? objectStringArray(evolution, "testPlan") : ["run generated skill", "verify result object", "save reusable SKILL.md"],
    history: Array.isArray(objectField(evolution, "history")) ? objectField(evolution, "history") as unknown[] : []
  };
}

function withWorkGraphSkillEvolution(skill: unknown, entry: Record<string, unknown>, status: "active" | "failed" = "active") {
  const current = workGraphSkillEvolution(skill);
  const nextEntry = { id: `skill-history-${Date.now().toString(36)}-${nanoid(6)}`, createdAt: now(), ...entry };
  const success = entry.status !== "failed";
  return {
    ...(skill as Record<string, unknown>),
    evolution: {
      ...current,
      status,
      runCount: current.runCount + 1,
      successCount: current.successCount + (success ? 1 : 0),
      failureCount: current.failureCount + (success ? 0 : 1),
      lastRunAt: nextEntry.createdAt,
      history: [nextEntry, ...current.history].slice(0, 50)
    }
  };
}

function workGraphOutputForPrompt(prompt: string) {
  return workflowOutputForPrompt(prompt);
}

function workGraphPromptTokens(prompt: string) {
  return workflowPromptTokens(prompt);
}

function workGraphSkillScore(skill: unknown, prompt: string) {
  const haystack = [
    objectString(skill, "title", ""),
    objectString(skill, "command", ""),
    objectString(skill, "description", ""),
    objectString(skill, "capabilityType", ""),
    objectStringArray(skill, "keywords").join(" ")
  ].join(" ").toLowerCase();
  return workGraphPromptTokens(prompt).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function workGraphPlannerNode(input: {
  id: string;
  title: string;
  type: string;
  body: string;
  x: number;
  y: number;
  materialIds?: string[];
  status?: string;
}) {
  return {
    id: input.id,
    title: input.title,
    type: input.type,
    body: input.body,
    x: input.x,
    y: input.y,
    materialIds: input.materialIds ?? [],
    status: input.status ?? "ready"
  };
}

function workGraphPlanSkillTitle(prompt: string, output: string) {
  const normalized = prompt
    .replace(/@\w+/g, "")
    .replace(/\$[\w.-]+/g, "")
    .replace(/->\s*\w+/g, "")
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return `${normalized || "自动规划"} Skill -> ${output}`;
}

function buildWorkGraphCandidateSkill(prompt: string, output: string, createdAt: string) {
  const isVideo = workGraphResultKind(output) === "video";
  const title = workGraphPlanSkillTitle(prompt, output);
  const command = `/${workGraphSlug(title).slice(0, 40)}`;
  return workGraphNormalizeSkill({
    id: `skill-candidate-${Date.now().toString(36)}-${nanoid(6)}`,
    title,
    command,
    output,
    description: `Workflow Planner 自动创建的候选 Skill，用于执行目标：${prompt}`,
    icon: isVideo ? "video" : "image",
    keywords: [...workGraphPromptTokens(prompt).slice(0, 8), output.toLowerCase()],
    nodeType: isVideo ? "video" : "output",
    capabilityType: isVideo ? "video_planning" : "image_generation",
    inputs: ["Goal Object", "Brand Object", "Asset Object", "Model Object"],
    outputs: [`Result Object: ${output}`, "Memory Object: planner-created skill pattern"],
    runtime: "pi-skill",
    version: "0.1.0",
    evolution: {
      status: "candidate",
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      testPlan: ["run planner-created skill", "verify model route", "review result quality", "promote to reusable SKILL.md"]
    },
    source: "workgraph-workflow-planner",
    createdAt
  });
}

function buildWorkGraphOsPlan(workspace: WorkGraphOsWorkspace, input: z.infer<typeof workGraphOsPlanSchema>, availableSkills?: unknown[]) {
  const createdAt = now();
  const prompt = (input.prompt ?? workspace.prompt).trim() || workspace.prompt || "Generate a reusable brand workflow";
  const activeBrandId = resolveWorkGraphBrandId(input.brandId ?? workspace.activeBrandId, prompt);
  const activeModelId = input.activeModelId ?? workspace.activeModelId;
  const selectedBrand = findBrand(activeBrandId);
  const brandPayload = workGraphBrandPayload(selectedBrand, activeBrandId);
  const isAvoidedAsset = (assetId: string) => {
    const material = workspace.materials.find((item) => objectString(item, "id", "") === assetId);
    const dbAsset = db.assets.find((asset) => asset.id === assetId);
    return objectStringArray(material, "tags").includes("feedback-avoid")
      || Boolean(dbAsset && workGraphAssetPayload(dbAsset).tags.includes("feedback-avoid"));
  };
  const brandAssets = db.assets
    .filter((asset) => asset.brandId === brandPayload.id && !asset.type.startsWith("generated_"))
    .slice(0, 12);
  const brandAssetIds = brandAssets
    .filter((asset) => !workGraphAssetPayload(asset).tags.includes("feedback-avoid"))
    .slice(0, 6)
    .map((asset) => asset.id);
  const visibleBrandMaterials = brandAssets
    .map((asset) => workGraphAssetPayload(asset))
    .filter((asset) => !workspace.materials.some((item) => objectString(item, "id", "") === asset.id));
  const selectedIds = input.selectedIds?.length
    ? input.selectedIds.filter((id) => !isAvoidedAsset(id))
    : workspace.selectedIds.filter((id) => !isAvoidedAsset(id)).length
      ? workspace.selectedIds.filter((id) => !isAvoidedAsset(id))
      : brandAssetIds;
  const candidateAssetIds = Array.from(new Set([
    ...(input.selectedIds ?? []),
    ...workspace.selectedIds,
    ...db.assets
      .filter((asset) => asset.brandId === brandPayload.id && !asset.type.startsWith("generated_"))
      .map((asset) => asset.id)
  ].filter(Boolean)));
  const avoidedAssetIds = candidateAssetIds.filter((id) => isAvoidedAsset(id));
  const avoidedAssetNote = avoidedAssetIds.length
    ? `已跳过 ${avoidedAssetIds.length} 个 feedback-avoid Asset Object：${avoidedAssetIds.slice(0, 4).join(", ")}`
    : "";
  {
    const plannerWorkspace: WorkGraphOsWorkspace = { ...workspace, prompt, activeBrandId: brandPayload.id, activeModelId, selectedIds };
    const skillCatalog = availableSkills?.length ? availableSkills.map((skill, index) => workGraphNormalizeSkill(skill, index)) : workGraphSkillCatalog(workspace);
    const planned = planWorkGraphWorkflow({
      prompt,
      brand: {
        id: brandPayload.id,
        name: brandPayload.name,
        positioning: brandPayload.positioning,
        rules: brandPayload.rules
      },
      activeModelId,
      selectedIds,
      skills: skillCatalog,
      createdAt,
      idFactory: (prefix) => `${prefix}-${Date.now().toString(36)}-${nanoid(6)}`,
      slug: workGraphSlug,
      normalizeSkill: (skill, index = 0) => workGraphNormalizeSkill(skill, index),
      skillScore: workGraphSkillScore,
      goalBase: workGraphGoalPayload(plannerWorkspace),
      workflowBase: {
        ...workGraphWorkflowPayload(plannerWorkspace),
        id: objectString(workspace.workflow, "id", "workflow-active")
      },
      existingSkills: workspace.skills,
      existingJobsCount: workspace.jobs.length
    });
    const plannedNodes = planned.nodes.map((node) => node.id === "asset-retriever" && avoidedAssetNote
      ? { ...node, body: `${node.body}\n${avoidedAssetNote}` }
      : node);
    const nextWorkspace: WorkGraphOsWorkspace = {
      ...workspace,
      prompt,
      activeBrandId: brandPayload.id,
      activeModelId,
      selectedIds,
      activeMaterialId: workspace.activeMaterialId || selectedIds[0] || "",
      goal: planned.goal,
      workflow: planned.workflow,
      materials: [...workspace.materials, ...visibleBrandMaterials],
      skills: planned.skills,
      nodes: plannedNodes,
      memories: [planned.memory, ...workspace.memories],
      updatedAt: createdAt
    };
    return {
      plan: {
        ...planned.plan,
        source: "workgraph-workflow-planner",
        avoidedAssetIds,
        assetSelectionReason: avoidedAssetNote || "未发现 feedback-avoid Asset Object。"
      },
      workspace: nextWorkspace,
      routingDecision: planned.routingDecision,
      memory: planned.memory
    };
  }
  const output = workGraphOutputForPrompt(prompt);
  const safeAvailableSkills = availableSkills ?? [];
  const skillCatalog = safeAvailableSkills.length ? safeAvailableSkills.map((skill, index) => workGraphNormalizeSkill(skill, index)) : workGraphSkillCatalog(workspace);
  const matchedSkill = skillCatalog
    .map((skill) => ({ skill, score: workGraphSkillScore(skill, prompt) }))
    .sort((left, right) => right.score - left.score)[0];
  const matchedExistingSkill = matchedSkill && matchedSkill.score > 0 ? matchedSkill.skill : null;
  const candidateSkill = matchedExistingSkill ? null : buildWorkGraphCandidateSkill(prompt, output, createdAt);
  const usableSkill = matchedExistingSkill ?? candidateSkill;
  const skillId = usableSkill ? objectString(usableSkill, "id", "") : "";
  const skillCommand = usableSkill ? objectString(usableSkill, "command", "") : "";
  const skillTitle = usableSkill ? objectString(usableSkill, "title", "Reusable Skill") : "Create reusable skill";
  const nextSkills = candidateSkill
    ? [candidateSkill, ...workspace.skills.filter((skill) => objectString(skill, "id", "") !== objectString(candidateSkill, "id", ""))]
    : workspace.skills;
  const plannerWorkspace: WorkGraphOsWorkspace = { ...workspace, prompt, activeBrandId: brandPayload.id, activeModelId, selectedIds };
  const generateNodeType = workGraphResultKind(output) === "video"
    ? "video_generate"
    : workGraphResultKind(output) === "image"
      ? "image_generate"
      : workGraphResultKind(output) === "document" || workGraphResultKind(output) === "archive"
        ? "export"
        : "text_generate";
  const paidVideoLocked = workGraphResultKind(output) === "video" && shouldBlockPaidVideoGeneration(defaultVideoGenBaseUrl);
  const videoGuardNote = paidVideoLocked
    ? "付费视频生成已锁定；当前只生成本地预览计划，不请求 yijia。需要真实生成时显式设置 SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1。"
    : "";
  const outputNode = workGraphPlannerNode({
    id: "output",
    title: `Result Preview · ${output}`,
    type: "preview",
    body: paidVideoLocked
      ? `生成 ${output} 本地预览计划，保留 Result Object、版本和可回写素材库状态。${videoGuardNote}`
      : `生成 ${output}，保留 Result Object、预览地址、版本和可回写素材库状态。`,
    x: 1010,
    y: 198,
    materialIds: selectedIds
  });
  const routingDecision = buildWorkGraphModelRoutingDecision(plannerWorkspace, outputNode, output);
  const nodes = [
    workGraphPlannerNode({
      id: "goal",
      title: "Goal Object",
      type: "goal",
      body: prompt,
      x: 70,
      y: 72
    }),
    workGraphPlannerNode({
      id: "brand-context",
      title: `Brand Context · ${brandPayload.name}`,
      type: "brand_context",
      body: `${brandPayload.positioning}\n${brandPayload.rules.slice(0, 3).join("\n")}`.trim(),
      x: 355,
      y: 52
    }),
    workGraphPlannerNode({
      id: "asset-retriever",
      title: "Asset Retriever",
      type: "asset_search",
      body: selectedIds.length
        ? [`读取 ${selectedIds.length} 个 Asset Object：${selectedIds.slice(0, 4).join(", ")}`, avoidedAssetNote].filter(Boolean).join("\n")
        : ["未选择素材；运行前需要上传或从品牌库选择 Asset Object。", avoidedAssetNote].filter(Boolean).join("\n"),
      x: 88,
      y: 252,
      materialIds: selectedIds,
      status: selectedIds.length ? "ready" : "queued"
    }),
    workGraphPlannerNode({
      id: "skill-search",
      title: "Skill Search",
      type: "skill_search",
      body: matchedExistingSkill
        ? `匹配 ${skillTitle} ${skillCommand}，优先复用已有 SKILL.md 能力。`
        : "没有匹配到现有 Skill；进入 Skill Creator 自动生成候选 Skill Object。",
      x: 410,
      y: 210,
      status: matchedExistingSkill ? "ready" : "done"
    }),
    workGraphPlannerNode({
      id: "skill-create",
      title: "Skill Creator",
      type: "skill_create",
      body: matchedExistingSkill
        ? "已有 Skill 可覆盖当前目标；如失败再沉淀新的 SKILL.md、测试样例和回退模型。"
        : `已创建候选 Skill ${skillCommand}：输入品牌上下文、Asset Object、输出 ${output}。`,
      x: 410,
      y: 380,
      status: "done"
    }),
    workGraphPlannerNode({
      id: "model-router",
      title: `Model Router · ${routingDecision.selectedModelId}`,
      type: "model_select",
      body: [routingDecision.reason, videoGuardNote].filter(Boolean).join("\n"),
      x: 690,
      y: 72
    }),
    workGraphPlannerNode({
      id: "prompt-builder",
      title: "Prompt Builder",
      type: "prompt_generate",
      body: "合并 Goal、Brand Context、Asset Object、Skill 约束和 ModelPolicy，生成可追溯 PromptRecord。",
      x: 690,
      y: 190,
      materialIds: selectedIds
    }),
    workGraphPlannerNode({
      id: "workflow-runner",
      title: "Workflow Runner",
      type: "skill_execute",
      body: paidVideoLocked
        ? `执行 ${skillCommand || "候选 skill"}，生成 ${output} 本地预览计划；不请求 ${routingDecision.route}。`
        : `执行 ${skillCommand || "候选 skill"}，通过 ${routingDecision.route} 生成 ${output}。`,
      x: 690,
      y: 270,
      materialIds: selectedIds
    }),
    workGraphPlannerNode({
      id: "result-generator",
      title: `Generate ${output}`,
      type: generateNodeType,
      body: paidVideoLocked
        ? `生成 ${output} 可预览方案、分镜、文案和画面提示词；第一阶段不请求付费视频接口。`
        : `生成 ${output} Result Object，并写入本地结果、输出和日志目录。`,
      x: 880,
      y: 270,
      materialIds: selectedIds
    }),
    outputNode,
    workGraphPlannerNode({
      id: "human-review",
      title: "Human Review",
      type: "human_review",
      body: "用户检查 ResultObject、PromptRecord、日志和素材引用；可接管节点或写反馈。",
      x: 1180,
      y: 250,
      materialIds: selectedIds
    }),
    workGraphPlannerNode({
      id: "review-memory",
      title: "Feedback Memory",
      type: "feedback",
      body: "记录接受/修改原因，生成 Feedback Object 与 Memory Object，反哺下一次规划。",
      x: 1010,
      y: 392
    }),
    workGraphPlannerNode({
      id: "archive",
      title: "Archive",
      type: "archive",
      body: "归档 Result、PromptRecord、ExecutionLog、Skill 版本和反馈记忆到 data 目录与 SQLite。",
      x: 1180,
      y: 392
    })
  ];
  const goal = {
    ...workGraphGoalPayload(plannerWorkspace),
    rawInput: prompt,
    normalizedIntent: prompt,
    brandId: brandPayload.id,
    activeBrandId: brandPayload.id,
    activeModelId,
    outputTarget: output.toLowerCase(),
    successCriteria: [
      "workflow graph is persisted as Node Objects",
      "brand and asset references are explicit",
      "model routing decision is auditable",
      "result can be reviewed and saved as reusable material"
    ]
  };
  const workflow = {
    ...workGraphWorkflowPayload(plannerWorkspace),
    id: objectString(workspace.workflow, "id", "workflow-active"),
    title: "Planned WorkGraph workflow",
    goalId: objectString(goal, "id", "active"),
    status: "ready",
    prompt,
    nodeIds: nodes.map((node) => node.id),
    edgeIds: nodes.slice(1).map((node, index) => `${nodes[index].id}->${node.id}`),
    selectedMaterialIds: selectedIds,
    skillIds: skillId ? [skillId] : [],
    modelIds: [routingDecision.selectedModelId],
    outputTarget: output,
    runCount: objectField(workspace.workflow, "runCount") ?? workspace.jobs.length,
    updatedAt: createdAt
  };
  const memory = {
    id: `mem-plan-${Date.now().toString(36)}-${nanoid(6)}`,
    title: "Planned workflow graph",
    source: "planner",
    sourceType: "workflow",
    sourceId: objectString(workflow, "id", "workflow-active"),
    targetType: "workflow",
    targetId: objectString(workflow, "id", "workflow-active"),
    confidence: 0.72,
    reusable: true,
    body: `Planned ${nodes.length} nodes for ${output} via ${routingDecision.selectedModelId}.`,
    createdAt
  };
  const nextWorkspace: WorkGraphOsWorkspace = {
    ...workspace,
    prompt,
    activeBrandId: brandPayload.id,
    activeModelId,
    selectedIds,
    activeMaterialId: workspace.activeMaterialId || selectedIds[0] || "",
    goal,
    workflow,
    skills: nextSkills,
    nodes,
    memories: [memory, ...workspace.memories],
    updatedAt: createdAt
  };
  return {
    plan: {
      id: `plan-${Date.now().toString(36)}-${nanoid(6)}`,
      source: "workgraph-workflow-planner",
      prompt,
      brandId: brandPayload.id,
      output,
      nodeIds: nodes.map((node) => node.id),
      selectedMaterialIds: selectedIds,
      avoidedAssetIds,
      assetSelectionReason: avoidedAssetNote || "未发现 feedback-avoid Asset Object。",
      skillId,
      createdSkillId: candidateSkill ? objectString(candidateSkill, "id", "") : "",
      routingDecision,
      createdAt
    },
    workspace: nextWorkspace,
    routingDecision,
    memory
  };
}

function buildWorkGraphOsExecution(workspace: WorkGraphOsWorkspace, input: z.infer<typeof workGraphOsRunSchema>) {
  const createdAt = now();
  const node = workspace.nodes.find((item) => objectString(item, "id", "") === input.nodeId)
    ?? workspace.nodes.find((item) => objectString(item, "type", "") === "output")
    ?? workspace.nodes[0]
    ?? { id: "workflow", title: "Workflow", type: "workflow", body: workspace.prompt, status: "ready" };
  const nodeId = objectString(node, "id", "workflow");
  const nodeTitle = objectString(node, "title", "Workflow");
  const workflowId = objectString(workspace.workflow, "id", "workflow-active");
  const skill = workGraphFindSkillForNode(workspace, node);
  const skillId = objectString(skill, "id", "skill-auto");
  const output = workGraphDefaultOutput(workspace, node);
  const routingDecision = buildWorkGraphModelRoutingDecision(workspace, node, output);
  const materialIds = objectStringArray(node, "materialIds").length ? objectStringArray(node, "materialIds") : workspace.selectedIds;
  const nodePrompt = objectString(node, "body", "").trim();
  const effectivePrompt = nodePrompt || workspace.prompt;
  const jobId = `job-${Date.now().toString(36)}-${nanoid(6)}`;
  const resultId = `result-${Date.now().toString(36)}-${nanoid(6)}`;
  const executionId = `wgos-run-${Date.now().toString(36)}-${nanoid(6)}`;
  const promptRecordId = `prompt-${Date.now().toString(36)}-${nanoid(6)}`;
  const resolvedBrandId = resolveWorkGraphBrandId(workspace.activeBrandId, workspace.prompt);
  const brandPayload = workGraphBrandPayload(findBrand(resolvedBrandId), resolvedBrandId);
  const selectedAssets = materialIds.map((id) => {
    const dbAsset = db.assets.find((asset) => asset.id === id);
    if (dbAsset) return workGraphAssetPayload(dbAsset);
    const material = workspace.materials.find((item) => objectString(item, "id", "") === id);
    return material ?? { id };
  });
  const nodeParams = objectField(node, "params") && typeof objectField(node, "params") === "object"
    ? objectField(node, "params") as Record<string, unknown>
    : {};
  // Resolve selected materials to real local filesystem paths so pi can read
  // them. `dataPath` is the absolute path under data/assets written on upload.
  const inputFiles = selectedAssets
    .map((asset) => ({
      token: objectString(asset, "token", objectString(asset, "id", "")),
      path: objectString(asset, "dataPath", objectString(asset, "localPath", ""))
    }))
    .filter((entry) => entry.path && existsSync(entry.path));
  const promptRecord = {
    id: promptRecordId,
    executionId,
    workflowId,
    nodeId,
    nodeTitle,
    sourcePrompt: effectivePrompt,
    workspacePrompt: workspace.prompt,
    nodePrompt,
    finalPrompt: [
      effectivePrompt,
      "",
      "Brand Context:",
      brandPayload.context,
      "",
      `Node: ${nodeTitle}`,
      nodePrompt,
      "",
      inputFiles.length ? "Input Files:" : "",
      ...inputFiles.map((entry) => `- ${entry.token || "asset"}: ${entry.path}`),
      inputFiles.length ? "" : "",
      `Output: ${output}`
    ].filter(Boolean).join("\n"),
    brandId: brandPayload.id,
    brandContext: brandPayload.context,
    materialIds,
    inputFiles,
    assets: selectedAssets,
    skillId,
    skill: skill ? workGraphNormalizeSkill(skill) : null,
    modelId: routingDecision.selectedModelId,
    requestedModelId: routingDecision.requestedModelId,
    modelStrategy: routingDecision.strategy,
    modelPolicy: routingDecision,
    nodeParams,
    output,
    createdAt
  };
  const runtime = runWorkGraphSkill({
    mode: input.mode,
    prompt: effectivePrompt,
    output,
    node: {
      id: nodeId,
      title: nodeTitle,
      type: objectString(node, "type", "skill_execute"),
      body: [
        nodePrompt,
        Object.keys(nodeParams).length ? `\nNode Parameters:\n${JSON.stringify(nodeParams, null, 2)}` : ""
      ].filter(Boolean).join("\n")
    },
    workflowId,
    skill: skill ? {
      id: skillId,
      title: objectString(skill, "title", "Skill"),
      command: objectString(skill, "command", ""),
      output: objectString(skill, "output", output),
      skillMdPath: objectString(skill, "skillMdPath", ""),
      runtime: objectString(skill, "runtime", "pi-skill")
    } : null,
    modelPolicy: routingDecision,
    brand: {
      id: brandPayload.id,
      name: brandPayload.name,
      context: brandPayload.context
    },
    assets: selectedAssets.map((asset) => ({
      id: objectString(asset, "id", ""),
      title: objectString(asset, "title", ""),
      kind: objectString(asset, "kind", objectString(asset, "type", "")),
      type: objectString(asset, "type", ""),
      token: objectString(asset, "token", ""),
      referencePath: objectString(asset, "referencePath", ""),
      tags: objectStringArray(asset, "tags")
    })),
    materialIds,
    nodeParams,
    now
  });
  const piContext = {
    source: "pi-adapter",
    goal: effectivePrompt,
    workspaceGoal: workspace.prompt,
    workflowId,
    node: {
      id: nodeId,
      title: nodeTitle,
      type: objectString(node, "type", "skill_execute"),
      body: objectString(node, "body", ""),
      params: nodeParams
    },
    brand: brandPayload,
    assets: selectedAssets,
    skill: skill ? workGraphNormalizeSkill(skill) : null,
    modelPolicy: routingDecision,
    promptRecord,
    localPaths: {
      piDir: workGraphOsPiDir,
      skillDir: skill ? path.join(workGraphOsPiDir, "skills", piSkillFolderName(skill)) : path.join(workGraphOsPiDir, "skills"),
      mirrorSkillDir: skill ? path.join(workGraphOsSkillDataDir, piSkillFolderName(skill)) : workGraphOsSkillDataDir,
      sessionsDir: path.join(workGraphOsPiDir, "sessions")
    }
  };
  const job = {
    id: jobId,
    title: input.mode === "workflow" ? "Backend workflow run" : `Run ${nodeTitle}`,
    status: runtime.status,
    output: runtime.output,
    preview: runtime.preview,
    materials: materialIds,
    nodeId,
    workflowId,
    skillId,
    modelId: routingDecision.selectedModelId,
    requestedModelId: routingDecision.requestedModelId,
    modelStrategy: routingDecision.strategy,
    promptRecordId,
    routingDecision,
    executor: runtime.executor,
    simulated: true,
    bridge: { mode: "simulated", reachable: false, baseUrl: "", reason: "pi-web bridge not yet applied", piSessionId: "" },
    note: input.note ?? "",
    createdAt,
    completedAt: createdAt
  };
  const result = {
    id: resultId,
    title: `${nodeTitle} result`,
    goalId: objectString(workGraphGoalPayload(workspace), "id", "active"),
    workflowId,
    nodeId,
    nodeTitle,
    kind: workGraphResultKind(output),
    status: "preview",
    version: workspace.results.filter((item) => objectString(item, "nodeId", "") === nodeId).length + 1,
    output: runtime.preview,
    previewUrl: workGraphResultKind(output) === "image" ? "/brand-assets/generated/xmanx-product.png" : "",
    sourceJobId: jobId,
    executionId,
    promptRecordId,
    brandId: brandPayload.id,
    materialIds,
    skillId,
    modelId: routingDecision.selectedModelId,
    requestedModelId: routingDecision.requestedModelId,
    canSaveAsMaterial: true,
    executor: runtime.executor,
    simulated: true,
    bridge: { mode: "simulated", reachable: false, baseUrl: "", reason: "pi-web bridge not yet applied", piSessionId: "" },
    routingDecision,
    modelStrategy: routingDecision.strategy,
    nodeParams,
    promptRecord,
    trace: {
      goalId: objectString(workGraphGoalPayload(workspace), "id", "active"),
      workflowId,
      nodeId,
      brandId: brandPayload.id,
      materialIds,
      skillId,
      modelId: routingDecision.selectedModelId,
      nodeParams,
      piContext,
      promptRecordId,
      executionId,
      feedbackIds: [] as string[]
    },
    createdAt,
    updatedAt: createdAt
  };
  const memory = {
    id: `mem-${Date.now().toString(36)}-${nanoid(6)}`,
    title: `Executed ${nodeTitle}`,
    source: "run",
    sourceType: "workflow",
    sourceId: workflowId,
    targetType: "result",
    targetId: resultId,
    confidence: 0.6,
    reusable: false,
    body: `${job.title} -> ${runtime.output} via ${skillId} and ${routingDecision.selectedModelId}: ${routingDecision.reason}`,
    createdAt
  };
  const runtimeLogEntries = runtime.logs.map((entry, index) => ({
    id: `${executionId}-runtime-${index + 1}`,
    executionId,
    step: entry.step,
    status: "done",
    nodeId,
    workflowId,
    message: entry.message,
    payload: entry.payload,
    createdAt
  }));
  const executionLog = [
    {
      id: `${executionId}-plan`,
      executionId,
      step: "plan",
      status: "done",
      nodeId,
      workflowId,
      message: `Resolved node ${nodeTitle} with output ${output}.`,
      payload: { mode: input.mode, materialIds, promptRecordId },
      createdAt
    },
    {
      id: `${executionId}-route`,
      executionId,
      step: "route",
      status: "done",
      nodeId,
      workflowId,
      message: routingDecision.reason,
      payload: routingDecision,
      createdAt
    },
    {
      id: `${executionId}-execute`,
      executionId,
      step: "execute",
      status: "done",
      nodeId,
      workflowId,
      message: output === "MP4"
        ? `Preview-only execution for ${skillId}; no paid yijia request was sent.`
        : `Executed ${skillId} through ${routingDecision.route}.`,
      payload: { skillId, modelId: routingDecision.selectedModelId, jobId, promptRecordId, previewOnly: output === "MP4" },
      createdAt
    },
    ...runtimeLogEntries,
    {
      id: `${executionId}-result`,
      executionId,
      step: "result",
      status: "done",
      nodeId,
      workflowId,
      message: `Created Result Object ${resultId}.`,
      payload: { resultId, promptRecordId, output, kind: workGraphResultKind(output) },
      createdAt
    }
  ];
  const workflow = workspace.workflow && typeof workspace.workflow === "object"
    ? {
        ...(workspace.workflow as Record<string, unknown>),
        status: "completed",
        runCount: Number(objectField(workspace.workflow, "runCount") ?? 0) + 1,
        lastRunAt: createdAt,
        resultIds: [resultId, ...objectStringArray(workspace.workflow, "resultIds")]
      }
    : workspace.workflow;
  const nextWorkspace: WorkGraphOsWorkspace = {
    ...workspace,
    workflow,
    nodes: workspace.nodes.map((item) => objectString(item, "id", "") === nodeId ? { ...(item as Record<string, unknown>), status: "done" } : item),
    skills: workspace.skills.map((item) => objectString(item, "id", "") === skillId ? withWorkGraphSkillEvolution(item, {
      type: "run",
      status: runtime.status,
      executionId,
      nodeId,
      workflowId,
      resultId,
      jobId,
      modelId: routingDecision.selectedModelId,
      output
    }) : item),
    jobs: [job, ...workspace.jobs],
    results: [result, ...workspace.results],
    promptRecords: [promptRecord, ...(workspace.promptRecords ?? [])].slice(0, 500),
    memories: [memory, ...workspace.memories],
    executionLog: [...executionLog, ...(workspace.executionLog ?? [])].slice(0, 500),
    updatedAt: createdAt
  };
  const execution: WorkGraphOsExecution = {
    id: executionId,
    mode: input.mode,
    nodeId,
    nodeTitle,
    workflowId,
    modelId: routingDecision.selectedModelId,
    skillId,
    jobId,
    resultId,
    status: "done",
    executor: runtime.executor,
    simulated: true,
    bridge: { mode: "simulated", reachable: false, baseUrl: "", reason: "pi-web bridge not yet applied", piSessionId: "" },
    createdAt
  };
  return { execution, workspace: nextWorkspace, job, result, memory, promptRecord, routingDecision, executionLog, piSessionId: `pi-session-${executionId}` };
}

function workGraphObject(
  type: WorkGraphOsObjectType,
  fallbackId: string,
  title: string,
  summary: string,
  payload: unknown,
  updatedAt: string,
  source: WorkGraphOsObject["source"] = "workspace"
): WorkGraphOsObject {
  const rawId = objectString(payload, "id", fallbackId);
  return {
    id: `${type}:${rawId || fallbackId}`,
    type,
    title: title || rawId || fallbackId,
    summary,
    source,
    updatedAt,
    payload
  };
}

function workGraphGoalPayload(workspace: WorkGraphOsWorkspace) {
  const existing = workspace.goal && typeof workspace.goal === "object" ? workspace.goal : undefined;
  return {
    id: objectString(existing, "id", "active"),
    title: objectString(existing, "title", "Active Goal"),
    rawInput: objectString(existing, "rawInput", workspace.prompt),
    normalizedIntent: objectString(existing, "normalizedIntent", workspace.prompt || "No goal prompt"),
    goalType: objectString(existing, "goalType", "workflow_automation"),
    brandId: objectString(existing, "brandId", workspace.activeBrandId),
    outputTarget: objectString(existing, "outputTarget", "png"),
    constraints: objectField(existing, "constraints") ?? [],
    successCriteria: objectField(existing, "successCriteria") ?? [],
    activeBrandId: workspace.activeBrandId,
    activeModelId: workspace.activeModelId
  };
}

function workGraphWorkflowPayload(workspace: WorkGraphOsWorkspace) {
  const existing = workspace.workflow && typeof workspace.workflow === "object" ? workspace.workflow : undefined;
  const nodeIds = objectField(existing, "nodeIds") ?? workspace.nodes.map((item, index) => `node:${objectString(item, "id", `node-${index}`)}`);
  const resultIds = objectField(existing, "resultIds") ?? (workspace.results.length ? workspace.results : workspace.jobs).map((item, index) => objectString(item, "id", `result-${index}`));
  return {
    id: objectString(existing, "id", "active"),
    title: objectString(existing, "title", "Active Workflow"),
    goalId: objectString(existing, "goalId", "active"),
    version: objectString(existing, "version", "0.1.0"),
    status: objectString(existing, "status", workspace.jobs.length ? "running" : "ready"),
    reusable: Boolean(objectField(existing, "reusable")),
    prompt: objectString(existing, "prompt", workspace.prompt),
    nodeIds,
    edgeIds: objectField(existing, "edgeIds") ?? [],
    selectedMaterialIds: objectField(existing, "selectedMaterialIds") ?? workspace.selectedIds,
    skillIds: objectField(existing, "skillIds") ?? workspace.skills.map((item, index) => objectString(item, "id", `skill-${index}`)),
    modelIds: objectField(existing, "modelIds") ?? [workspace.activeModelId],
    resultIds,
    runCount: objectField(existing, "runCount") ?? Math.max(workspace.jobs.length, workspace.results.length),
    lastRunAt: objectString(existing, "lastRunAt", ""),
    jobs: workspace.jobs
  };
}

function buildWorkGraphOsObjectIndex(workspace: WorkGraphOsWorkspace | null) {
  if (!workspace) return { counts: {}, objects: [] as WorkGraphOsObject[] };
  const updatedAt = workspace.updatedAt || now();
  const goalPayload = workGraphGoalPayload(workspace);
  const workflowPayload = workGraphWorkflowPayload(workspace);
  const brandPayload = workGraphBrandPayload(findBrand(workspace.activeBrandId), workspace.activeBrandId);
  const objects: WorkGraphOsObject[] = [
    workGraphObject("goal", "active", goalPayload.title, goalPayload.normalizedIntent || goalPayload.rawInput || "No goal prompt", goalPayload, updatedAt, workspace.goal ? "workspace" : "derived"),
    workGraphObject("brand", workspace.activeBrandId || "active", brandPayload.name, `${brandPayload.source} · ${brandPayload.positioning}`, brandPayload, updatedAt, "derived"),
    workGraphObject("model", workspace.activeModelId || "active", `Model ${workspace.activeModelId || "active"}`, `Active model strategy: ${workspace.activeModelId || "unset"}`, {
      id: workspace.activeModelId || "active",
      activeModelId: workspace.activeModelId,
      routingPolicy: "match node capability first, then fallback by availability and cost",
      modelCatalog: workGraphModelCatalog(workspace).map((item) => ({
        id: item.id,
        status: item.status,
        capabilities: item.capabilities,
        fallbackModelIds: item.fallbackModelIds,
        nodeAffinity: item.nodeAffinity,
        route: item.route
      })),
      lastRoutingDecision: objectField(workspace.jobs[0], "routingDecision") ?? objectField(workspace.results[0], "routingDecision") ?? null
    }, updatedAt, "derived"),
    workGraphObject("workflow", "active", workflowPayload.title, `${workflowPayload.status} · ${workflowPayload.runCount} run(s) · ${workspace.selectedIds.length} selected asset(s)`, workflowPayload, updatedAt, workspace.workflow ? "workspace" : "derived")
  ];
  const pushUniqueObject = (object: WorkGraphOsObject) => {
    if (!objects.some((item) => item.id === object.id)) objects.push(object);
  };
  const referencedBrandIds = Array.from(new Set([
    workspace.activeBrandId,
    ...workspace.results.map((item) => objectString(item, "brandId", "") || objectString(objectField(item, "trace"), "brandId", "")),
    ...(workspace.promptRecords ?? []).map((item) => objectString(item, "brandId", "")),
    ...workspace.feedback.map((item) => objectString(item, "brandId", ""))
  ].filter(Boolean)));
  referencedBrandIds.forEach((brandId) => {
    const payload = workGraphBrandPayload(findBrand(brandId), brandId);
    pushUniqueObject(workGraphObject("brand", brandId, payload.name, `${payload.source} · ${payload.positioning}`, payload, updatedAt, "derived"));
  });
  const modelCatalog = workGraphModelCatalog(workspace);
  const referencedModelIds = Array.from(new Set([
    workspace.activeModelId,
    ...workspace.results.map((item) => objectString(item, "modelId", "") || objectString(objectField(item, "trace"), "modelId", "") || objectString(objectField(item, "routingDecision"), "selectedModelId", "")),
    ...(workspace.promptRecords ?? []).map((item) => objectString(item, "modelId", "")),
    ...(workspace.modelPolicies ?? []).map((item) => objectString(item, "modelId", ""))
  ].filter(Boolean)));
  referencedModelIds.forEach((modelId) => {
    const model = modelCatalog.find((item) => item.id === modelId);
    pushUniqueObject(workGraphObject("model", modelId, `Model ${modelId}`, `Referenced model strategy: ${modelId}`, {
      id: modelId,
      activeModelId: modelId,
      routingPolicy: "referenced by Result, PromptRecord or ModelPolicy",
      status: model?.status ?? "referenced",
      capabilities: model?.capabilities ?? [],
      fallbackModelIds: model?.fallbackModelIds ?? [],
      nodeAffinity: model?.nodeAffinity ?? [],
      route: model?.route ?? ""
    }, updatedAt, "derived"));
  });
  workspace.materials.forEach((item, index) => {
    objects.push(workGraphObject("asset", `asset-${index}`, objectString(item, "title", `Asset ${index + 1}`), objectString(item, "token", objectString(item, "fileName", "")), item, objectString(item, "createdAt", updatedAt)));
  });
  db.assets
    .filter((asset) => !workspace.materials.some((item) => objectString(item, "id", "") === asset.id))
    .slice(0, 50)
    .forEach((asset) => {
      const payload = workGraphAssetPayload(asset);
      objects.push(workGraphObject("asset", asset.id, payload.title, `${payload.token} · ${payload.source}`, payload, payload.createdAt, "derived"));
    });
  workGraphSkillCatalog(workspace).forEach((item, index) => {
    const command = objectString(item, "command", "");
    const capabilityType = objectString(item, "capabilityType", "custom");
    const skillMdPath = objectString(item, "skillMdPath", "");
    const summary = [command, capabilityType, skillMdPath].filter(Boolean).join(" · ") || objectString(item, "description", "");
    objects.push(workGraphObject("skill", `skill-${index}`, objectString(item, "title", `Skill ${index + 1}`), summary, item, updatedAt));
  });
  workspace.nodes.forEach((item, index) => {
    const type = objectString(item, "type", "node");
    const status = objectString(item, "status", "ready");
    objects.push(workGraphObject("node", `node-${index}`, objectString(item, "title", `Node ${index + 1}`), `${type} · ${status} · ${objectString(item, "body", "")}`, item, updatedAt));
  });
  const resultItems = workspace.results.length ? workspace.results : workspace.jobs;
  resultItems.forEach((item, index) => {
    const version = objectField(item, "version") ?? 1;
    const kind = objectString(item, "kind", "result");
    objects.push(workGraphObject("result", `result-${index}`, objectString(item, "title", `Result ${index + 1}`), `${kind} v${version} · ${objectString(item, "status", "unknown")} -> ${objectString(item, "output", "")}`, item, objectString(item, "createdAt", updatedAt)));
  });
  (workspace.promptRecords ?? []).forEach((item, index) => {
    const modelId = objectString(item, "modelId", "");
    const skillId = objectString(item, "skillId", "");
    const nodeId = objectString(item, "nodeId", "");
    const summary = [`node:${nodeId}`, skillId ? `skill:${skillId}` : "", modelId ? `model:${modelId}` : "", objectString(item, "output", "")].filter(Boolean).join(" · ");
    objects.push(workGraphObject("prompt", `prompt-${index}`, `PromptRecord · ${nodeId || index + 1}`, summary, item, objectString(item, "createdAt", updatedAt)));
  });
  (workspace.modelPolicies ?? []).forEach((item, index) => {
    const modelId = objectString(item, "modelId", "");
    const strategy = objectString(item, "strategy", "");
    const targetType = objectString(item, "targetType", "");
    const targetId = objectString(item, "targetId", "");
    const summary = [strategy, modelId ? `model:${modelId}` : "", targetType && targetId ? `${targetType}:${targetId}` : "", objectString(item, "note", "")].filter(Boolean).join(" · ");
    objects.push(workGraphObject("model_policy", `model-policy-${index}`, `ModelPolicy · ${strategy || modelId || index + 1}`, summary, item, objectString(item, "updatedAt", updatedAt)));
  });
  workspace.feedback.forEach((item, index) => {
    const rating = objectString(item, "rating", `Feedback ${index + 1}`);
    const action = objectString(item, "action", "");
    const targetType = objectString(item, "targetType", "");
    const targetId = objectString(item, "targetId", "");
    const target = targetType && targetId ? `${targetType}:${targetId}` : "";
    const summary = [action, target, objectString(item, "note", "")].filter(Boolean).join(" · ");
    objects.push(workGraphObject("feedback", `feedback-${index}`, rating, summary, item, objectString(item, "createdAt", updatedAt)));
  });
  workspace.memories.forEach((item, index) => {
    const sourceType = objectString(item, "sourceType", objectString(item, "source", ""));
    const sourceId = objectString(item, "sourceId", "");
    const source = sourceType && sourceId ? `${sourceType}:${sourceId}` : sourceType;
    const confidence = objectField(item, "confidence");
    const reusable = objectField(item, "reusable");
    const summary = [source, confidence === undefined ? "" : `confidence:${confidence}`, reusable === undefined ? "" : `reusable:${reusable}`, objectString(item, "body", "")].filter(Boolean).join(" · ");
    objects.push(workGraphObject("memory", `memory-${index}`, objectString(item, "title", `Memory ${index + 1}`), summary, item, objectString(item, "createdAt", updatedAt)));
  });
  const counts = objects.reduce<Record<string, number>>((acc, object) => {
    acc[object.type] = (acc[object.type] ?? 0) + 1;
    return acc;
  }, {});
  return { counts, objects };
}

function workGraphObjectSnapshotDir(type: WorkGraphOsObjectType) {
  switch (type) {
    case "asset":
      return workGraphOsAssetDataDir;
    case "brand":
      return workGraphOsBrandDataDir;
    case "skill":
      return workGraphOsSkillDataDir;
    case "workflow":
      return workGraphOsWorkflowDataDir;
    case "node":
      return workGraphOsNodeDataDir;
    case "result":
      return workGraphOsResultDataDir;
    case "prompt":
      return workGraphOsPromptDataDir;
    case "feedback":
      return workGraphOsFeedbackDataDir;
    case "memory":
      return workGraphOsMemoryDataDir;
    case "model":
    case "model_policy":
      return workGraphOsModelDataDir;
    case "goal":
    default:
      return workGraphOsGoalDataDir;
  }
}

async function syncWorkGraphOsObjectSnapshots(workspace: WorkGraphOsWorkspace | null) {
  if (!workspace) return;
  const { counts, objects } = buildWorkGraphOsObjectIndex(workspace);
  const grouped = objects.reduce<Record<string, WorkGraphOsObject[]>>((acc, object) => {
    acc[object.type] = [...(acc[object.type] ?? []), object];
    return acc;
  }, {});
  const dirTypes = Object.keys(grouped).reduce<Record<string, string[]>>((acc, type) => {
    const dir = workGraphObjectSnapshotDir(type as WorkGraphOsObjectType);
    acc[dir] = [...(acc[dir] ?? []), type];
    return acc;
  }, {});
  await Promise.all(Object.entries(grouped).map(async ([type, items]) => {
    const dir = workGraphObjectSnapshotDir(type as WorkGraphOsObjectType);
    const indexName = (dirTypes[dir]?.length ?? 0) > 1 ? `_${type}-index.json` : "_index.json";
    await mkdir(dir, { recursive: true });
    await writeJsonAtomic(path.join(dir, indexName), {
      type,
      count: items.length,
      updatedAt: workspace.updatedAt,
      objects: items.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        source: item.source,
        updatedAt: item.updatedAt,
        file: `${safeWorkGraphRelativePath(item.id.replace(":", "-")) || "object"}.json`
      }))
    });
    await Promise.all(items.map((item) => writeJsonAtomic(
      path.join(dir, `${safeWorkGraphRelativePath(item.id.replace(":", "-")) || "object"}.json`),
      item
    )));
  }));
  await writeJsonAtomic(workGraphOsSnapshotFile, {
    updatedAt: workspace.updatedAt,
    counts,
    directories: {
      goals: workGraphOsGoalDataDir,
      assets: workGraphOsAssetDataDir,
      brands: workGraphOsBrandDataDir,
      skills: workGraphOsSkillDataDir,
      models: workGraphOsModelDataDir,
      workflows: workGraphOsWorkflowDataDir,
      nodes: workGraphOsNodeDataDir,
      results: workGraphOsResultDataDir,
      feedback: workGraphOsFeedbackDataDir,
      memory: workGraphOsMemoryDataDir,
      prompts: workGraphOsPromptDataDir,
      logs: workGraphOsLogDataDir,
      db: path.dirname(workGraphOsDbFile)
    }
  });
}

function buildWorkGraphOsEdges(workspace: WorkGraphOsWorkspace | null, objects: WorkGraphOsObject[]) {
  if (!workspace) return [] as WorkGraphOsEdge[];
  const updatedAt = workspace.updatedAt || now();
  const objectIds = new Set(objects.map((object) => object.id));
  const goalObjectId = `goal:${workGraphGoalPayload(workspace).id}`;
  const workflowObjectId = `workflow:${workGraphWorkflowPayload(workspace).id}`;
  const edges: WorkGraphOsEdge[] = [];
  const pushEdge = (fromObjectId: string, toObjectId: string, relation: WorkGraphOsEdge["relation"], payload: unknown = {}) => {
    if (!objectIds.has(fromObjectId) || !objectIds.has(toObjectId)) return;
    const id = `${fromObjectId}->${relation}->${toObjectId}`;
    if (edges.some((edge) => edge.id === id)) return;
    edges.push({
      id,
      fromObjectId,
      toObjectId,
      relation,
      updatedAt,
      payload
    });
  };

  pushEdge(goalObjectId, `brand:${workspace.activeBrandId || "active"}`, "uses_brand", { activeBrandId: workspace.activeBrandId });
  pushEdge(goalObjectId, `model:${workspace.activeModelId || "active"}`, "uses_model", { activeModelId: workspace.activeModelId });
  workspace.selectedIds.forEach((id) => {
    pushEdge(workflowObjectId, `asset:${id}`, "uses_asset", { selectedId: id });
  });
  workspace.nodes.forEach((item, index) => {
    const id = objectString(item, "id", `node-${index}`);
    pushEdge(workflowObjectId, `node:${id}`, "produces_result", item);
    const materialIds = objectField(item, "materialIds");
    if (Array.isArray(materialIds)) {
      materialIds.forEach((materialId) => {
        if (typeof materialId === "string") pushEdge(`node:${id}`, `asset:${materialId}`, "uses_asset", { materialId });
      });
    }
  });
  const resultItems = workspace.results.length ? workspace.results : workspace.jobs;
  resultItems.forEach((item, index) => {
    const id = objectString(item, "id", `result-${index}`);
    pushEdge(workflowObjectId, `result:${id}`, "produces_result", item);
    const promptRecordId = objectString(item, "promptRecordId", "");
    if (promptRecordId) pushEdge(`result:${id}`, `prompt:${promptRecordId}`, "uses_prompt", item);
    const trace = objectField(item, "trace");
    const brandId = objectString(item, "brandId", "") || objectString(trace, "brandId", "");
    const skillId = objectString(item, "skillId", "") || objectString(trace, "skillId", "");
    const modelId = objectString(item, "modelId", "") || objectString(trace, "modelId", "");
    const nodeId = objectString(item, "nodeId", "") || objectString(trace, "nodeId", "");
    if (brandId) pushEdge(`result:${id}`, `brand:${brandId}`, "uses_brand", item);
    if (skillId) pushEdge(`result:${id}`, `skill:${skillId}`, "uses_skill", item);
    if (modelId) pushEdge(`result:${id}`, `model:${modelId}`, "uses_model", item);
    if (nodeId) pushEdge(`result:${id}`, `node:${nodeId}`, "uses_node", item);
    objectStringArray(item, "materialIds").forEach((materialId) => pushEdge(`result:${id}`, `asset:${materialId}`, "uses_asset", item));
    Array.from(new Set([...objectStringArray(item, "feedbackIds"), ...objectStringArray(trace, "feedbackIds")]))
      .forEach((feedbackId) => pushEdge(`feedback:${feedbackId}`, `result:${id}`, "comments_on", item));
  });
  (workspace.promptRecords ?? []).forEach((item, index) => {
    const id = objectString(item, "id", `prompt-${index}`);
    const nodeId = objectString(item, "nodeId", "");
    const skillId = objectString(item, "skillId", "");
    const modelId = objectString(item, "modelId", "");
    const brandId = objectString(item, "brandId", "");
    if (nodeId) pushEdge(`prompt:${id}`, `node:${nodeId}`, "uses_node", item);
    if (skillId) pushEdge(`prompt:${id}`, `skill:${skillId}`, "uses_skill", item);
    if (modelId) pushEdge(`prompt:${id}`, `model:${modelId}`, "uses_model", item);
    if (brandId) pushEdge(`prompt:${id}`, `brand:${brandId}`, "uses_brand", item);
    objectStringArray(item, "materialIds").forEach((materialId) => pushEdge(`prompt:${id}`, `asset:${materialId}`, "uses_asset", item));
  });
  (workspace.modelPolicies ?? []).forEach((item, index) => {
    const id = objectString(item, "id", `model-policy-${index}`);
    const modelId = objectString(item, "modelId", "");
    const targetType = objectString(item, "targetType", "");
    const targetId = objectString(item, "targetId", "");
    const feedbackId = objectString(item, "feedbackId", "");
    if (modelId) pushEdge(`model_policy:${id}`, `model:${modelId}`, "uses_model", item);
    if (targetType && targetId) pushEdge(`model_policy:${id}`, `${targetType}:${targetId}`, "comments_on", item);
    if (feedbackId) pushEdge(`model_policy:${id}`, `feedback:${feedbackId}`, "remembers", item);
  });
  workspace.feedback.forEach((item, index) => {
    const id = objectString(item, "id", `feedback-${index}`);
    const targetType = objectString(item, "targetType", "");
    const targetId = objectString(item, "targetId", "");
    if (targetType && targetId) pushEdge(`feedback:${id}`, `${targetType}:${targetId}`, "comments_on", item);
  });
  workspace.memories.forEach((item, index) => {
    const id = objectString(item, "id", `memory-${index}`);
    const sourceType = objectString(item, "sourceType", "feedback");
    const sourceId = objectString(item, "sourceId", "");
    if (sourceId) pushEdge(`memory:${id}`, `${sourceType}:${sourceId}`, "remembers", item);
  });
  return edges;
}







function buildWorkGraphOsSqliteScript(exportPayload: WorkGraphOsSqliteExport) {
  const lines = [
    "PRAGMA journal_mode=WAL;",
    "PRAGMA foreign_keys=ON;",
    "BEGIN IMMEDIATE;"
  ];
  exportPayload.tables.forEach((table) => {
    lines.push(table.createSql);
    lines.push(`DELETE FROM ${table.name};`);
    table.rows.forEach((row) => {
      const keys = Object.keys(row);
      const columns = keys.map((key) => `"${key}"`).join(", ");
      const values = keys.map((key) => sqliteSqlValue(row[key])).join(", ");
      lines.push(`INSERT INTO ${table.name} (${columns}) VALUES (${values});`);
    });
  });
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

// SQLite write path. JSON remains the authoritative store; SQLite is a mirror.
// The writer is resolved once (sqlite3 CLI -> node:sqlite -> json-only) so a
// deploy host without the sqlite3 binary degrades gracefully instead of failing
// every workspace save / run / history append.
type WorkGraphSqliteWriter = "sqlite3-cli" | "node-sqlite" | "json-only";
const workGraphOsSqliteState: { writer: WorkGraphSqliteWriter | null; lastSyncedAt: string; lastError: string } = {
  writer: null,
  lastSyncedAt: "",
  lastError: ""
};

function resolveWorkGraphSqliteWriter(): WorkGraphSqliteWriter {
  if (workGraphOsSqliteState.writer) return workGraphOsSqliteState.writer;
  const override = (process.env.WGOS_SQLITE_WRITER ?? "").trim().toLowerCase();
  if (override === "off" || override === "json-only") return (workGraphOsSqliteState.writer = "json-only");
  if (override === "node" || override === "node-sqlite") return (workGraphOsSqliteState.writer = "node-sqlite");
  if (override !== "cli" && override !== "sqlite3-cli") {
    // Auto-detect when not forced.
    const cli = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
    if (cli.status === 0) return (workGraphOsSqliteState.writer = "sqlite3-cli");
    try {
      // node:sqlite ships with Node >= 22; require synchronously to detect it.
      createRequire(import.meta.url)("node:sqlite");
      return (workGraphOsSqliteState.writer = "node-sqlite");
    } catch {
      return (workGraphOsSqliteState.writer = "json-only");
    }
  }
  const cli = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  return (workGraphOsSqliteState.writer = cli.status === 0 ? "sqlite3-cli" : "json-only");
}

async function syncWorkGraphOsSqlite(exportPayload: WorkGraphOsSqliteExport) {
  await mkdir(path.dirname(workGraphOsDbFile), { recursive: true });
  const script = buildWorkGraphOsSqliteScript(exportPayload);
  const writer = resolveWorkGraphSqliteWriter();
  try {
    if (writer === "sqlite3-cli") {
      const sqlite = spawnSync("sqlite3", [workGraphOsDbFile], { input: script, encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
      if (sqlite.status !== 0) throw new Error(`sqlite3 CLI sync failed: ${(sqlite.stderr || sqlite.stdout || "unknown error").trim()}`);
    } else if (writer === "node-sqlite") {
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void } };
      const database = new DatabaseSync(workGraphOsDbFile);
      try {
        database.exec(script);
      } finally {
        database.close();
      }
    } else {
      // json-only: SQLite tooling unavailable; JSON store is already persisted.
      workGraphOsSqliteState.lastError = "sqlite3 CLI and node:sqlite unavailable; JSON remains authoritative";
      return;
    }
    workGraphOsSqliteState.lastSyncedAt = now();
    workGraphOsSqliteState.lastError = "";
  } catch (error) {
    // Never fail the calling save/run: the JSON store is authoritative.
    workGraphOsSqliteState.lastError = (error as Error).message;
    console.warn(`WorkGraph SQLite sync (${writer}) failed; JSON remains authoritative: ${(error as Error).message}`);
  }
}

// Read-only query against the mirrored SQLite DB (T12). Returns parsed rows, or
// null when SQLite is unavailable so callers fall back to the JSON index. Uses
// the same writer detection (sqlite3 CLI -json, else node:sqlite).
function queryWorkGraphOsSqlite(sql: string): Array<Record<string, unknown>> | null {
  if (!existsSync(workGraphOsDbFile)) return null;
  const writer = resolveWorkGraphSqliteWriter();
  try {
    if (writer === "sqlite3-cli") {
      const out = spawnSync("sqlite3", ["-json", workGraphOsDbFile, sql], { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
      if (out.status !== 0) return null;
      const text = (out.stdout || "").trim();
      if (!text) return [];
      return JSON.parse(text) as Array<Record<string, unknown>>;
    }
    if (writer === "node-sqlite") {
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => { prepare(sql: string): { all(): Array<Record<string, unknown>> }; close(): void } };
      const database = new DatabaseSync(workGraphOsDbFile);
      try {
        return database.prepare(sql).all();
      } finally {
        database.close();
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Build the object index from SQLite (wgos_objects) when SQLite reads are enabled.
// Returns null on any miss so the caller uses the JSON-derived index.
function readWorkGraphOsObjectIndexFromSqlite(): { counts: Record<string, number>; objects: WorkGraphOsObject[] } | null {
  if (!workGraphOsSqliteReadEnabled) return null;
  const rows = queryWorkGraphOsSqlite("SELECT id, type, title, summary, source, updated_at, payload_json FROM wgos_objects");
  if (!rows || !rows.length) return null;
  const objects: WorkGraphOsObject[] = rows.map((row) => {
    let payload: unknown = {};
    try { payload = JSON.parse(objectString(row, "payload_json", "{}")); } catch { payload = {}; }
    return {
      id: objectString(row, "id", ""),
      type: objectString(row, "type", "") as WorkGraphOsObject["type"],
      title: objectString(row, "title", ""),
      summary: objectString(row, "summary", ""),
      source: objectString(row, "source", "sqlite") as WorkGraphOsObject["source"],
      updatedAt: objectString(row, "updated_at", ""),
      payload
    };
  });
  const counts: Record<string, number> = {};
  for (const object of objects) counts[object.type] = (counts[object.type] ?? 0) + 1;
  return { counts, objects };
}

function workGraphOsExecutionLogRows(workspace: WorkGraphOsWorkspace | null) {
  return (workspace?.executionLog ?? []).map((entry, index) => {
    const id = objectString(entry, "id", `execution-log-${index}`);
    return {
      id,
      execution_id: objectString(entry, "executionId", ""),
      step: objectString(entry, "step", ""),
      status: objectString(entry, "status", ""),
      node_id: objectString(entry, "nodeId", ""),
      workflow_id: objectString(entry, "workflowId", ""),
      message: objectString(entry, "message", ""),
      created_at: objectString(entry, "createdAt", workspace?.updatedAt || ""),
      payload_json: sqliteJson(objectField(entry, "payload") ?? entry)
    };
  });
}

function buildWorkGraphOsSqliteExport(workspace: WorkGraphOsWorkspace | null, history: WorkGraphOsHistoryEntry[]): WorkGraphOsSqliteExport {
  const { objects } = buildWorkGraphOsObjectIndex(workspace);
  const edges = buildWorkGraphOsEdges(workspace, objects);
  const executionLogRows = workGraphOsExecutionLogRows(workspace);
  const updatedAt = workspace?.updatedAt || now();
  return {
    dialect: "sqlite",
    generatedAt: now(),
    migrationMode: "native-sqlite-sync",
    dbFile: workGraphOsDbFile,
    tables: [
      {
        name: "wgos_workspaces",
        createSql: workGraphCreateSql("wgos_workspaces"),
        rows: workspace ? [{
          id: "active",
          version: workspace.version,
          active_brand_id: workspace.activeBrandId,
          active_model_id: workspace.activeModelId,
          prompt: workspace.prompt,
          active_material_id: workspace.activeMaterialId,
          updated_at: updatedAt,
          payload_json: sqliteJson(workspace)
        }] : []
      },
      {
        name: "wgos_objects",
        createSql: workGraphCreateSql("wgos_objects"),
        rows: objects.map((object) => ({
          id: object.id,
          type: object.type,
          title: object.title,
          summary: object.summary,
          source: object.source,
          updated_at: object.updatedAt,
          payload_json: sqliteJson(object.payload)
        }))
      },
      {
        name: "wgos_edges",
        createSql: workGraphCreateSql("wgos_edges"),
        rows: edges.map((edge) => ({
          id: edge.id,
          from_object_id: edge.fromObjectId,
          to_object_id: edge.toObjectId,
          relation: edge.relation,
          updated_at: edge.updatedAt,
          payload_json: sqliteJson(edge.payload)
        }))
      },
      {
        name: "wgos_history",
        createSql: workGraphCreateSql("wgos_history"),
        rows: history.map((entry) => ({
          id: entry.id,
          created_at: entry.createdAt,
          reason: entry.reason,
          prompt: entry.prompt,
          counts_json: sqliteJson(entry.counts),
          object_ids_json: sqliteJson(entry.objectIds),
          objects_json: sqliteJson(entry.objects)
        }))
      },
      {
        name: "wgos_execution_logs",
        createSql: workGraphCreateSql("wgos_execution_logs"),
        rows: executionLogRows
      }
    ]
  };
}

function workGraphOsSqliteReadiness(exportPayload: WorkGraphOsSqliteExport) {
  const writer = resolveWorkGraphSqliteWriter();
  const storage = writer === "json-only"
    ? "json-only"
    : existsSync(workGraphOsDbFile) ? "native-sqlite" : "sqlite-pending-sync";
  return {
    ready: true,
    dialect: exportPayload.dialect,
    migrationMode: exportPayload.migrationMode,
    dbFile: exportPayload.dbFile,
    storage,
    writer,
    lastSyncedAt: workGraphOsSqliteState.lastSyncedAt,
    lastError: workGraphOsSqliteState.lastError,
    tables: exportPayload.tables.map((table) => table.name),
    rowCounts: Object.fromEntries(exportPayload.tables.map((table) => [table.name, table.rows.length])),
    message: writer === "json-only"
      ? "sqlite3 CLI and node:sqlite are unavailable; the JSON store remains authoritative and SQLite mirroring is disabled on this host."
      : `WorkGraph OS mirrors workspace, object graph, history, and execution logs into ${path.basename(workGraphOsDbFile)} via ${writer}.`
  };
}

async function appendWorkGraphOsHistory(workspace: WorkGraphOsWorkspace, reason: WorkGraphOsHistoryEntry["reason"] = "workspace-save") {
  const { counts, objects } = buildWorkGraphOsObjectIndex(workspace);
  const createdAt = now();
  const entry: WorkGraphOsHistoryEntry = {
    id: `wgos-history-${Date.now().toString(36)}-${nanoid(6)}`,
    createdAt,
    reason,
    prompt: workspace.prompt,
    counts,
    objectIds: objects.map((object) => object.id),
    objects
  };
  const history = await readWorkGraphOsHistory();
  await writeWorkGraphOsHistory([entry, ...history]);
  await syncWorkGraphOsObjectSnapshots(workspace);
  return entry;
}

function pdfArtifactHasEmbeddedImage(fileUrl?: string) {
  const filePath = localPublicPathFromUrl(fileUrl);
  if (!filePath || !existsSync(filePath)) return false;
  try {
    return readFileSync(filePath).includes(Buffer.from("/Subtype /Image"));
  } catch {
    return false;
  }
}

async function repairInterruptedGenerations() {
  let changed = false;
  async function repairDocumentArtifacts(frame: CanvasFrame) {
    for (const output of frame.outputs) {
      if (output.kind !== "document") continue;
      const hasEmbeddableImages = collectPdfImageSources(frame, output).length > 0;
      if (output.fileUrl && (!hasEmbeddableImages || pdfArtifactHasEmbeddedImage(output.fileUrl))) continue;
      try {
        output.fileUrl = await createPdfArtifact(frame, output, `xmanx-${frame.id}-${output.id || "document"}`);
        output.copy = appendCopyNote(output.copy, `PDF 文件已生成: ${output.fileUrl}`);
        if (hasEmbeddableImages) output.copy = appendCopyNote(output.copy, "PDF 已合成画布图片页。");
        changed = true;
      } catch (error) {
        output.copy = appendCopyNote(output.copy, `PDF 导出待重试：${error instanceof Error ? error.message.slice(0, 120) : "pdf unavailable"}`);
        changed = true;
      }
    }
  }
  for (const frame of db.frames) {
    if (frame.status !== "generating") continue;
    const task = db.tasks.find((item) => item.id === frame.taskId);
    if (task && runningTimers.has(task.id)) continue;
    ensureFrameOutputPreviews(frame, "上次生成被中断，已保留预览；请点击运行工作流重试。");
    await repairDocumentArtifacts(frame);
    frame.status = "failed";
    frame.progress = 0;
    frame.updatedAt = now();
    if (task && task.status !== "completed") {
      task.status = "failed";
      task.progress = 0;
      task.updatedAt = now();
      task.completedAt = now();
    }
    changed = true;
  }
  for (const frame of db.frames) {
    if (frame.status !== "success" || !frame.outputs.some((output) => !output.imageUrl)) continue;
    ensureFrameOutputPreviews(frame, "历史工作流已补齐可见预览。");
    await repairDocumentArtifacts(frame);
    frame.updatedAt = now();
    changed = true;
  }
  for (const frame of db.frames) {
    if (frame.status !== "success" || !frame.outputs.some((output) => output.kind === "document" && (!output.fileUrl || (!pdfArtifactHasEmbeddedImage(output.fileUrl) && collectPdfImageSources(frame, output).length > 0)))) continue;
    await repairDocumentArtifacts(frame);
    frame.updatedAt = now();
    changed = true;
  }
  if (changed) await persistDb();
}

function activeBrand() {
  return db.brands.find((brand) => brand.active && !brand.archived) ?? db.brands.find((brand) => !brand.archived) ?? db.brands[0];
}

function findBrand(brandId?: string) {
  return (brandId ? db.brands.find((brand) => brand.id === brandId && !brand.archived) : undefined) ?? activeBrand();
}

function frameBrand(frame: Pick<CanvasFrame, "brandId">) {
  return frame.brandId ? db.brands.find((brand) => brand.id === frame.brandId) : undefined;
}

function neutralBrandColor(brand?: Brand) {
  return {
    accent: brand?.accentColor ?? "#f97316",
    primary: brand?.primaryColor ?? "#111827"
  };
}

function brandLabel(brand?: Brand) {
  return brand?.name ?? "无品牌";
}

function brandVisualStyle(brand?: Brand) {
  return brand?.visualStyle ?? "通用商业视觉，结构清晰，画面干净，适合继续连接下游 AI 节点。";
}

function brandTone(brand?: Brand) {
  return brand?.tone ?? "通用、清晰、可控";
}

function frameContextBrand(frame: Pick<CanvasFrame, "brandId" | "settings">) {
  return frame.settings?.brandInject ? frameBrand(frame) : undefined;
}

function estimateCost(prompt: string, mode: CanvasFrame["mode"], templateCost?: number) {
  if (templateCost) return templateCost;
  if (prompt.includes("视频") || prompt.toLowerCase().includes("video")) return 36;
  if (prompt.includes("批量") || prompt.toLowerCase().includes("batch")) return 24;
  if (mode === "template") return 12;
  return 16;
}

function defaultSettings(prompt: string, settings?: Partial<GenerationSettings>): GenerationSettings {
  const inferredDuration = promptDurationSeconds(prompt);
  return {
    ratio: prompt.includes("视频") ? "9:16" : "1:1",
    width: prompt.includes("视频") ? 1080 : 1080,
    height: prompt.includes("视频") ? 1920 : 1080,
    count: 1,
    quality: "hd",
    strength: 70,
    duration: prompt.includes("视频") ? inferredDuration ?? 15 : 0,
    brandInject: false,
    contentLanguage: "zh-en",
    ...settings
  };
}

function buildBrandContext(brand: Brand) {
  const mentionForRole = (role: string) => {
    const map: Record<string, string> = {
    logo: "$logo",
    ip: "$ip",
    product: "$product",
    model: "$model",
    storefront: "$storefront",
    environment: "$environment",
    menu: "$menu",
    equipment: "$equipment",
    general: "$asset",
    upload: "$asset"
    };
    return map[role] ?? "$asset";
  };
  const roleLines = brand.assetRoles.map((asset) => `${mentionForRole(asset.role)} ${asset.title}；${asset.description}`).join("\n");
  const materialLines = db.assets
    .filter((asset) => asset.brandId === brand.id && !asset.type.startsWith("generated_") && asset.imageUrl)
    .slice(0, 12)
    .map((asset) => `${assetReferencePath(asset) ? `$${assetReferencePath(asset)}` : mentionForRole(assetTypeToReferenceRole(asset.type, asset.title, asset.meta))} ${asset.title} [image]；${asset.meta}`)
    .join("\n");
  return [
    `$copy.brand_name ${brand.name}`,
    `$copy.slogan ${brand.slogan}`,
    `$copy.domain ${brand.market}`,
    `$brand.logo_text ${brand.logoText}: 主色 ${brand.primaryColor}；强调色 ${brand.accentColor}；${brand.logoUsage}`,
    `$brand.ip ${brand.ipName}: ${brand.ipDescription}`,
    `$brand.style ${brand.visualStyle}`,
    `$brand.tone ${brand.tone}`,
    `$brand.scene ${brand.sceneKeywords.join(", ")}`,
    `$brand.forbidden ${brand.forbiddenWords.join(", ")}`,
    roleLines ? `$asset_roles\n${roleLines}` : "",
    materialLines ? `$assets\n${materialLines}` : ""
  ].filter(Boolean).join("\n");
}

function workGraphBrandPayload(brand: Brand | undefined, activeBrandId: string) {
  const selected = brand ?? activeBrand();
  if (!selected) {
    return {
      id: activeBrandId || "active",
      name: "Unknown Brand",
      positioning: "No brand database record found.",
      colors: "",
      audience: "",
      rules: [] as string[],
      context: "",
      source: "missing"
    };
  }
  return {
    id: selected.id,
    name: selected.name,
    positioning: selected.brandStory || selected.slogan || selected.market,
    colors: `${selected.primaryColor} / ${selected.accentColor}`,
    audience: selected.targetAudience,
    rules: [
      selected.logoUsage,
      selected.visualStyle,
      selected.tone,
      ...selected.forbiddenWords.map((item) => `avoid: ${item}`)
    ].filter(Boolean),
    forbiddenWords: selected.forbiddenWords,
    sceneKeywords: selected.sceneKeywords,
    context: buildBrandContext(selected),
    assetRoles: selected.assetRoles,
    assets: db.assets
      .filter((asset) => asset.brandId === selected.id && !asset.type.startsWith("generated_"))
      .slice(0, 12)
      .map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        imageUrl: asset.imageUrl,
        referencePath: assetReferencePath(asset)
      })),
    source: "sparkcanvas-brand-db"
  };
}

function uniqueAppend(items: string[], value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return items;
  const exists = items.some((item) => normalizeKey(item) === normalizeKey(normalized));
  return exists ? items : [...items, normalized];
}

function mergeWorkGraphAssetMetaTags(meta: string, tags: string[]) {
  const existing = meta.match(/tags:([^\s]+)/)?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const merged = tags.reduce((items, tag) => uniqueAppend(items, tag), existing);
  const cleaned = meta.replace(/\s*tags:[^\s]+/g, "").trim();
  return [cleaned, merged.length ? `tags:${merged.join(",")}` : ""].filter(Boolean).join(" ");
}

function workGraphFeedbackBrandLearning(note: string, rating: "accepted" | "needs_revision" | "failed") {
  return learnFromWorkGraphFeedback(note, rating);
}

function workGraphAssetToken(asset: Asset) {
  const referencePath = assetReferencePath(asset);
  if (referencePath) return `$${referencePath}`;
  const brand = db.brands.find((item) => item.id === asset.brandId);
  const brandPrefix = brand ? normalizeKey(brand.name) || brand.id : asset.brandId;
  const role = assetTypeToReferenceRole(asset.type, asset.title, asset.meta);
  return `$${brandPrefix}.${role}`;
}

function workGraphMaterialKind(asset: Asset): "image" | "video" | "document" | "audio" {
  if (/kind:image/.test(asset.meta)) return "image";
  if (/kind:video/.test(asset.meta)) return "video";
  if (/kind:audio/.test(asset.meta)) return "audio";
  if (/kind:document/.test(asset.meta)) return "document";
  if (asset.type === "generated_video") return "video";
  return asset.imageUrl ? "image" : "document";
}

function workGraphAssetPayload(asset: Asset) {
  const role = assetTypeToReferenceRole(asset.type, asset.title, asset.meta);
  const referencePath = assetReferencePath(asset);
  const fileMatch = asset.meta.match(/file:([^\s]+)/);
  const thumbnailMatch = asset.meta.match(/thumbnail:([^\s]+)/);
  const versionMatch = asset.meta.match(/version:([^\s]+)/);
  const usageMatch = asset.meta.match(/usage:([^\s]+)/);
  const sizeMatch = asset.meta.match(/size:(\d+)/);
  const metaTags = asset.meta.match(/tags:([^\s]+)/)?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const dataPath = fileMatch ? path.join(workGraphOsAssetDataDir, fileMatch[1]) : "";
  return {
    id: asset.id,
    title: asset.title,
    kind: workGraphMaterialKind(asset),
    token: workGraphAssetToken(asset),
    previewUrl: asset.imageUrl ?? "",
    fileName: fileMatch?.[1] ?? asset.imageUrl?.split("/").pop() ?? `${asset.id}.asset`,
    size: sizeMatch ? Number(sizeMatch[1]) : 0,
    createdAt: asset.createdAt,
    tags: [asset.type, role, asset.brandId, ...metaTags].filter(Boolean),
    note: asset.meta,
    brandId: asset.brandId,
    role,
    referencePath,
    dataPath,
    thumbnailUrl: thumbnailMatch ? `/workgraph-os/assets/file/${thumbnailMatch[1]}` : asset.imageUrl ?? "",
    thumbnailPath: thumbnailMatch ? path.join(workGraphOsAssetDataDir, thumbnailMatch[1]) : "",
    versionPath: versionMatch ? path.join(workGraphOsAssetDataDir, versionMatch[1]) : "",
    usagePath: usageMatch ? path.join(workGraphOsAssetDataDir, usageMatch[1]) : "",
    source: "sparkcanvas-asset-store"
  };
}

function workGraphSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    || "skill";
}

// safeWorkGraphRelativePath imported from ./path-utils (T10).

function workGraphSkillFolderName(input: unknown, fallbackIndex = 0) {
  return piSkillFolderName(input, fallbackIndex);
}

function workGraphSkillRelativeDir(input: unknown, fallbackIndex = 0) {
  return piSkillFolderName(input, fallbackIndex);
}

function workGraphSkillRelativePath(input: unknown, fallbackIndex = 0) {
  return piSkillRelativePath(input, fallbackIndex);
}

function workGraphSkillDiskDirs(input: unknown, fallbackIndex = 0) {
  const folder = workGraphSkillRelativeDir(input, fallbackIndex);
  return [
    path.join(workGraphOsPiDir, "skills", folder),
    path.join(workGraphOsSkillDataDir, folder)
  ];
}

function workGraphSkillFileSpec(skill: Record<string, unknown>) {
  const command = objectString(skill, "command", "/skill");
  const title = objectString(skill, "title", "Skill");
  const output = objectString(skill, "output", "PNG");
  const description = objectString(skill, "description", "由 WorkGraph OS 管理的 Pi Skill。");
  const capabilityType = objectString(skill, "capabilityType", "custom");
  const runtime = objectString(skill, "runtime", "pi-skill");
  const keywords = objectStringArray(skill, "keywords");
  const slug = workGraphSkillFolderName(skill);
  const json = {
    id: objectString(skill, "id", `skill-${slug}`),
    title,
    command,
    output,
    description,
    capabilityType,
    runtime,
    keywords,
    version: objectString(skill, "version", "0.1.0"),
    status: objectString(objectField(skill, "evolution"), "status", "created")
  };
  return {
    "SKILL.md": [
      `# ${title}`,
      "",
      `Command: \`${command}\``,
      `Output: \`${output}\``,
      "",
      description,
      "",
      "## Inputs",
      "- Goal Object",
      "- Brand Object",
      "- Asset Objects",
      "- ModelPolicy",
      "",
      "## Run Contract",
      "Return ResultObject, ExecutionLog entries, and preview-ready output data.",
      "",
      "## Safety",
      "Do not overwrite user assets. Keep API keys in environment variables."
    ].join("\n"),
    "skill.json": `${JSON.stringify(json, null, 2)}\n`,
    "scripts/run.ts": [
      "export async function run(input: unknown) {",
      "  return {",
      `    skill: ${JSON.stringify(command)},`,
      "    status: \"planned\",",
      "    input",
      "  };",
      "}",
      ""
    ].join("\n"),
    "resources/guide.md": [
      `# ${title} Guide`,
      "",
      "Use this guide to keep prompts, model routing, brand constraints, and output validation explicit.",
      ""
    ].join("\n"),
    "examples/input.json": `${JSON.stringify({ goal: "给 DAPOT 做一条泰国年轻女性喜欢的新店开业 TikTok 视频", brandId: "brand_dapot", command }, null, 2)}\n`,
    "examples/output.json": `${JSON.stringify({ resultType: output, status: "preview", logs: [] }, null, 2)}\n`
  };
}

async function ensurePiAdapterFiles() {
  await ensurePiAdapterSystem(workGraphPiAdapterConfig());
}

async function ensureWorkGraphSkillFiles(skill: Record<string, unknown>, fallbackIndex = 0) {
  await ensurePiSkillFiles(workGraphPiAdapterConfig(), skill, fallbackIndex);
}

async function writeWorkGraphSkillFileToDirs(skill: Record<string, unknown>, relativePath: string, content: string) {
  const safePath = safePiSkillRelativePath(relativePath);
  if (!safePath) throw new Error("Invalid Skill file path");
  for (const dir of workGraphSkillDiskDirs(skill)) {
    const filePath = path.join(dir, safePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

async function appendWorkGraphSkillLog(skill: Record<string, unknown>, logName: string, payload: unknown) {
  const safeName = workGraphSlug(logName).slice(0, 80) || "skill-log";
  const createdAt = now();
  const payloadObject = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { payload };
  const content = `${JSON.stringify({ createdAt, ...payloadObject }, null, 2)}\n`;
  for (const dir of workGraphSkillDiskDirs(skill)) {
    const filePath = path.join(dir, "logs", `${createdAt.replace(/[:.]/g, "-")}-${safeName}.json`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

async function snapshotWorkGraphSkillVersion(skill: Record<string, unknown>, reason: string) {
  const createdAt = now();
  const files = ["SKILL.md", "skill.json", "resources/guide.md", "examples/input.json", "examples/output.json"];
  for (const dir of workGraphSkillDiskDirs(skill)) {
    const snapshotDir = path.join(dir, "versions", createdAt.replace(/[:.]/g, "-"));
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(path.join(snapshotDir, "version.json"), `${JSON.stringify({ createdAt, reason }, null, 2)}\n`);
    for (const relativePath of files) {
      try {
        const content = await readFile(path.join(dir, relativePath), "utf8");
        const outPath = path.join(snapshotDir, safePiSkillRelativePath(relativePath));
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, content);
      } catch {
        // Missing optional files are skipped in the version snapshot.
      }
    }
  }
  return createdAt;
}

async function applyWorkGraphSkillOptimization(skill: Record<string, unknown>, prompt: string) {
  return applyPiSkillOptimization(workGraphPiAdapterConfig(), skill, prompt);
}

async function writeWorkGraphPiSession(run: ReturnType<typeof buildWorkGraphOsExecution>, artifacts: Awaited<ReturnType<typeof persistWorkGraphRunArtifacts>>) {
  const sessionId = `pi-session-${run.execution.id}`;
  const piContext = await buildPiExecutionContext(workGraphPiAdapterConfig(), {
    goal: objectString(run.promptRecord, "sourcePrompt", ""),
    workflowId: run.execution.workflowId,
    node: {
      id: run.execution.nodeId,
      title: objectString(run.promptRecord, "nodeTitle", run.execution.nodeId),
      params: objectField(run.promptRecord, "nodeParams")
    },
    brand: {
      id: objectString(run.promptRecord, "brandId", ""),
      context: objectString(run.promptRecord, "brandContext", "")
    },
    assets: Array.isArray(objectField(run.promptRecord, "assets")) ? objectField(run.promptRecord, "assets") as unknown[] : [],
    skill: objectField(run.promptRecord, "skill") && typeof objectField(run.promptRecord, "skill") === "object"
      ? objectField(run.promptRecord, "skill") as Record<string, unknown>
      : null,
    modelPolicy: run.routingDecision,
    promptRecord: run.promptRecord
  });
  return writePiSessionRecord(workGraphPiAdapterConfig(), {
    id: sessionId,
    executionId: run.execution.id,
    workflowId: run.execution.workflowId,
    nodeId: run.execution.nodeId,
    skillId: run.execution.skillId,
    resultId: run.execution.resultId,
    promptRecordId: objectString(run.promptRecord, "id", ""),
    status: run.execution.status,
    createdAt: run.execution.createdAt,
    input: {
      goal: objectString(run.promptRecord, "sourcePrompt", ""),
      finalPrompt: objectString(run.promptRecord, "finalPrompt", ""),
      brandId: objectString(run.promptRecord, "brandId", ""),
      materialIds: objectStringArray(run.promptRecord, "materialIds"),
      modelPolicy: run.routingDecision,
      skill: objectField(run.promptRecord, "skill"),
      piContext
    },
    output: {
      resultId: run.execution.resultId,
      output: objectString(run.result, "output", objectString(run.result, "preview", "")),
      artifactPaths: artifacts.artifactPaths,
      executionLog: run.executionLog
    }
  });
}

// Collect local filesystem paths for selected assets so pi-web can read them.
// Deliverable ② enriches this; here we forward any absolute reference paths we have.
function workGraphBridgeFilePaths(run: ReturnType<typeof buildWorkGraphOsExecution>) {
  const inputFiles = Array.isArray(objectField(run.promptRecord, "inputFiles")) ? objectField(run.promptRecord, "inputFiles") as unknown[] : [];
  const paths = inputFiles
    .map((entry) => objectString(entry, "path", ""))
    .filter((value) => value && path.isAbsolute(value));
  return Array.from(new Set(paths));
}

function setWorkGraphBridge(run: ReturnType<typeof buildWorkGraphOsExecution>, bridge: WorkGraphOsBridgeInfo, simulated: boolean) {
  run.execution.bridge = bridge;
  run.execution.simulated = simulated;
  (run.job as Record<string, unknown>).bridge = bridge;
  (run.job as Record<string, unknown>).simulated = simulated;
  (run.result as Record<string, unknown>).bridge = bridge;
  (run.result as Record<string, unknown>).simulated = simulated;
}

function appendWorkGraphBridgeLog(run: ReturnType<typeof buildWorkGraphOsExecution>, mode: "pi-web" | "simulated", message: string, artifactPaths: string[] = []) {
  const entry = {
    id: `${run.execution.id}-bridge`,
    executionId: run.execution.id,
    step: "bridge",
    status: mode === "pi-web" ? "done" : "simulated",
    nodeId: run.execution.nodeId,
    workflowId: run.execution.workflowId,
    message: `pi-web bridge (${mode}): ${message}`,
    payload: { mode, artifactPaths },
    createdAt: now()
  };
  run.executionLog.push(entry as (typeof run.executionLog)[number]);
  run.workspace.executionLog = [entry, ...(run.workspace.executionLog ?? [])].slice(0, 500);
}

// Real pi-web execution. Tries the configured pi-web instance; on success the
// run is marked executor="pi-web"/simulated=false, otherwise it stays simulated
// (or throws in mode="on"). The honest contract: only a real pi session that
// returns output may report a non-simulated result.
async function applyWorkGraphPiBridge(run: ReturnType<typeof buildWorkGraphOsExecution>, overrideMode?: "auto" | "on" | "off") {
  const config = { ...workGraphPiWebConfig(), ...(overrideMode ? { mode: overrideMode } : {}) };
  const probe = await probePiWebBridge(config);
  const simulatedReason = (reason: string): WorkGraphOsBridgeInfo => ({
    mode: "simulated",
    reachable: probe.reachable,
    baseUrl: config.baseUrl,
    reason,
    piSessionId: ""
  });
  if (!probe.enabled || !probe.reachable) {
    if (config.mode === "on") {
      throw Object.assign(new Error(`pi-web bridge required but ${probe.reason}`), { statusCode: 502 });
    }
    setWorkGraphBridge(run, simulatedReason(probe.reason), true);
    appendWorkGraphBridgeLog(run, "simulated", probe.reason);
    return { mode: "simulated" as const, probe };
  }
  const result = await runPiWebSession(config, {
    sessionId: `pi-session-${run.execution.id}`,
    goal: objectString(run.promptRecord, "sourcePrompt", ""),
    prompt: objectString(run.promptRecord, "finalPrompt", objectString(run.promptRecord, "sourcePrompt", "")),
    output: objectString(run.promptRecord, "output", ""),
    files: workGraphBridgeFilePaths(run),
    skill: run.execution.skillId
      ? { id: run.execution.skillId, command: objectString(objectField(run.promptRecord, "skill"), "command", "") }
      : null,
    modelPolicy: run.routingDecision,
    metadata: { workflowId: run.execution.workflowId, nodeId: run.execution.nodeId, resultId: run.execution.resultId }
  });
  if (!result.ok) {
    if (config.mode === "on") {
      throw Object.assign(new Error(`pi-web bridge required but ${result.reason}`), { statusCode: 502 });
    }
    setWorkGraphBridge(run, { ...simulatedReason(result.reason), reachable: result.reachable }, true);
    appendWorkGraphBridgeLog(run, "simulated", result.reason);
    return { mode: "simulated" as const, probe, result };
  }
  const realBridge: WorkGraphOsBridgeInfo = {
    mode: "pi-web",
    reachable: true,
    baseUrl: config.baseUrl,
    reason: result.reason,
    piSessionId: result.piSessionId
  };
  setWorkGraphBridge(run, realBridge, false);
  run.execution.executor = "pi-web";
  run.execution.status = result.status;
  const job = run.job as Record<string, unknown>;
  job.executor = "pi-web";
  job.status = result.status;
  job.output = result.output || job.output;
  job.preview = result.preview || job.preview;
  const resultObject = run.result as Record<string, unknown>;
  resultObject.executor = "pi-web";
  resultObject.status = result.status === "done" ? "ready" : result.status;
  if (result.output) resultObject.output = result.output;
  if (result.artifactPaths.length) {
    resultObject.previewUrl = result.artifactPaths[0];
    resultObject.artifactPaths = result.artifactPaths;
  }
  appendWorkGraphBridgeLog(run, "pi-web", `${result.reason} (status=${result.status})`, result.artifactPaths);
  return { mode: "pi-web" as const, probe, result };
}

// Skill auto-evolution (deliverable ④). After a run, a successful execution past
// the promote threshold turns the executed skill into a reusable template; a
// failed run flags it for repair and queues a repair task. Disk side effects are
// best-effort and never fail the run.
async function applyWorkGraphSkillEvolutionOutcome(run: ReturnType<typeof buildWorkGraphOsExecution>) {
  const skillId = run.execution.skillId;
  const index = run.workspace.skills.findIndex((item) => objectString(item, "id", "") === skillId);
  if (index < 0) return { decision: null, repairTask: null };
  const skill = run.workspace.skills[index] as Record<string, unknown>;
  const evolution = workGraphSkillEvolution(skill);
  const runSucceeded = !["error", "failed"].includes(String(run.execution.status));
  const decision = evaluateWorkGraphSkillEvolution({
    success: runSucceeded,
    evolution,
    promoteThreshold: Number(process.env.WGOS_SKILL_PROMOTE_THRESHOLD ?? 2) || 2
  });
  const historyEntry = {
    id: `skill-evolution-${Date.now().toString(36)}-${nanoid(6)}`,
    createdAt: now(),
    type: decision.repair ? "repair-task" : decision.promote ? "promote" : "evaluate",
    status: decision.status,
    executionId: run.execution.id,
    reason: decision.reason
  };
  run.workspace.skills[index] = {
    ...skill,
    evolution: {
      ...evolution,
      status: decision.status,
      template: decision.template,
      ...(decision.promote ? { promotedAt: now(), validatedBy: run.execution.simulated ? "simulated-preview" : "pi-web" } : {}),
      history: [historyEntry, ...evolution.history].slice(0, 50)
    }
  };
  let repairTask: Record<string, unknown> | null = null;
  if (decision.repair) {
    repairTask = {
      id: `repair-${Date.now().toString(36)}-${nanoid(6)}`,
      type: "skill-repair",
      status: "needs_repair",
      skillId,
      executionId: run.execution.id,
      workflowId: run.execution.workflowId,
      nodeId: run.execution.nodeId,
      reason: objectString(run.execution.bridge, "reason", `run ${run.execution.id} failed`),
      suggestedPrompt: `修复技能 ${skillId}:上次执行失败(${objectString(run.execution.bridge, "reason", "unknown")})。请检查输入契约、模型路由与品牌约束后重试。`,
      createdAt: now()
    };
    run.workspace.jobs = [repairTask, ...run.workspace.jobs];
  }
  // Best-effort disk artifacts: version the SKILL.md on promotion, log repair tasks.
  try {
    if (decision.promote) {
      await applyPiSkillOptimization(workGraphPiAdapterConfig(), skill, "Promoted to reusable template after repeated successful runs.");
    } else if (decision.repair && repairTask) {
      await appendPiSkillLog(workGraphPiAdapterConfig(), skill, "repair-task", repairTask);
    }
  } catch (error) {
    console.warn(`WorkGraph skill evolution disk write failed for ${skillId}: ${(error as Error).message}`);
  }
  return { decision, repairTask };
}

// Output variants for side-by-side comparison (deliverable ⑤). The primary
// result becomes variant 0; extra variants are preview-only derivatives routed
// through the fallback model chain so users can compare model outputs. No extra
// paid generation is triggered — variants inherit the primary run's executor.
function buildWorkGraphResultVariants(primary: Record<string, unknown>, count: number, routingDecision: unknown) {
  const variantGroupId = objectString(primary, "id", "result");
  const fallbacks = objectStringArray(routingDecision, "fallbackModelIds");
  const primaryVariant = { ...primary, variantGroupId, variantIndex: 0, variantRole: "primary" };
  const extras: Record<string, unknown>[] = [];
  for (let index = 1; index < count; index += 1) {
    const modelId = fallbacks[index - 1] ?? objectString(primary, "modelId", "");
    extras.push({
      ...primary,
      id: `${variantGroupId}-v${index}`,
      title: `${objectString(primary, "title", "Result")} · variant ${index} (${modelId})`,
      variantGroupId,
      variantIndex: index,
      variantRole: "variant",
      modelId,
      createdAt: now(),
      updatedAt: now()
    });
  }
  return { variantGroupId, variants: [primaryVariant, ...extras] };
}

async function readSkillJsonFile(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function scanWorkGraphSkillDir(root: string, source: "pi-skill-fs" | "data-skill-store") {
  return scanPiSkillDir(root, source, (input, index = 0) => workGraphNormalizeSkill(input, index));
}

async function workGraphSkillFileTree(dir: string, root = dir): Promise<WorkGraphOsSkillFileTree[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const visible = entries.filter((entry) => !entry.name.startsWith(".")).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const tree: WorkGraphOsSkillFileTree[] = [];
    for (const entry of visible) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        tree.push({ name: entry.name, path: relativePath, type: "directory", children: await workGraphSkillFileTree(absolutePath, root) });
      } else {
        const info = await stat(absolutePath);
        tree.push({ name: entry.name, path: relativePath, type: "file", size: info.size });
      }
    }
    return tree;
  } catch {
    return [];
  }
}

async function workGraphSkillDetail(skillId: string) {
  const workspace = await readWorkGraphOsWorkspace();
  const skill = workGraphSkillCatalog(workspace).find((item) => objectString(item, "id") === skillId);
  if (!skill) return null;
  return buildPiSkillDetail(workGraphPiAdapterConfig(), skill);
}

function workGraphNormalizeSkill(input: unknown, index = 0) {
  const title = objectString(input, "title", `Skill ${index + 1}`);
  const command = objectString(input, "command", `/${workGraphSlug(title)}`).replace(/^\/?/, "/");
  const output = objectString(input, "output", /video|视频|mp4/i.test(`${title} ${command}`) ? "MP4" : "PNG");
  const isVideo = /video|视频|mp4/i.test(`${title} ${command} ${output}`);
  const isArchive = /archive|归档|zip|kit/i.test(`${title} ${command} ${output}`);
  const slug = workGraphSkillFolderName(input, index);
  const createdAt = objectString(input, "createdAt", now());
  return {
    id: objectString(input, "id", `skill-${slug}`),
    title,
    command,
    output,
    description: objectString(input, "description", "由 WorkGraph OS Skill Store 管理的能力对象。"),
    icon: objectString(input, "icon", isVideo ? "video" : isArchive ? "archive" : "image"),
    keywords: objectStringArray(input, "keywords").length ? objectStringArray(input, "keywords") : title.split(/\s+/).filter(Boolean),
    nodeType: objectString(input, "nodeType", isVideo ? "video" : isArchive ? "file" : "output"),
    capabilityType: objectString(input, "capabilityType", isVideo ? "video_planning" : isArchive ? "archive" : "image_generation"),
    inputs: objectStringArray(input, "inputs").length ? objectStringArray(input, "inputs") : ["Goal Object", "Asset Object", "Brand Object"],
    outputs: objectStringArray(input, "outputs").length ? objectStringArray(input, "outputs") : [`Result Object: ${output}`],
    runtime: objectString(input, "runtime", "pi-skill"),
    skillMdPath: objectString(input, "skillMdPath", `skills/${slug}/SKILL.md`),
    version: objectString(input, "version", "0.1.0"),
    evolution: objectField(input, "evolution") ?? {
      status: "created",
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      testPlan: ["run generated skill", "verify result object", "save reusable SKILL.md"]
    },
    filesystem: objectField(input, "filesystem"),
    source: objectString(input, "source", "workgraph-skill-store"),
    createdAt
  };
}

async function workGraphSkillCatalogWithFs(workspace: WorkGraphOsWorkspace | null) {
  await ensurePiAdapterFiles();
  const workspaceSkills = workGraphSkillCatalog(workspace);
  await Promise.all(workspaceSkills.map((skill, index) => ensureWorkGraphSkillFiles(skill, index)));
  const piSkills = await scanWorkGraphSkillDir(path.join(workGraphOsPiDir, "skills"), "pi-skill-fs");
  const dataSkills = await scanWorkGraphSkillDir(workGraphOsSkillDataDir, "data-skill-store");
  return [...workspaceSkills, ...piSkills, ...dataSkills].filter((skill, index, list) => {
    const id = objectString(skill, "id", "");
    const command = objectString(skill, "command", "");
    return list.findIndex((item) => objectString(item, "id", "") === id || objectString(item, "command", "") === command) === index;
  });
}

function workGraphSkillCatalog(workspace: WorkGraphOsWorkspace | null) {
  const skills = workspace?.skills ?? [];
  return skills.map((skill, index) => workGraphNormalizeSkill(skill, index));
}

function orientationFromRatio(ratio?: string): WorkflowOrientation {
  if (!ratio) return "square";
  const normalized = ratio.trim();
  if (normalized === "9:16" || normalized === "4:5" || normalized === "3:4") return "portrait";
  if (normalized === "16:9" || normalized === "4:3" || normalized === "3:2") return "landscape";
  const [left, right] = normalized.split(":").map((value) => Number.parseFloat(value));
  if (Number.isFinite(left) && Number.isFinite(right)) {
    if (left > right) return "landscape";
    if (left < right) return "portrait";
  }
  return "square";
}

function primaryOutputTargetFromResolved(resolved: ResolvedPromptAssets): WorkflowOutputTarget {
  const final = finalOutputFromPrompt(resolved.prompt);
  if (["jpg", "png", "poster", "pdf", "mp4", "kit"].includes(final)) return final as WorkflowOutputTarget;
  if (resolved.outputs.some((item) => outputKindForTarget(item) === "video")) return "mp4";
  if (resolved.outputs.some((item) => outputKindForTarget(item) === "document")) return "pdf";
  return "jpg";
}

function buildCreativeIR(prompt: string, options?: { brandId?: string | null; brandInject?: boolean; settings?: Partial<GenerationSettings> }): CreativeIR {
  const normalizedPrompt = normalizeLegacyPromptRefs(prompt).trim();
  const explicitBrand = options?.brandId === null ? undefined : options?.brandId ? findBrand(options.brandId) : undefined;
  const inferredBrand = explicitBrand ? undefined : inferBrandFromPrompt(normalizedPrompt);
  const brand = explicitBrand ?? inferredBrand;
  const resolved = resolvePromptAssets(normalizedPrompt, brand);
  const primaryOutput = primaryOutputTargetFromResolved(resolved);
  const settings = defaultSettings(normalizedPrompt, options?.settings);
  const orientation = orientationFromRatio(settings.ratio);
  const shouldInjectBrand = Boolean(brand && (options?.brandInject ?? promptRequestsWholeBrand(normalizedPrompt, brand)));
  const brandContext = brand && shouldInjectBrand ? buildBrandContext(brand) : "";
  const finalPrompt = buildFinalPrompt(normalizedPrompt, brand ? buildBrandContext(brand) : "", shouldInjectBrand, brand);
  const assetBindings: CreativeIRBinding[] = resolved.imageReferences.map((reference) => ({
    kind: "image",
    key: reference.description.split(" · ")[0] ?? reference.id,
    raw: resolved.ast.resources.find((resource) => resource.type === "image" && reference.description.startsWith(resource.fullKey))?.raw ?? `$${reference.description.split(" · ")[0] ?? reference.id}`,
    role: reference.role,
    title: reference.title,
    description: reference.description,
    imageUrl: reference.imageUrl,
    resolved: Boolean(reference.imageUrl)
  }));
  const textBindings: CreativeIRBinding[] = resolved.textReferences.map((reference) => ({
    kind: "text",
    key: reference.key,
    raw: reference.raw,
    value: reference.value,
    resolved: true
  }));
  const unresolvedBindings: CreativeIRBinding[] = resolved.ast.resources
    .filter((resource) => !assetBindings.some((binding) => binding.raw === resource.raw) && !textBindings.some((binding) => binding.raw === resource.raw))
    .map((resource) => ({
      kind: resource.type,
      key: resource.fullKey,
      raw: resource.raw,
      resolved: false
    }));
  const outputTargets = resolved.outputs.length ? resolved.outputs : outputTargetsForFinal(primaryOutput);
  const outputHints = outputTargets.map((target) => ({
    target,
    kind: outputKindForTarget(target),
    label: labelForOutputTarget(target)
  }));

  return {
    version: "creative-ir/0.1",
    source: {
      originalPrompt: prompt,
      normalizedPrompt,
      expandedPrompt: resolved.prompt,
      cal: resolved.ast
    },
    intent: {
      summary: stripCalForExecution(normalizedPrompt, resolved) || normalizedPrompt,
      sourceText: finalPrompt,
      agents: resolved.agents,
      commands: resolved.commands,
      tags: resolved.tags,
      lockedTexts: resolved.lockedTexts,
      params: resolved.params,
      executionText: stripCalForExecution(normalizedPrompt, resolved)
    },
    context: {
      brandId: brand?.id ?? "",
      brandKey: brand ? brandKey(brand) : "",
      brandName: brand?.name ?? "无品牌",
      selection: explicitBrand ? "explicit" : brand ? "inferred" : "none",
      injected: shouldInjectBrand,
      brandContext,
      visualStyle: brandVisualStyle(brand),
      tone: brandTone(brand),
      market: brand?.market ?? "",
      slogan: brand?.slogan ?? "",
      audience: brand?.targetAudience ?? "",
      forbiddenWords: brand?.forbiddenWords ?? [],
      sceneKeywords: brand?.sceneKeywords ?? []
    },
    bindings: {
      assets: [...assetBindings, ...unresolvedBindings.filter((binding) => binding.kind === "image")],
      references: [...textBindings, ...unresolvedBindings.filter((binding) => binding.kind === "text")]
    },
    style: {
      visualStyle: brandVisualStyle(brand),
      tone: brandTone(brand),
      primaryColor: brand?.primaryColor,
      accentColor: brand?.accentColor,
      tags: resolved.tags,
      contentLanguage: settings.contentLanguage ?? "auto",
      orientation,
      ratioHint: settings.ratio
    },
    constraints: {
      lockedTexts: resolved.lockedTexts,
      forbiddenWords: brand?.forbiddenWords ?? [],
      warnings: resolved.warnings,
      contentLanguage: contentLanguageLabel(settings.contentLanguage),
      brandConsistency: brand ? [
        `保持 ${brand.name} 的 Logo、IP、商品与主色一致`,
        `遵守品牌语气：${brand.tone}`,
        brand.forbiddenWords.length ? `避免：${brand.forbiddenWords.join(", ")}` : ""
      ].filter(Boolean) : []
    },
    flow: buildWorkflow(normalizedPrompt, brand, shouldInjectBrand).map((detail, index) => ({
      id: `flow-${index + 1}`,
      title: detail.split(" ")[0] ?? `Step ${index + 1}`,
      detail
    })),
    output: {
      targets: outputTargets,
      primary: primaryOutput,
      kinds: Array.from(new Set(outputHints.map((item) => item.kind))),
      hints: outputHints
    },
    warnings: resolved.warnings
  };
}

function buildPlannerPlanFromCreativeIR(ir: CreativeIR): PlannerPlan {
  const steps: PlannerStep[] = [];
  const intentStepId = "intent-1";
  const contextStepId = "context-1";
  const referencesStepId = "references-1";

  steps.push({
    id: intentStepId,
    stage: "intent",
    title: "Interpret intent",
    detail: ir.intent.summary || ir.source.normalizedPrompt,
    dependsOn: [],
    inputs: [ir.source.originalPrompt],
    outputs: ["intent.summary", "intent.executionText"],
    bindings: [...ir.intent.agents.map((item) => `@${item}`), ...ir.intent.commands.map((item) => `/${item}`)]
  });

  steps.push({
    id: contextStepId,
    stage: "context",
    title: ir.context.injected ? "Prepare brand context" : "Prepare task context",
    detail: ir.context.injected
      ? `注入 ${ir.context.brandName} 品牌上下文，保持 ${ir.style.visualStyle || "既定视觉风格"} 与 ${ir.style.tone || "品牌语气"} 一致。`
      : "不注入完整品牌包，仅保留提示词、显式引用与风格参数。",
    dependsOn: [intentStepId],
    inputs: [ir.context.brandName, ir.style.visualStyle, ir.style.tone].filter(Boolean),
    outputs: ["context.brand", "context.style", "context.constraints"],
    bindings: ir.constraints.brandConsistency
  });

  steps.push({
    id: referencesStepId,
    stage: "references",
    title: "Resolve references and constraints",
    detail: [
      ir.bindings.assets.length ? `图片引用 ${ir.bindings.assets.length} 个` : "无图片引用",
      ir.bindings.references.length ? `文本引用 ${ir.bindings.references.length} 个` : "无文本引用",
      ir.constraints.lockedTexts.length ? `锁定文案 ${ir.constraints.lockedTexts.length} 条` : "无锁定文案"
    ].join("；"),
    dependsOn: [contextStepId],
    inputs: [
      ...ir.bindings.assets.map((binding) => binding.raw),
      ...ir.bindings.references.map((binding) => binding.raw),
      ...ir.constraints.lockedTexts.map((item) => `"${item}"`)
    ],
    outputs: ["resolved.references", "constraint.pack"],
    bindings: [
      ...ir.bindings.assets.map((binding) => binding.key),
      ...ir.bindings.references.map((binding) => binding.key)
    ]
  });

  const generationStepIds: string[] = [];
  ir.output.hints.forEach((hint, index) => {
    const stepId = `generation-${index + 1}`;
    generationStepIds.push(stepId);
    steps.push({
      id: stepId,
      stage: "generation",
      title: `Generate ${hint.label}`,
      detail: ir.flow[index]?.detail ?? `基于 ${ir.intent.summary} 生成 ${hint.label}，输出类型 ${hint.kind}。`,
      dependsOn: [referencesStepId],
      inputs: [
        ir.intent.executionText || ir.intent.summary,
        ir.style.ratioHint,
        contentLanguageLabel(ir.style.contentLanguage === "auto" ? ir.constraints.contentLanguage === "自动识别语言" ? "auto" : ir.style.contentLanguage : ir.style.contentLanguage)
      ].filter(Boolean),
      outputs: [`draft.${hint.target}`, `artifact.${hint.kind}`],
      bindings: ir.flow.map((flowStep) => flowStep.id)
    });
  });

  ir.output.hints.forEach((hint, index) => {
    steps.push({
      id: `output-${index + 1}`,
      stage: "output",
      title: `Package ${hint.label}`,
      detail: `整理并交付 ${hint.label}，保留品牌一致性、文案限制与输出规格。`,
      dependsOn: [generationStepIds[index] ?? referencesStepId],
      inputs: [`draft.${hint.target}`, ...ir.output.targets],
      outputs: [`deliverable.${hint.target}`],
      bindings: [hint.kind, hint.target]
    });
  });

  return {
    version: "planner-plan/0.1",
    source: {
      prompt: ir.source.originalPrompt,
      irVersion: ir.version
    },
    summary: ir.intent.summary || ir.source.normalizedPrompt,
    context: {
      brandId: ir.context.brandId,
      brandName: ir.context.brandName,
      selection: ir.context.selection,
      injected: ir.context.injected,
      primaryOutput: ir.output.primary,
      outputKinds: ir.output.kinds
    },
    steps,
    warnings: [...ir.warnings, ...ir.constraints.warnings]
  };
}

function buildCanvasPlanGraphFromPlan(plan: PlannerPlan): CanvasPlanGraph {
  const stageOrder: PlannerStage[] = ["intent", "context", "references", "generation", "output"];
  const stageColumn = new Map(stageOrder.map((stage, index) => [stage, index]));
  const stageY = new Map<PlannerStage, number>();
  const nodes: CanvasPlanNode[] = plan.steps.map((step) => {
    const stageIndex = stageColumn.get(step.stage) ?? 0;
    const currentY = stageY.get(step.stage) ?? 80;
    stageY.set(step.stage, currentY + 190);
    const type = step.stage === "references" ? "reference" : step.stage;
    return {
      id: step.id,
      type,
      title: step.title,
      body: [step.detail, step.bindings.length ? `Bindings: ${step.bindings.join(", ")}` : ""].filter(Boolean).join("\n"),
      stepId: step.id,
      stage: step.stage,
      x: 80 + stageIndex * 280,
      y: currentY,
      w: step.stage === "generation" ? 300 : 240,
      h: step.stage === "generation" ? 170 : 150,
      inputIds: step.dependsOn.length ? step.dependsOn : undefined
    };
  });
  const edges: CanvasPlanEdge[] = plan.steps.flatMap((step) => step.dependsOn.map((from, index) => ({
    id: `${from}->${step.id}-${index + 1}`,
    from,
    to: step.id
  })));

  return {
    version: "canvas-plan/0.1",
    planVersion: plan.version,
    summary: plan.summary,
    nodes,
    edges,
    warnings: plan.warnings
  };
}

type WorkflowBridgeNodeHint = {
  id: string;
  title?: string;
  body?: string;
  parentId?: string;
  inputIds?: string[];
  preview?: string;
  order: number;
  stage: PlannerStage | "workflow";
  source: "planner" | "canvas" | "heuristic";
};

type WorkflowBridge = {
  ir: CreativeIR;
  plan: PlannerPlan;
  canvasPlan: CanvasPlanGraph;
  nodeHints: WorkflowBridgeNodeHint[];
};

function buildWorkflowBridge(prompt: string, brand: Brand | undefined, settings: GenerationSettings, brandInject = settings.brandInject) {
  const ir = buildCreativeIR(prompt, {
    brandId: brand?.id ?? null,
    brandInject,
    settings
  });
  const plan = buildPlannerPlanFromCreativeIR(ir);
  const canvasPlan = buildCanvasPlanGraphFromPlan(plan);
  const intentStep = plan.steps.find((step) => step.stage === "intent");
  const contextStep = plan.steps.find((step) => step.stage === "context");
  const referenceStep = plan.steps.find((step) => step.stage === "references");
  const generationSteps = plan.steps.filter((step) => step.stage === "generation");
  const outputSteps = plan.steps.filter((step) => step.stage === "output");

  const nodeHints: WorkflowBridgeNodeHint[] = [
    {
      id: "prompt",
      stage: "intent",
      source: "planner",
      order: 0,
      title: intentStep?.title,
      body: intentStep ? `${intentStep.detail}\nPlan: ${intentStep.outputs.join(", ")}` : undefined,
      inputIds: intentStep?.dependsOn
    },
    {
      id: "brand",
      stage: "context",
      source: "planner",
      order: 1,
      title: contextStep?.title,
      body: contextStep ? `${contextStep.detail}\nPlan: ${contextStep.outputs.join(", ")}` : undefined,
      inputIds: contextStep?.dependsOn
    },
    {
      id: "input-image",
      stage: "references",
      source: "canvas",
      order: 2,
      title: referenceStep?.title,
      body: referenceStep?.detail,
      inputIds: referenceStep?.dependsOn
    }
  ];

  if (generationSteps.length) {
    const primaryGeneration = generationSteps[0];
    const needsVisualDraft = generationSteps.length > 1 || ir.output.kinds.includes("document") || ir.output.kinds.includes("video") || ir.output.primary === "jpg" || ir.output.primary === "png" || ir.output.primary === "poster";
    if (needsVisualDraft) {
      nodeHints.push({
        id: "visual-draft",
        stage: "generation",
        source: "planner",
        order: 3,
        title: primaryGeneration.title,
        body: primaryGeneration.detail,
        inputIds: primaryGeneration.dependsOn
      });
    }
  }

  outputSteps.forEach((step, index) => {
    const outputTarget = ir.output.targets[index] ?? ir.output.primary;
    const outputId = index === 0 && ir.output.targets.length === 1 ? "output" : `output-${outputTarget}-${index}`;
    nodeHints.push({
      id: outputId,
      stage: "output",
      source: "planner",
      order: 100 + index,
      title: step.title,
      body: step.detail,
      inputIds: step.dependsOn
    });
  });

  return {
    ir,
    plan,
    canvasPlan,
    nodeHints
  };
}

function workflowNodeTypeForHint(hint: WorkflowBridgeNodeHint): WorkflowNode["type"] {
  if (hint.id === "prompt") return "prompt";
  if (hint.id === "brand") return "brand";
  if (hint.id === "input-image") return "image";
  if (hint.id === "visual-draft") return "image";
  if (hint.stage === "references") return "reference";
  if (hint.stage === "output") return "output";
  if (hint.stage === "generation") return /script/i.test(hint.id) || /脚本/.test(hint.title ?? "") ? "script" : /compose/i.test(hint.id) || /合成/.test(hint.title ?? "") ? "compose" : /video|mp4/i.test(hint.id + " " + (hint.title ?? "")) ? "video" : /pdf|kit|内容编辑器/i.test(hint.id + " " + (hint.title ?? "")) ? "process" : "image";
  return "reference";
}

function applyWorkflowBridgeToNodes(nodes: WorkflowNode[], bridge: WorkflowBridge) {
  const hintById = new Map(bridge.nodeHints.map((hint) => [hint.id, hint]));
  const bridged: WorkflowNode[] = nodes.map((node) => {
    const hint = hintById.get(node.id);
    if (!hint) return node;
    return {
      ...node,
      title: hint.title ?? node.title,
      body: hint.body ? `${node.body}\n\n${hint.body}` : node.body,
      parentId: hint.parentId ?? node.parentId,
      inputIds: hint.inputIds?.length ? hint.inputIds : node.inputIds,
      edgeOffsetY: node.edgeOffsetY
    };
  });
  const existingIds = new Set(bridged.map((node) => node.id));
  const missing: WorkflowNode[] = bridge.nodeHints
    .filter((hint) => !existingIds.has(hint.id))
    .sort((a, b) => a.order - b.order)
    .map((hint) => {
      const type = workflowNodeTypeForHint(hint);
      const parentId = hint.parentId ?? (hint.id === "brand" ? "input-image" : hint.id === "prompt" ? "brand" : hint.stage === "generation" ? "prompt" : hint.stage === "output" ? (existingIds.has("visual-draft") || bridge.nodeHints.some((item) => item.id === "visual-draft") ? "visual-draft" : "prompt") : undefined);
      return {
        id: hint.id,
        type,
        title: hint.title ?? hint.id,
        body: hint.body ?? "",
        parentId,
        inputIds: hint.inputIds?.length ? hint.inputIds : undefined,
        preview: type === "output" ? "#0f172a" : type === "video" ? "#111827" : type === "script" ? "#7c3aed" : type === "compose" ? "#0f766e" : type === "brand" ? "#111827" : "#f97316",
        x: hint.stage === "intent" ? 80 : hint.stage === "context" ? 360 : hint.stage === "references" ? 640 : hint.stage === "generation" ? 920 : 1200,
        y: hint.stage === "generation" ? 100 : 190,
        w: type === "process" || type === "script" || type === "compose" ? 320 : type === "output" || type === "video" ? 260 : 240,
        h: type === "process" || type === "script" || type === "compose" ? 220 : 150,
        edgeOffsetY: 0
      };
    });
  return [...bridged, ...missing].sort((a, b) => {
    const aOrder = hintById.get(a.id)?.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = hintById.get(b.id)?.order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });
}

function buildWorkflowBridgePreviewNodes(prompt: string, brand: Brand | undefined, model: (typeof models)[number], settings: GenerationSettings, brandContext = brand ? buildBrandContext(brand) : "", brandInjected = settings.brandInject) {
  const bridge = buildWorkflowBridge(prompt, brand, settings, brandInjected);
  const baseNodes = buildWorkflowNodes(prompt, brand, model, settings, brandContext, brandInjected);
  return {
    ...bridge,
    workflowNodes: applyWorkflowBridgeToNodes(baseNodes, bridge)
  };
}

function buildFinalPrompt(prompt: string, brandContext: string, inject: boolean, brand?: Brand) {
  prompt = normalizeLegacyPromptRefs(prompt);
  const resolved = resolvePromptAssets(prompt, brand);
  const referenceSummary = [
    resolved.agents.length ? `执行者: ${resolved.agents.map((item) => `@${item}`).join(", ")}` : "",
    resolved.commands.length ? `命令: ${resolved.commands.map((item) => `/${item}`).join(", ")}` : "",
    resolved.imageReferences.length ? `图片资源: ${resolved.imageReferences.map((item) => item.description.split(" · ")[0]).join(", ")}` : "",
    resolved.textReferences.length ? `文本资源: ${resolved.textReferences.map((item) => `${item.key}="${item.value}"`).join(", ")}` : "",
    resolved.lockedTexts.length ? `锁定文字: ${resolved.lockedTexts.map((item) => `"${item}"`).join(", ")}` : "",
    resolved.tags.length ? `主题标签: ${resolved.tags.map((item) => `%${item}`).join(", ")}` : "",
    Object.keys(resolved.params).length ? `参数: ${JSON.stringify(resolved.params)}` : "",
    resolved.outputs.length ? `输出: ${resolved.outputs.join(", ")}` : "",
    resolved.warnings.length ? `缺失提示: ${resolved.warnings.join("；")}` : ""
  ].filter(Boolean).join("\n");
  const taskPrompt = referenceSummary ? `${resolved.prompt}\n\n【资源解析】\n${referenceSummary}` : resolved.prompt;
  if (!inject) return taskPrompt;
  return `${brandContext}\n\n【本次任务】${taskPrompt}\n\n请按 CAL 1.0 执行：@ 是智能体，/ 是命令，$ 是真实资源，双引号是锁定画面文字，% 是主题标签，: 是参数，-> 是输出。$ 图片资源已作为真实参考图传入 VDAMO 图片 API；$copy 和 $brand 文本资源已展开。严格保持品牌字段、素材角色、色彩、Logo/IP/商品一致。`;
}

function stripCalForExecution(prompt: string, resolved: ResolvedPromptAssets) {
  const outputSuffixPattern = /->\s*.+$/gmu;
  return resolved.prompt
    .replace(outputSuffixPattern, " ")
    .replace(/参考图片\s*[\p{L}\p{N}_\-.]+（[^）]+）/gu, " using attached visual reference ")
    .replace(/\b[a-zA-Z0-9_-]+\.(logo|ip|product|model|storefront|environment|scene|background)(?:\.[a-zA-Z0-9_-]+)*/g, " attached reference ")
    .replace(/@[\p{L}\p{N}_\-.]+/gu, " ")
    .replace(/\/[\p{L}\p{N}_\-.]+/gu, " ")
    .replace(/%([\p{L}\p{N}_\-.]+)/gu, (_match, tag) => ` ${tag} style `)
    .replace(/\$[\p{L}\p{N}_\-.]+/gu, " ")
    .replace(/\b(PDF|MP4|pdf|mp4)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    || prompt.replace(outputSuffixPattern, " ").trim();
}

function calWorkflowLine(prompt: string, brand?: Brand, target = "image") {
  const normalized = normalizeLegacyPromptRefs(prompt).trim();
  if (/[@$/%]|->/.test(normalized)) return normalized;
  const brandToken = brand ? `$${brandKey(brand)}` : "$brand";
  const command = target === "mp4" ? "/write-video-script" : target === "pdf" ? "/write-pdf-kit" : "/generate-poster";
  return `@imgen ${command} 使用 ${brandToken}.logo ${brandToken}.ip ${brandToken}.product，${normalized} %premium -> ${target}`;
}

function availableCalRefs(brand?: Brand) {
  if (!brand) return "";
  const roles = new Set(buildReferenceItems(brand, 12).map((item) => item.role));
  const preferred = ["logo", "ip", "product", "model", "storefront"].filter((role) => roles.has(role));
  if (preferred.length) return preferred.map((role) => `$${role}`).join(" ");
  return `$${brandKey(brand)}`;
}

function optimizeWorkflowPrompt(input: string, brand: Brand | undefined, target: WorkflowOutputTarget, orientation: WorkflowOrientation, settings?: Partial<GenerationSettings>) {
  const normalized = normalizeLegacyPromptRefs(input).trim();
  const withoutOutput = normalized.replace(/->\s*.+$/gmu, "").trim();
  const hasCal = /[@$/%]/u.test(withoutOutput);
  const command = commandForFinalOutput(target);
  const refs = availableCalRefs(brand);
  const outputTargets = outputTargetsForFinal(target);
  const orientationTag = target === "mp4" || target === "kit" ? tagForOrientation(orientation) : "";
  const languageParam = settings?.contentLanguage && settings.contentLanguage !== "auto" ? `语言: ${contentLanguageLabel(settings.contentLanguage)}` : "";
  const brandHint = brand && !brandReferenceKeys(brand).some((key) => key && normalizeKey(withoutOutput).includes(key)) ? `为 ${brandKey(brand)}` : "";
  const targetHint = target === "mp4"
    ? "生成图生视频工作流，先生成可控首帧，再创建 MP4 视频任务"
    : target === "pdf"
      ? "生成 PDF 教材/文档工作流，先生成封面主视觉，再组织文档结构"
      : target === "kit"
        ? "生成完整投放套装工作流，包含主视觉、PDF 教材和 MP4 视频"
        : "生成最终投放海报/图片";
  const body = hasCal
    ? [withoutOutput, !/语言\s*:/u.test(withoutOutput) ? languageParam : ""].filter(Boolean).join(" ")
    : ["@imgen", command, refs ? `使用 ${refs}` : "", brandHint, withoutOutput, targetHint, orientationTag, languageParam].filter(Boolean).join(" ");
  const withCommand = body.includes("/") ? body : `@imgen ${command} ${body}`;
  const withAgent = withCommand.includes("@imgen") ? withCommand : `@imgen ${withCommand}`;
  const withOrientation = !orientationTag || /%(vertical|landscape|square)|%竖屏|%横屏|%方图/i.test(withAgent) ? withAgent : `${withAgent} ${orientationTag}`;
  return `${withOrientation.replace(/\s+/g, " ").trim()} -> ${outputTargets.join(", ")}`;
}

function optimizeNodePrompt(input: string, brand: Brand | undefined, nodeType: WorkflowNode["type"], target: WorkflowOutputTarget, orientation: WorkflowOrientation, settings?: Partial<GenerationSettings>) {
  const normalized = normalizeLegacyPromptRefs(input).replace(/->\s*.+$/gmu, "").trim();
  const refs = availableCalRefs(brand);
  const base = normalized || "根据当前画布目标生成可编辑内容";
  const orientationTag = tagForOrientation(orientation);
  const languageParam = settings?.contentLanguage && settings.contentLanguage !== "auto" ? `语言: ${contentLanguageLabel(settings.contentLanguage)}` : "";
  if (nodeType === "video") {
    return `@imgen /generate-video ${refs ? `使用 ${refs}` : ""} ${base} 生成 ${orientation === "portrait" ? "竖屏" : orientation === "square" ? "方形" : "横屏"} 5s 品牌短视频，镜头包含开场钩子、主体展示、品牌收尾 ${orientationTag} ${languageParam} -> mp4`.replace(/\s+/g, " ").trim();
  }
  if (nodeType === "script") {
    return `/write-video-script ${refs ? `使用 ${refs}` : ""} ${base} 输出分镜表格：镜号 | 画面 | 运镜 | 时长 | 音效 | 字幕，便于后续生成 MP4。${languageParam}`.replace(/\s+/g, " ").trim();
  }
  if (nodeType === "process" || nodeType === "prompt" || nodeType === "brand") {
    return `/write-copy ${refs ? `使用 ${refs}` : ""} ${base} 输出可编辑 Markdown：标题、卖点、正文、CTA，不要输出表格。${languageParam}`.replace(/\s+/g, " ").trim();
  }
  if (nodeType === "audio") {
    return `/write-audio ${refs ? `使用 ${refs}` : ""} ${base} 输出音频提示词：情绪、节奏、乐器、段落、结尾记忆点。${languageParam}`.replace(/\s+/g, " ").trim();
  }
  if (nodeType === "compose") {
    return `/compose-video ${base} 按 开场钩子 -> 产品证明 -> 优惠 CTA 合成，转场干净，输出 MP4。`;
  }
  return optimizeWorkflowPrompt(base, brand, target, orientation, settings);
}

function executableImagePrompt(sourcePrompt: string, brand: Brand | undefined, targetLabel: string, settings?: Partial<GenerationSettings>) {
  const resolved = resolvePromptAssets(sourcePrompt, brand);
  const cleanIntent = stripCalForExecution(sourcePrompt, resolved);
  const lockedText = resolved.lockedTexts.length ? resolved.lockedTexts.map((item) => `"${item}"`).join(", ") : "none";
  const textRefs = resolved.textReferences.map((item) => item.value).join("; ") || "none";
  const attachedRefs = resolved.imageReferences.length ? `${resolved.imageReferences.length} attached reference images` : "none";
  const noTextRule = resolved.lockedTexts.length
    ? `Only render these exact text strings if absolutely needed: ${lockedText}.`
    : "TEXT-FREE IMAGE. Do not render any words, letters, headings, captions, labels, code, UI text, or typography.";
  return [
    `Create the final raster artwork for a clean commercial ${targetLabel}.`,
    "This must be a real advertising visual, not an infographic, not a document page, not a prompt sheet, not a UI screenshot, not a list.",
    noTextRule,
    `Scene intent: ${cleanIntent}`,
    brand ? `Brand look: ${brand.name}; use the provided logo/product/IP reference images for visual consistency; color palette ${brand.primaryColor}, ${brand.accentColor}; style ${brand.visualStyle}; tone ${brand.tone}.` : "Brand: none unless explicitly shown in the user intent.",
    `Attached image references: ${attachedRefs}. Use them visually for identity, product shape, character consistency and color; never draw filenames, role names, variable names, or reference labels.`,
    `Text references for meaning only: ${textRefs}.`,
    contentLanguageInstruction(settings, "image"),
    resolved.tags.length ? `Style tags: ${resolved.tags.join(", ")}.` : "",
    Object.keys(resolved.params).length ? `Parameters: ${JSON.stringify(resolved.params)}.` : "",
    settings?.ratio ? `Aspect ratio: ${settings.ratio}.` : "",
    settings?.width && settings?.height ? `Output canvas size: ${settings.width}x${settings.height}px.` : "",
    "Hard constraints: no CAL syntax, no @agents, no $variables, no /commands, no -> targets, no JSON, no code, no markdown tables, no brand context lists, no resource parsing text, no xmanx.logo-style labels. Produce only the final visual artwork."
  ].filter(Boolean).join("\n");
}

function videoDurationSeconds(settings?: { duration?: string } | Partial<GenerationSettings>) {
  const raw = typeof settings?.duration === "number" ? settings.duration : Number.parseInt(String(settings?.duration ?? "5"), 10);
  return Math.max(1, Math.min(60, Number.isFinite(raw) ? raw : 5));
}

function videoShotCount(durationSeconds: number) {
  if (durationSeconds <= 6) return 3;
  if (durationSeconds <= 12) return 4;
  return 5;
}

function videoKeyframeCount(durationSeconds: number) {
  if (durationSeconds <= 8) return 1;
  if (durationSeconds <= 20) return 3;
  return Math.min(5, Number(process.env.VIDEO_MAX_KEYFRAMES ?? "5"));
}

function videoSegmentDurations(durationSeconds: number, maxSegmentSeconds = Number(process.env.VIDEO_MAX_SEGMENT_SECONDS ?? "10")) {
  const safeMax = Math.max(1, Math.min(10, maxSegmentSeconds || 10));
  const segments: number[] = [];
  let remaining = Math.max(1, durationSeconds);
  while (remaining > 0) {
    const next = Math.min(safeMax, remaining);
    segments.push(next);
    remaining -= next;
  }
  return segments;
}

function videoModelClipSeconds(modelName?: string) {
  const normalized = String(modelName ?? "").toLowerCase();
  if (normalized.startsWith("veo_3_1")) return 8;
  if (normalized.includes("grok-imagine") || normalized.includes("video-super")) return 10;
  return Math.max(1, Math.min(60, Number(process.env.VIDEO_MODEL_CLIP_SECONDS ?? "10") || 10));
}

function videoSegmentPlan(durationSeconds: number, modelName?: string) {
  const modelSeconds = videoModelClipSeconds(modelName);
  const targetSegments = videoSegmentDurations(durationSeconds, modelSeconds);
  return targetSegments.map((targetSeconds, index) => ({
    index,
    targetSeconds,
    modelSeconds,
    trim: targetSeconds < modelSeconds
  }));
}

function videoSegmentSummary(durationSeconds: number, modelName?: string) {
  return videoSegmentPlan(durationSeconds, modelName)
    .map((segment) => `S${segment.index + 1} 成片${segment.targetSeconds}s/模型${segment.modelSeconds}s${segment.trim ? "后裁切" : ""}`)
    .join(" / ");
}

function videoNeedsCompose(durationSeconds: number, modelName?: string) {
  const segments = videoSegmentPlan(durationSeconds, modelName);
  return segments.length > 1 || segments.some((segment) => segment.trim);
}

function visualDraftTargetLabel(frame: CanvasFrame) {
  const kinds = new Set(frame.outputs.map((output) => output.kind));
  if (kinds.size === 1 && kinds.has("video")) return "video first-frame key visual, single cinematic frame, not a poster";
  if (kinds.size === 1 && kinds.has("document")) return "PDF cover visual with clean margins and room for typeset text";
  if (kinds.has("video") && kinds.has("document")) return "shared campaign visual for PDF cover and video first frame, clean composition with minimal text";
  if (kinds.has("video")) return "campaign visual plus video first-frame anchor";
  return "master campaign visual for poster/PDF cover";
}

function videoStoryboardBrief(sourcePrompt: string, brand: Brand | undefined, references: ReferenceItem[], settings?: { duration?: string; ratio?: string; contentLanguage?: ContentLanguage | string }) {
  const durationSeconds = videoDurationSeconds(settings);
  const shots = videoShotCount(durationSeconds);
  const perShot = Math.max(1, Math.round(durationSeconds / shots));
  const keyRefs = references.filter((reference) => reference.imageUrl).slice(0, 6);
  const shotLabels = [
    "开场钩子：用首帧建立品牌、Logo、IP/主角和场景关系",
    "主体展示：展示产品、菜单、服务区或核心卖点，保持同一人物和同一 Logo",
    "证明镜头：展示真实环境、价格/套餐或用户使用场景，避免换脸和换品牌",
    "行动号召：回到品牌色、IP 手势和清晰 CTA",
    "收尾定格：保留首帧同款人物、Logo、安全边距和主视觉构图"
  ];
  return [
    `Storyboard plan: ${durationSeconds}s total, ${shots} shots, about ${perShot}s per shot, ratio ${settings?.ratio ?? "16:9"}.`,
    `Continuity lock: same brand ${brandLabel(brand)}, same logo style, same IP/model face, same outfit, same product/menu references across every shot.`,
    keyRefs.length ? `Reference lock: ${keyRefs.map((reference) => `${reference.role}=${reference.title}`).join("; ")}.` : "Reference lock: use the supplied first frame as the single source of truth.",
    ...shotLabels.slice(0, shots).map((label, index) => `Shot ${index + 1} (${perShot}s): ${label}.`),
    contentLanguageInstruction(settings, "video"),
    `Source intent: ${stripCalForExecution(sourcePrompt, resolvePromptAssets(sourcePrompt, brand))}`
  ].filter(Boolean).join("\n");
}

function videoStoryboardSheetPrompt(sourcePrompt: string, brand: Brand | undefined, references: ReferenceItem[], settings: { duration?: string; ratio?: string; contentLanguage?: ContentLanguage | string }, segmentPlan: ReturnType<typeof videoSegmentPlan>) {
  const durationSeconds = videoDurationSeconds(settings);
  const shotCount = Math.max(5, Math.min(10, segmentPlan.length * 5));
  const visualRefs = references.filter((reference) => reference.imageUrl).slice(0, 8);
  return [
    `Create a professional wide storyboard board for a ${durationSeconds}s commercial video, similar to a film production shot sheet, not a final poster.`,
    `Canvas: 16:9 wide storyboard layout with dark premium background, thin gold dividers, clear panels, ${shotCount} numbered shot cells, video info row, character reference area, scene reference area, and brand lock notes.`,
    "Each shot cell must contain one coherent cinematic frame thumbnail plus short shot action labels. The board should be useful for a video director to generate consistent image-to-video clips.",
    brand ? `Brand identity lock: ${brand.name}; exact logo text ${brand.logoText}; IP/model identity ${brand.ipName}; colors ${brand.primaryColor}/${brand.accentColor}; visual style ${brand.visualStyle}.` : "Brand identity lock: only use supplied references.",
    visualRefs.length ? `Use supplied image references as the source of truth for character face, hair, horns/outfit, logo, restaurant/product/menu details: ${visualRefs.map((reference) => `${reference.role}=${reference.title}`).join("; ")}.` : "",
    `Segment plan: ${segmentPlan.map((segment) => `S${segment.index + 1}: source ${segment.modelSeconds}s, final ${segment.targetSeconds}s${segment.trim ? " trimmed" : ""}`).join(" / ")}.`,
    `Intent: ${stripCalForExecution(sourcePrompt, resolvePromptAssets(sourcePrompt, brand))}`,
    contentLanguageInstruction(settings, "image"),
    "Hard constraints: no random new person, no alternate mascot, no changed uniform, no distorted logo, no off-brand character, no watermark, no app UI screenshot, no unrelated brand."
  ].filter(Boolean).join("\n");
}

function videoKeyframePrompt(sourcePrompt: string, brand: Brand | undefined, references: ReferenceItem[], settings: { duration?: string; ratio?: string; contentLanguage?: ContentLanguage | string }, shotIndex: number, shotCount: number) {
  const durationSeconds = videoDurationSeconds(settings);
  const perShot = Math.max(1, Math.round(durationSeconds / Math.max(1, shotCount)));
  const shotText = [
    "opening hook with brand identity, logo safe area, IP/model face and restaurant/product context",
    "main action with product/menu/service area and the same IP/model identity",
    "proof shot with food, environment, price/menu or user experience while keeping the same brand world",
    "CTA shot with brand color, friendly gesture and clean closing composition",
    "final lockup with logo/IP/product consistency and space for editing"
  ][Math.min(shotIndex, 4)];
  return [
    `Create ONE video keyframe image for shot ${shotIndex + 1}/${shotCount}.`,
    "Purpose: this image will be submitted to the video model as visual reference / first frame, not used as the final poster.",
    "Do not create a collage, storyboard sheet, menu page, PDF page, infographic, UI screenshot, or text-heavy layout.",
    "Make it a single coherent cinematic frame with clear subject, stable camera-ready composition, and realistic motion potential.",
    `Shot timing: about ${perShot}s within a ${durationSeconds}s video. Shot role: ${shotText}.`,
    brand ? `Brand lock: ${brand.name}, logo style, IP/model face/outfit, product/menu materials, colors ${brand.primaryColor}/${brand.accentColor}, visual style ${brand.visualStyle}.` : "Brand lock: only use explicitly supplied visual references.",
    references.length ? `Use attached references for identity and consistency: ${references.slice(0, 8).map((reference) => `${reference.role}=${reference.title}`).join("; ")}.` : "",
    "Identity lock is mandatory: keep the exact same face, hairstyle, horns/outfit/uniform, logo style, restaurant world and product/menu references across every keyframe. Do not invent another model or mascot.",
    `Intent: ${stripCalForExecution(sourcePrompt, resolvePromptAssets(sourcePrompt, brand))}`,
    contentLanguageInstruction(settings, "image"),
    `Aspect ratio: ${settings.ratio ?? "16:9"}.`,
    "Hard constraints: no random new character, no changed logo, no changed uniform, no broken text, no CAL variables, no table, no long copy."
  ].filter(Boolean).join("\n");
}

function videoReferencePriority(reference: ReferenceItem) {
  const priority: Record<string, number> = {
    logo: 0,
    ip: 1,
    model: 2,
    product: 3,
    menu: 4,
    storefront: 5,
    environment: 6,
    "storyboard-sheet": 7,
    "first-frame": 8,
    keyframe: 9,
    "video-preview": 10
  };
  return priority[reference.role] ?? 20;
}

function stableVideoReferences(references: ReferenceItem[], limit = 10) {
  return references
    .filter((reference) => reference.imageUrl)
    .filter((reference, index, list) => list.findIndex((item) => item.id === reference.id || item.imageUrl === reference.imageUrl) === index)
    .sort((a, b) => videoReferencePriority(a) - videoReferencePriority(b))
    .slice(0, limit);
}

function executableVideoPrompt(sourcePrompt: string, brand: Brand | undefined, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean; contentLanguage?: ContentLanguage | string }, references: ReferenceItem[] = []) {
  const resolved = resolvePromptAssets(sourcePrompt, brand);
  const cleanIntent = stripCalForExecution(sourcePrompt, resolved);
  const allReferences = [...references, ...resolved.imageReferences]
    .filter((reference, index, list) => reference.imageUrl && list.findIndex((item) => item.id === reference.id) === index);
  return [
    "Create a short commercial video from this CAL workflow.",
    "If an input/first-frame image is supplied, treat it as the exact visual identity anchor for the first frame and continuity reference for every later shot.",
    `User intent: ${cleanIntent}`,
    brand ? `Brand: ${brand.name}; visual style ${brand.visualStyle}; tone ${brand.tone}; colors ${brand.primaryColor} and ${brand.accentColor}.` : "Brand: none unless explicitly referenced.",
    allReferences.length ? `Submitted visual references: ${allReferences.map((item) => `${item.role} ${item.title}`).join("; ")}.` : "",
    videoStoryboardBrief(sourcePrompt, brand, allReferences, settings),
    resolved.lockedTexts.length ? `Only use these exact on-screen texts if needed: ${resolved.lockedTexts.map((item) => `"${item}"`).join(", ")}.` : "Avoid on-screen text unless necessary.",
    resolved.tags.length ? `Style tags: ${resolved.tags.join(", ")}.` : "",
    `Video mode: ${settings?.mode ?? "text-to-video"}; ratio ${settings?.ratio ?? "16:9"}; duration ${settings?.duration ?? "5s"}; audio ${settings?.sound === false ? "off" : "on"}.`,
    "Hard constraints: do not show CAL syntax, variables, tables, JSON, or UI screenshots. Generate the final advertisement motion."
  ].filter(Boolean).join("\n");
}

async function videoInputImageDataUrl(imageUrl?: string) {
  if (!imageUrl) return "";
  if (/^data:image\/(png|jpe?g|webp);base64,/i.test(imageUrl)) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const filePath = localPublicPathFromUrl(imageUrl);
  if (!filePath) return "";
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  const bytes = await readFile(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

type PublishedReferenceResolution = {
  source: "missing" | "external-url" | "local-generated" | "local-public" | "unsupported";
  strategy: "none" | "direct-external" | "public-base-signed" | "unpublished";
  url: string;
  requiresPublicBaseUrl: boolean;
  publishReady: boolean;
  reason?: string;
};

type ReferencePublicationProviderId = "public-base-url" | "object-storage" | "upload-service-stub";

type ReferencePublicationStatus = {
  configured: boolean;
  baseUrl: string;
  baseUrlSource: string;
  publicationStrategy: PublishedReferenceResolution["strategy"];
  publicationProvider: ReferencePublicationProviderId;
  signedGeneratedUrls: boolean;
  hostKind: string;
  canUseLocalGeneratedAssets: boolean;
  productionReady: boolean;
  message: string;
};

type ReferencePublicationProvider = {
  id: ReferencePublicationProviderId;
  resolve(assetUrl?: string): Promise<PublishedReferenceResolution>;
  status(): ReferencePublicationStatus;
};

function classifyReferenceHost(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || /^127\./.test(hostname);
  const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname);
  const isPrivateHost = hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan");
  const hostKind = isLoopback ? "loopback" : isPrivateIpv4 || isPrivateHost ? "private" : "public";
  const productionReady = parsed.protocol === "https:" && hostKind === "public";
  return { parsed, hostKind, productionReady };
}

function publicUrlFromLocalAsset(assetUrl?: string, options: { signed?: boolean } = {}) {
  if (!assetUrl?.startsWith("/")) return "";
  const publicBase = (process.env.SPARKCANVAS_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBase) return "";
  const relativeUrl = options.signed ? generatedFileUrl(assetUrl) : assetUrl;
  return relativeUrl ? `${publicBase}${relativeUrl}` : "";
}

function resolveDirectExternalReference(assetUrl: string, label: string): PublishedReferenceResolution {
  if (isProduction) {
    try {
      const { productionReady } = classifyReferenceHost(assetUrl);
      if (!productionReady) {
        return {
          source: "external-url",
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: `${label}-non-production-url`
        };
      }
    } catch {
      return {
        source: "external-url",
        strategy: "unpublished",
        url: "",
        requiresPublicBaseUrl: false,
        publishReady: false,
        reason: `${label}-invalid-url`
      };
    }
  }
  return {
    source: "external-url",
    strategy: "direct-external",
    url: assetUrl,
    requiresPublicBaseUrl: false,
    publishReady: true
  };
}

function publicBaseUrlPublicationProvider(): ReferencePublicationProvider {
  return {
    id: "public-base-url",
    async resolve(assetUrl?: string) {
      if (!assetUrl) {
        return {
          source: "missing",
          strategy: "none",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: "missing-reference"
        };
      }
      if (/^https?:\/\//i.test(assetUrl)) {
        return resolveDirectExternalReference(assetUrl, "public-base-url");
      }
      if (!assetUrl.startsWith("/")) {
        return {
          source: "unsupported",
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: "unsupported-reference-path"
        };
      }
      const source = assetUrl.startsWith("/generated/") ? "local-generated" : "local-public";
      const signedUrl = publicUrlFromLocalAsset(assetUrl, { signed: true });
      if (!signedUrl) {
        return {
          source,
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: true,
          publishReady: false,
          reason: "missing-public-base-url"
        };
      }
      return {
        source,
        strategy: "public-base-signed",
        url: signedUrl,
        requiresPublicBaseUrl: true,
        publishReady: true
      };
    },
    status() {
      const rawBaseUrl = (process.env.SPARKCANVAS_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "").trim();
      const baseUrl = rawBaseUrl.replace(/\/$/, "");
      const baseUrlSource = process.env.SPARKCANVAS_PUBLIC_BASE_URL
        ? "SPARKCANVAS_PUBLIC_BASE_URL"
        : process.env.PUBLIC_BASE_URL
          ? "PUBLIC_BASE_URL"
          : "missing";
      const signedGeneratedUrls = true;
      const publicationStrategy: PublishedReferenceResolution["strategy"] = baseUrl ? "public-base-signed" : "unpublished";
      if (!baseUrl) {
        return {
          configured: false,
          baseUrl: "",
          baseUrlSource,
          publicationStrategy,
          publicationProvider: "public-base-url",
          signedGeneratedUrls,
          hostKind: "missing",
          canUseLocalGeneratedAssets: false,
          productionReady: false,
          message: "未设置 SPARKCANVAS_PUBLIC_BASE_URL；本地 /generated 图片不能安全作为生产环境 input_reference。"
        };
      }
      try {
        const { hostKind, productionReady } = classifyReferenceHost(baseUrl);
        return {
          configured: true,
          baseUrl,
          baseUrlSource,
          publicationStrategy,
          publicationProvider: "public-base-url",
          signedGeneratedUrls,
          hostKind,
          canUseLocalGeneratedAssets: true,
          productionReady,
          message: productionReady
            ? "本地生成图片可被签名为公网 input_reference URL，生产环境首帧引用已就绪。"
            : hostKind === "public"
              ? "当前 public base URL 可生成外链，但不是 HTTPS；建议切到公网 HTTPS 域名后再用于生产 input_reference。"
              : "当前 public base URL 仅适合本机/内网联调；生产环境 input_reference 仍需公网 HTTPS 域名。"
        };
      } catch {
        return {
          configured: true,
          baseUrl,
          baseUrlSource,
          publicationStrategy,
          publicationProvider: "public-base-url",
          signedGeneratedUrls,
          hostKind: "invalid",
          canUseLocalGeneratedAssets: false,
          productionReady: false,
          message: "SPARKCANVAS_PUBLIC_BASE_URL 不是合法 URL；本地 /generated 图片不能作为生产 input_reference。"
        };
      }
    }
  };
}

async function publishLocalReferenceAssetViaHttpUpload(assetUrl: string, options: {
  endpoint: string;
  token?: string;
  label: string;
}) {
  if (!options.endpoint) {
    return { ok: false as const, reason: `missing-${options.label}-url`, url: "" };
  }
  const filePath = localPublicPathFromUrl(assetUrl);
  if (!filePath) {
    return { ok: false as const, reason: `missing-local-public-file`, url: "" };
  }
  const bytes = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/png";
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SPARKCANVAS_REFERENCE_UPLOAD_TIMEOUT_MS ?? process.env.AI_REQUEST_TIMEOUT_MS ?? "120000");
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        "content-type": mime,
        "x-sparkcanvas-filename": path.basename(filePath),
        "x-sparkcanvas-source-url": assetUrl,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
      },
      body: bytes,
      signal: controller.signal
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message = typeof data === "string" ? data : JSON.stringify(data);
      return { ok: false as const, reason: `${options.label}-http-${response.status}`, url: "", message: message.slice(0, 240) };
    }
    const publishedUrl = typeof data === "object" && data && typeof data === "object"
      ? (typeof (data as { url?: unknown }).url === "string" && (data as { url: string }).url.trim())
        || (typeof (data as { publicUrl?: unknown }).publicUrl === "string" && (data as { publicUrl: string }).publicUrl.trim())
        || (typeof (data as { location?: unknown }).location === "string" && (data as { location: string }).location.trim())
        || (typeof (data as { objectUrl?: unknown }).objectUrl === "string" && (data as { objectUrl: string }).objectUrl.trim())
      : "";
    if (!publishedUrl) {
      return { ok: false as const, reason: `${options.label}-missing-url`, url: "" };
    }
    if (!/^https?:\/\//i.test(publishedUrl)) {
      return { ok: false as const, reason: `${options.label}-invalid-url`, url: "", message: publishedUrl.slice(0, 240) };
    }
    if (isProduction) {
      try {
        const { productionReady } = classifyReferenceHost(publishedUrl);
        if (!productionReady) {
          return { ok: false as const, reason: `${options.label}-non-production-url`, url: "", message: publishedUrl.slice(0, 240) };
        }
      } catch {
        return { ok: false as const, reason: `${options.label}-invalid-url`, url: "" };
      }
    }
    return { ok: true as const, reason: "uploaded", url: publishedUrl };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false as const, reason: `${options.label}-timeout`, url: "" };
    }
    return { ok: false as const, reason: `${options.label}-request-failed`, url: "", message: error instanceof Error ? error.message.slice(0, 240) : "unknown error" };
  } finally {
    clearTimeout(timer);
  }
}

async function publishLocalReferenceAssetViaUploadService(assetUrl: string) {
  return publishLocalReferenceAssetViaHttpUpload(assetUrl, {
    endpoint: (process.env.SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL || "").trim(),
    token: process.env.SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_TOKEN || undefined,
    label: "upload-service"
  });
}

function objectStorageReferencePublicationProvider(): ReferencePublicationProvider {
  return {
    id: "object-storage",
    async resolve(assetUrl?: string) {
      if (!assetUrl) {
        return {
          source: "missing",
          strategy: "none",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: "missing-reference"
        };
      }
      if (/^https?:\/\//i.test(assetUrl)) {
        return resolveDirectExternalReference(assetUrl, "object-storage");
      }
      if (!assetUrl.startsWith("/")) {
        return {
          source: "unsupported",
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: "unsupported-reference-path"
        };
      }
      const source = assetUrl.startsWith("/generated/") ? "local-generated" : "local-public";
      const published = await publishLocalReferenceAssetViaHttpUpload(assetUrl, {
        endpoint: (process.env.SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL || "").trim(),
        token: process.env.SPARKCANVAS_REFERENCE_OBJECT_STORAGE_TOKEN || undefined,
        label: "object-storage"
      });
      if (!published.ok) {
        return {
          source,
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: published.reason
        };
      }
      const { productionReady } = classifyReferenceHost(published.url);
      if (isProduction && !productionReady) {
        return {
          source,
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: published.reason || "object-storage-non-production-url"
        };
      }
      return {
        source,
        strategy: "direct-external",
        url: published.url,
        requiresPublicBaseUrl: false,
        publishReady: true
      };
    },
    status() {
      const rawBaseUrl = (process.env.SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL || "").trim();
      if (!rawBaseUrl) {
        return {
          configured: false,
          baseUrl: "",
          baseUrlSource: "missing",
          publicationStrategy: "unpublished",
          publicationProvider: "object-storage",
          signedGeneratedUrls: false,
          hostKind: "missing",
          canUseLocalGeneratedAssets: false,
          productionReady: false,
          message: "未设置 SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL；object-storage 发布链路未启用。"
        };
      }
      try {
        const { hostKind, productionReady } = classifyReferenceHost(rawBaseUrl);
        return {
          configured: true,
          baseUrl: rawBaseUrl,
          baseUrlSource: "SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL",
          publicationStrategy: "direct-external",
          publicationProvider: "object-storage",
          signedGeneratedUrls: false,
          hostKind,
          canUseLocalGeneratedAssets: true,
          productionReady,
          message: productionReady
            ? "object-storage 发布链路已配置；本地参考图可上传后作为公网 input_reference。"
            : hostKind === "public"
              ? "object-storage 可返回外链，但当前不是 HTTPS；建议切到公网 HTTPS 再用于生产 input_reference。"
              : "object-storage 目前仅适合本机/内网联调；生产环境仍需公网 HTTPS 上传出口。"
        };
      } catch {
        return {
          configured: true,
          baseUrl: rawBaseUrl,
          baseUrlSource: "SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL",
          publicationStrategy: "unpublished",
          publicationProvider: "object-storage",
          signedGeneratedUrls: false,
          hostKind: "invalid",
          canUseLocalGeneratedAssets: false,
          productionReady: false,
          message: "SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL 不是合法 URL；object-storage 发布链路不可用。"
        };
      }
    }
  };
}

function uploadServiceReferencePublicationProvider(): ReferencePublicationProvider {
  return {
    id: "upload-service-stub",
    async resolve(assetUrl?: string) {
      if (!assetUrl) {
        return {
          source: "missing",
          strategy: "none",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: "missing-reference"
        };
      }
      if (/^https?:\/\//i.test(assetUrl)) {
        return resolveDirectExternalReference(assetUrl, "upload-service");
      }
      if (!assetUrl.startsWith("/")) {
        return {
          source: "unsupported",
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: "unsupported-reference-path"
        };
      }
      const source = assetUrl.startsWith("/generated/") ? "local-generated" : "local-public";
      const published = await publishLocalReferenceAssetViaUploadService(assetUrl);
      if (!published.ok) {
        return {
          source,
          strategy: "unpublished",
          url: "",
          requiresPublicBaseUrl: false,
          publishReady: false,
          reason: published.reason
        };
      }
      return {
        source,
        strategy: "direct-external",
        url: published.url,
        requiresPublicBaseUrl: false,
        publishReady: true
      };
    },
    status() {
      const rawBaseUrl = (process.env.SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL || "").trim();
      if (!rawBaseUrl) {
        return {
          configured: false,
          baseUrl: "",
          baseUrlSource: "missing",
          publicationStrategy: "unpublished",
          publicationProvider: "upload-service-stub",
          signedGeneratedUrls: false,
          hostKind: "stub",
          canUseLocalGeneratedAssets: false,
          productionReady: false,
          message: "未设置 SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL；upload-service 发布链路未启用。"
        };
      }
      try {
        const { hostKind, productionReady } = classifyReferenceHost(rawBaseUrl);
        return {
          configured: true,
          baseUrl: rawBaseUrl,
          baseUrlSource: "SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL",
          publicationStrategy: "direct-external",
          publicationProvider: "upload-service-stub",
          signedGeneratedUrls: false,
          hostKind,
          canUseLocalGeneratedAssets: true,
          productionReady,
          message: productionReady
            ? "upload-service 发布链路已配置；本地参考图可先上传再作为公网 input_reference。"
            : hostKind === "public"
              ? "upload-service 可返回外链，但当前不是 HTTPS；建议切到公网 HTTPS 再用于生产 input_reference。"
              : "upload-service 目前仅适合本机/内网联调；生产环境仍需公网 HTTPS 上传出口。"
        };
      } catch {
        return {
          configured: true,
          baseUrl: rawBaseUrl,
          baseUrlSource: "SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL",
          publicationStrategy: "unpublished",
          publicationProvider: "upload-service-stub",
          signedGeneratedUrls: false,
          hostKind: "invalid",
          canUseLocalGeneratedAssets: false,
          productionReady: false,
          message: "SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL 不是合法 URL；upload-service 发布链路不可用。"
        };
      }
    }
  };
}

function referencePublicationProvider(): ReferencePublicationProvider {
  const provider = (process.env.SPARKCANVAS_REFERENCE_PUBLICATION_PROVIDER || "").trim().toLowerCase();
  if (provider === "object-storage") return objectStorageReferencePublicationProvider();
  if (provider === "upload-service") return uploadServiceReferencePublicationProvider();
  return publicBaseUrlPublicationProvider();
}

async function resolvePublishedReferenceAssetUrl(assetUrl?: string): Promise<PublishedReferenceResolution> {
  return referencePublicationProvider().resolve(assetUrl);
}

function describeReferencePublicationFailure(model: string, publication: PublishedReferenceResolution) {
  const providerStatus = referencePublicationProvider().status();
  const provider = providerStatus.publicationProvider;
  const reason = publication.reason || "unknown";
  const providerLabel = provider === "object-storage"
    ? "object-storage"
    : provider === "upload-service-stub"
      ? "upload-service"
      : "public-base-url";
  const hint = provider === "public-base-url"
    ? "请设置 SPARKCANVAS_PUBLIC_BASE_URL，或先把本地图片上传到图床后再生成视频。"
    : provider === "object-storage"
      ? "请检查对象存储上传出口是否返回公网 HTTPS URL，或切回 SPARKCANVAS_PUBLIC_BASE_URL。"
      : "请检查 upload-service 是否成功返回公网 HTTPS URL，或切回 SPARKCANVAS_PUBLIC_BASE_URL。";
  return `${model} 的参考图参数需要公网图片链接。当前 provider: ${providerLabel}；发布策略: ${publication.strategy}；失败原因: ${reason}。${hint}`;
}

async function videoInputReferenceUrl(imageUrl?: string) {
  return (await resolvePublishedReferenceAssetUrl(imageUrl)).url;
}

function localGeneratedVideoPath(videoUrl?: string) {
  if (!videoUrl?.startsWith("/generated/")) return undefined;
  const filePath = path.join(generatedDir, videoUrl.replace(/^\/generated\//, ""));
  return existsSync(filePath) ? filePath : undefined;
}

function resolveFfmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg"
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

async function runFfmpeg(args: string[], timeoutMs = 120000) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return false;
  return new Promise<boolean>((resolve) => {
    const child = spawn(ffmpegPath, ["-y", ...args], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function materializeVideoUrl(videoUrl: string, outputName: string, index: number) {
  const localPath = localGeneratedVideoPath(videoUrl);
  if (localPath) return localPath;
  if (!/^https?:\/\//i.test(videoUrl)) return "";
  await mkdir(generatedDir, { recursive: true });
  const outputPath = path.join(generatedDir, `${outputName}-source-${index + 1}.mp4`);
  const timeoutMs = Number(process.env.SPARKCANVAS_VIDEO_DOWNLOAD_TIMEOUT_MS ?? process.env.AI_REQUEST_TIMEOUT_MS ?? "120000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(videoUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`video download failed with ${response.status}: ${videoUrl}`);
    }
    const bytes = Buffer.from(await Promise.race([
      response.arrayBuffer(),
      new Promise<ArrayBuffer>((_, reject) => {
        setTimeout(() => reject(new Error(`video download timed out after ${Math.round(timeoutMs / 1000)}s: ${videoUrl}`)), timeoutMs);
      })
    ]));
    if (bytes.length < 512) {
      throw new Error(`video download returned too few bytes (${bytes.length}): ${videoUrl}`);
    }
    await writeFile(outputPath, bytes);
    return outputPath;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`video download timed out after ${Math.round(timeoutMs / 1000)}s: ${videoUrl}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function materializeVideoPublicUrl(videoUrl: string, outputName: string, index: number) {
  if (!videoUrl) return "";
  if (videoUrl.startsWith("/generated/")) return videoUrl;
  const localPath = await materializeVideoUrl(videoUrl, outputName, index);
  if (!localPath) return "";
  const relativePath = path.relative(generatedDir, localPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return "";
  return `/generated/${relativePath.split(path.sep).join("/")}`;
}

async function bestEffortMaterializeVideoPublicUrl(videoUrl: string, outputName: string, index: number, timeoutMs = Number(process.env.SPARKCANVAS_VIDEO_MATERIALIZE_TIMEOUT_MS ?? "2500")) {
  return await Promise.race([
    materializeVideoPublicUrl(videoUrl, outputName, index),
    new Promise<string>((resolve) => setTimeout(() => resolve(""), timeoutMs))
  ]);
}

async function usableVideoFile(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.size > 512;
  } catch {
    return false;
  }
}

type ComposeVerification = {
  ok: boolean;
  mergedUrl: string;
  sourceCount: number;
  requiredSegments: number;
  materializedSegments: number;
  trimmedSegments: number;
  continuityChecks: string[];
  failureReason: string;
};

async function composeLocalVideosDetailed(videoUrls: string[], segments: ReturnType<typeof videoSegmentPlan>, outputName: string): Promise<ComposeVerification> {
  const continuityChecks = [
    `段数校验: 需要 ${segments.length} 段，当前收到 ${videoUrls.length} 个候选片段。`,
    `时长校验: ${segments.map((segment) => `S${segment.index + 1}=${segment.targetSeconds}s/${segment.modelSeconds}s${segment.trim ? " trim" : ""}`).join(" / ")}`,
    "连续性校验: 保持统一旁白语言/音色、BGM 节奏、品牌空间、IP/模特与 Logo 安全边距。"
  ];
  if (!videoUrls.length) {
    return { ok: false, mergedUrl: "", sourceCount: 0, requiredSegments: segments.length, materializedSegments: 0, trimmedSegments: segments.filter((segment) => segment.trim).length, continuityChecks, failureReason: "no-video-urls" };
  }
  if (videoUrls.length < segments.length) {
    return { ok: false, mergedUrl: "", sourceCount: videoUrls.length, requiredSegments: segments.length, materializedSegments: 0, trimmedSegments: segments.filter((segment) => segment.trim).length, continuityChecks, failureReason: "insufficient-video-urls" };
  }
  if (!resolveFfmpegPath()) {
    return { ok: false, mergedUrl: "", sourceCount: videoUrls.length, requiredSegments: segments.length, materializedSegments: 0, trimmedSegments: segments.filter((segment) => segment.trim).length, continuityChecks, failureReason: "ffmpeg-unavailable" };
  }
  await mkdir(generatedDir, { recursive: true });
  const preparedPaths: string[] = [];
  for (const [index, segment] of segments.entries()) {
    const sourcePath = await materializeVideoUrl(videoUrls[index], outputName, index);
    if (!sourcePath) {
      return { ok: false, mergedUrl: "", sourceCount: videoUrls.length, requiredSegments: segments.length, materializedSegments: preparedPaths.length, trimmedSegments: segments.filter((item) => item.trim).length, continuityChecks, failureReason: `segment-${index + 1}-materialize-failed` };
    }
    const segmentPath = path.join(generatedDir, `${outputName}-segment-${index + 1}.mp4`);
    const ok = await runFfmpeg([
      "-i", sourcePath,
      "-t", String(segment.targetSeconds),
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      segmentPath
    ]);
    if (!ok || !existsSync(segmentPath) || !(await usableVideoFile(segmentPath))) {
      return { ok: false, mergedUrl: "", sourceCount: videoUrls.length, requiredSegments: segments.length, materializedSegments: preparedPaths.length + 1, trimmedSegments: segments.filter((item) => item.trim).length, continuityChecks, failureReason: `segment-${index + 1}-trim-or-encode-failed` };
    }
    preparedPaths.push(segmentPath);
  }
  if (preparedPaths.length === 1) {
    const finalPath = path.join(generatedDir, `${outputName}.mp4`);
    renameSync(preparedPaths[0], finalPath);
    const mergedUrl = await usableVideoFile(finalPath) ? `/generated/${outputName}.mp4` : "";
    return { ok: Boolean(mergedUrl), mergedUrl, sourceCount: videoUrls.length, requiredSegments: segments.length, materializedSegments: preparedPaths.length, trimmedSegments: segments.filter((item) => item.trim).length, continuityChecks, failureReason: mergedUrl ? "" : "single-segment-finalize-failed" };
  }
  const listPath = path.join(generatedDir, `${outputName}-concat.txt`);
  const outputPath = path.join(generatedDir, `${outputName}.mp4`);
  const listBody = preparedPaths.map((filePath) => `file '${String(filePath).replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listBody);
  const ok = await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  const mergedUrl = ok && existsSync(outputPath) && await usableVideoFile(outputPath) ? `/generated/${outputName}.mp4` : "";
  return { ok: Boolean(mergedUrl), mergedUrl, sourceCount: videoUrls.length, requiredSegments: segments.length, materializedSegments: preparedPaths.length, trimmedSegments: segments.filter((item) => item.trim).length, continuityChecks, failureReason: mergedUrl ? "" : "concat-failed" };
}

async function composeLocalVideos(videoUrls: string[], segments: ReturnType<typeof videoSegmentPlan>, outputName: string) {
  const result = await composeLocalVideosDetailed(videoUrls, segments, outputName);
  return result.mergedUrl;
}

async function concatLocalVideos(videoUrls: string[], outputName: string) {
  const localPaths = videoUrls.map(localGeneratedVideoPath);
  if (localPaths.some((item) => !item)) return "";
  if (!resolveFfmpegPath()) return "";
  await mkdir(generatedDir, { recursive: true });
  const listPath = path.join(generatedDir, `${outputName}-concat.txt`);
  const outputPath = path.join(generatedDir, `${outputName}.mp4`);
  const listBody = localPaths.map((filePath) => `file '${String(filePath).replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listBody);
  const ok = await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], 60000);
  return ok ? `/generated/${outputName}.mp4` : "";
}

type VideoModelCapability = {
  referenceParam: "input_reference";
  referenceType: "url";
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsEndFrames: boolean;
  imageReferenceRequiresLandscape: boolean;
  defaultTextSize: string;
  defaultImageSize: string;
  expiresHours?: number;
};

function videoModelCapability(model: string): VideoModelCapability {
  const normalized = model.toLowerCase();
  if (normalized === "veo_3_1-fast-fl") {
    return {
      referenceParam: "input_reference",
      referenceType: "url",
      supportsTextToVideo: false,
      supportsImageToVideo: true,
      supportsEndFrames: true,
      imageReferenceRequiresLandscape: false,
      defaultTextSize: "1920x1080",
      defaultImageSize: "1920x1080",
      expiresHours: 6
    };
  }
  if (normalized === "veo_3_1-fast" || normalized === "veo_3_1-4k") {
    return {
      referenceParam: "input_reference",
      referenceType: "url",
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      supportsEndFrames: false,
      imageReferenceRequiresLandscape: true,
      defaultTextSize: "1920x1080",
      defaultImageSize: "1920x1080",
      expiresHours: 6
    };
  }
  return {
    referenceParam: "input_reference",
    referenceType: "url",
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsEndFrames: false,
    imageReferenceRequiresLandscape: false,
    defaultTextSize: "1280x720",
    defaultImageSize: "720x1280"
  };
}

function videoCanvasSize(settings?: { ratio?: string }) {
  const ratio = settings?.ratio?.split("·")[0]?.trim() || "16:9";
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 1024, height: 1024 };
  if (ratio === "4:5") return { width: 1080, height: 1350 };
  return { width: 1280, height: 720 };
}

function videoSizeParam(model: string, settings?: { ratio?: string }, hasInputReference = false) {
  const capability = videoModelCapability(model);
  if (hasInputReference && capability.imageReferenceRequiresLandscape) return capability.defaultImageSize;
  const { width, height } = videoCanvasSize(settings);
  return `${width}x${height}`;
}

function videoModelNeedsFirstFrameFallback(model: string) {
  const forced = process.env.VIDEO_STRICT_FIRST_FRAME_FALLBACK;
  if (forced === "1") return true;
  if (forced === "0") return false;
  return /grok-imagine|video-super|yijiarj/i.test(model);
}

async function createFirstFrameLockedVideo(firstFrameUrl: string, outputName: string, settings?: { ratio?: string; duration?: string }) {
  const sourcePath = localPublicPathFromUrl(firstFrameUrl);
  if (!sourcePath || !resolveFfmpegPath()) return "";
  const preparedSourcePath = await compactReferenceImage(sourcePath, `${outputName}-first-frame`, 0);
  const durationSeconds = videoDurationSeconds(settings);
  const { width, height } = videoCanvasSize(settings);
  await mkdir(generatedDir, { recursive: true });
  const outputPath = path.join(generatedDir, `${outputName}.mp4`);
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "format=yuv420p"
  ].join(",");
  const ok = await runFfmpeg([
    "-loop", "1",
    "-framerate", "12",
    "-i", preparedSourcePath,
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf", filter,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-t", String(durationSeconds),
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ], 30000);
  return ok && existsSync(outputPath) && await usableVideoFile(outputPath) ? `/generated/${outputName}.mp4` : "";
}

function localPublicPathFromUrl(imageUrl?: string) {
  if (!imageUrl?.startsWith("/")) return undefined;
  const [pathname] = imageUrl.split(/[?#]/, 1);
  const relative = pathname.replace(/^\/+/, "");
  const candidate = relative.startsWith("generated/")
    ? path.join(generatedDir, relative.replace(/^generated\//, ""))
    : path.join(frontendPublicDir, relative);
  return existsSync(candidate) ? candidate : undefined;
}

async function compactReferenceImage(sourcePath: string, outputName: string, index: number) {
  if (!/\.(png|jpe?g|webp)$/i.test(sourcePath)) return sourcePath;
  await mkdir(generatedDir, { recursive: true });
  const compactPath = path.join(generatedDir, `${outputName}-ref-${index + 1}-compact.jpg`);
  const candidates = [
    { command: process.env.MAGICK_PATH || "magick", args: [sourcePath, "-resize", "768x768>", "-quality", "82", compactPath] },
    { command: process.env.CONVERT_PATH || "convert", args: [sourcePath, "-resize", "768x768>", "-quality", "82", compactPath] },
    { command: "sips", args: ["-Z", "768", "-s", "format", "jpeg", sourcePath, "--out", compactPath] }
  ];
  for (const candidate of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(candidate.command, candidate.args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(false);
      }, 10000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0 && existsSync(compactPath));
      });
    });
    if (ok) return compactPath;
  }
  return sourcePath;
}

function isRecognizedAuthToken(token?: string) {
  if (!token) return false;
  if (process.env.SPARKCANVAS_AUTH_TOKEN && token === process.env.SPARKCANVAS_AUTH_TOKEN) return true;
  return db.sessions.some((session) => session.token === token);
}

function generatedFileRequestAuthorized(req: Request) {
  if (!isProduction) return true;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  return isRecognizedAuthToken(bearer) || isRecognizedAuthToken(queryToken);
}

function generatedFileMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!generatedFileRequestAuthorized(req)) return res.status(401).json({ message: "Unauthorized generated file request" });
  next();
}

function generatedFileUrl(url?: string, token?: string) {
  if (!url?.startsWith("/generated/")) return url;
  const auth = token || process.env.SPARKCANVAS_AUTH_TOKEN || "";
  if (!isProduction || !auth) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(auth)}`;
}

function applyGeneratedFileAuthToFrame(frame: CanvasFrame, token?: string) {
  if (!isProduction || !(token || process.env.SPARKCANVAS_AUTH_TOKEN)) return frame;
  const patchReference = (reference: ReferenceItem): ReferenceItem => ({
    ...reference,
    imageUrl: generatedFileUrl(reference.imageUrl, token)
  });
  return {
    ...frame,
    workflowNodes: frame.workflowNodes.map((node) => ({
      ...node,
      imageUrl: generatedFileUrl(node.imageUrl, token),
      fileUrl: generatedFileUrl(node.fileUrl, token),
      videoUrl: generatedFileUrl(node.videoUrl, token),
      refs: node.refs?.map(patchReference)
    })),
    outputs: frame.outputs.map((output) => ({
      ...output,
      imageUrl: generatedFileUrl(output.imageUrl, token),
      fileUrl: generatedFileUrl(output.fileUrl, token),
      videoUrl: generatedFileUrl(output.videoUrl, token)
    }))
  };
}

function applyGeneratedFileAuthToNode(frame: CanvasFrame, node: WorkflowNode, token?: string) {
  return applyGeneratedFileAuthToFrame(frame, token).workflowNodes.find((item) => item.id === node.id) ?? node;
}

function applyGeneratedFileAuthToWorkspace(token?: string) {
  if (!isProduction || !(token || process.env.SPARKCANVAS_AUTH_TOKEN)) {
    return { brands: db.brands, assets: db.assets, frames: db.frames };
  }
  return {
    brands: db.brands,
    assets: db.assets.map((asset) => ({ ...asset, imageUrl: generatedFileUrl(asset.imageUrl, token) })),
    frames: db.frames.map((frame) => applyGeneratedFileAuthToFrame(frame, token))
  };
}

async function materializeReferenceImage(reference: ReferenceItem, outputName: string, index: number) {
  const publicPath = localPublicPathFromUrl(reference.imageUrl);
  if (publicPath) return compactReferenceImage(publicPath, outputName, index);
  const match = reference.imageUrl?.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return undefined;
  const extMap: Record<string, string> = {
    jpeg: "jpg",
    jpg: "jpg",
    png: "png",
    webp: "webp",
    gif: "gif",
    "svg+xml": "svg"
  };
  const ext = extMap[match[1].toLowerCase()] ?? "png";
  const filePath = path.join(generatedDir, `${outputName}-ref-${index + 1}.${ext}`);
  await writeFile(filePath, Buffer.from(match[2], "base64"));
  return compactReferenceImage(filePath, outputName, index);
}

function localAuthValue(...names: string[]) {
  return localAuthWithSource(...names).value;
}

function localAuthWithSource(...names: string[]) {
  const candidates = [
    { label: "custom auth file", file: process.env.SPARKCANVAS_AUTH_FILE },
    { label: "auth.json", file: path.join(projectRoot, "auth.json") },
    { label: "config/auth.json", file: path.join(projectRoot, "config", "auth.json") }
  ].filter((candidate): candidate is { label: string; file: string } => Boolean(candidate.file));
  for (const candidate of candidates) {
    if (!existsSync(candidate.file)) continue;
    try {
      const data = JSON.parse(readFileSync(candidate.file, "utf-8")) as Record<string, unknown>;
      for (const name of names) {
        const value = data[name];
        if (typeof value === "string" && value) return { value, source: candidate.label };
      }
    } catch {
      continue;
    }
  }
  return { value: "", source: "missing" };
}

function imageGenerationConfig(modelName?: string) {
  if (process.env.SPARKCANVAS_DISABLE_IMAGE_GEN === "1") {
    return {
      baseUrl: defaultVdamoBaseUrl,
      apiKey: "",
      model: modelName || "gpt-image-2",
      keySource: "disabled",
      baseUrlSource: "disabled"
    };
  }
  const model = modelName || process.env.IMAGE_GEN_MODEL || localAuthValue("IMAGE_GEN_MODEL") || "gpt-image-2";
  const modelGroup = providerGroupForModel(model);
  const groupKeyNames = modelGroup === "google"
    ? ["VDAMO_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]
    : ["VDAMO_OPENAI_API_KEY", "OPENAI_API_KEY"];
  const localBaseUrl = localAuthWithSource("IMAGE_GEN_BASE_URL", "VDAMO_BASE_URL", "OPENAI_BASE_URL");
  const localGroupApiKey = localAuthWithSource(...groupKeyNames);
  const localGenericApiKey = localAuthWithSource("IMAGE_GEN_KEY");
  const baseUrl = process.env.IMAGE_GEN_BASE_URL
    || process.env.VDAMO_BASE_URL
    || process.env.OPENAI_BASE_URL
    || localBaseUrl.value
    || defaultVdamoBaseUrl;
  const apiKey = process.env.IMAGE_GEN_KEY
    || groupKeyNames.map((name) => process.env[name]).find(Boolean)
    || localGenericApiKey.value
    || localGroupApiKey.value;
  return {
    baseUrl: openAiCompatibleBaseUrl(baseUrl),
    apiKey,
    model,
    keySource: process.env.IMAGE_GEN_KEY ? "IMAGE_GEN_KEY"
      : groupKeyNames.find((name) => process.env[name]) ?? (localGenericApiKey.value ? localGenericApiKey.source : localGroupApiKey.source),
    baseUrlSource: process.env.IMAGE_GEN_BASE_URL ? "IMAGE_GEN_BASE_URL"
      : process.env.VDAMO_BASE_URL ? "VDAMO_BASE_URL"
        : process.env.OPENAI_BASE_URL ? "OPENAI_BASE_URL"
          : localBaseUrl.value ? localBaseUrl.source : "default"
  };
}

function serviceConfig(kind: "text" | "video", modelOverride?: string) {
  const prefix = kind === "text" ? "TEXT_GEN" : "VIDEO_GEN";
  const modelFallback = kind === "text" ? "gpt-5.4-mini" : "grok-imagine-1.0-video-super";
  const model = modelOverride || process.env[`${prefix}_MODEL`] || localAuthValue(`${prefix}_MODEL`) || modelFallback;
  const modelGroup = providerGroupForModel(model);
  const groupKeyNames = modelGroup === "google"
    ? ["VDAMO_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]
    : ["VDAMO_OPENAI_API_KEY", "OPENAI_API_KEY"];
  const baseUrl = kind === "text"
    ? process.env[`${prefix}_BASE_URL`]
      || localAuthValue(`${prefix}_BASE_URL`)
      || process.env.VDAMO_BASE_URL
      || localAuthValue("VDAMO_BASE_URL")
      || process.env.OPENAI_BASE_URL
      || localAuthValue("OPENAI_BASE_URL")
      || defaultVdamoBaseUrl
    : process.env[`${prefix}_BASE_URL`]
      || localAuthValue(`${prefix}_BASE_URL`)
      || process.env.YIJIARJ_BASE_URL
      || localAuthValue("YIJIARJ_BASE_URL")
      || defaultVideoGenBaseUrl;
  const apiKey = kind === "text"
    ? process.env[`${prefix}_KEY`]
      || localAuthValue(`${prefix}_KEY`)
      || groupKeyNames.map((name) => process.env[name]).find(Boolean)
      || localAuthValue(...groupKeyNames)
    : process.env[`${prefix}_KEY`]
      || localAuthValue(`${prefix}_KEY`)
      || process.env.YIJIARJ_API_KEY
      || localAuthValue("YIJIARJ_API_KEY");
  const normalizedBaseUrl = kind === "text" ? openAiCompatibleBaseUrl(baseUrl) : baseUrl.replace(/\/$/, "");
  if (kind === "video" && (process.env.SPARKCANVAS_DISABLE_VIDEO_GEN === "1" || shouldBlockPaidVideoGeneration(normalizedBaseUrl))) {
    return { baseUrl: normalizedBaseUrl, apiKey: "", model };
  }
  return { baseUrl: normalizedBaseUrl, apiKey, model };
}

function shouldBlockPaidVideoGeneration(baseUrl: string) {
  if (process.env.SPARKCANVAS_ALLOW_PAID_VIDEO_GEN === "1") return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.yijiarj.cn" || host === "apius.yijiarj.cn" || host.endsWith(".yijiarj.cn");
  } catch {
    return /(^|\/\/|\.)yijiarj\.cn(?:\/|$)/i.test(baseUrl);
  }
}

function requestHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "SparkCanvas/0.1 yijiarj-client",
    "version": "2026-05-20",
    "originator": "sparkcanvas-xmanx"
  };
}

async function postJson(url: string, apiKey: string, body: unknown, timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? "120000")) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: requestHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`HTTP ${response.status}: ${message.slice(0, 600)}`);
  }
  return data;
}

async function getJson(url: string, apiKey: string, timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? "120000")) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: globalThis.Response;
  try {
    response = await fetch(url, { headers: requestHeaders(apiKey), signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`HTTP ${response.status}: ${message.slice(0, 600)}`);
  }
  return data;
}

function readPath(value: unknown, pathExpression: string) {
  const parts = pathExpression.split(".");
  let current = value;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

async function runTextGeneration(prompt: string, modelName?: string, system = "你是品牌内容工作流助手，输出可直接进入画布节点的中文内容。") {
  const config = serviceConfig("text");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const modelConfig = model === config.model ? config : serviceConfig("text", model);
  const data = await postJson(`${modelConfig.baseUrl}/chat/completions`, modelConfig.apiKey, {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    stream: false
  });
  const content = readPath(data, "choices.0.message.content");
  if (typeof content === "string" && content.trim()) return content.trim();
  throw new Error("文本模型未返回 choices[0].message.content");
}

function videoIdFromResponse(data: unknown) {
  for (const pathExpression of ["id", "video_id", "data.id", "data.video_id", "task_id", "data.task_id"]) {
    const value = readPath(data, pathExpression);
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function videoUrlFromResponse(data: unknown) {
  for (const pathExpression of ["url", "video_url", "output", "data.url", "data.video_url", "data.output", "data.video.url", "result.video_url", "result.url"]) {
    const value = readPath(data, pathExpression);
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && /^https?:\/\//.test(item));
      if (typeof first === "string") return first;
    }
  }
  return "";
}

function videoStatusFromResponse(data: unknown) {
  for (const pathExpression of ["status", "data.status", "state", "data.state", "task_status"]) {
    const value = readPath(data, pathExpression);
    if (typeof value === "string") return value.toLowerCase();
  }
  return "";
}

async function refreshPendingVideoOutputs(limit = 2) {
  const config = serviceConfig("video");
  let changed = false;
  for (const frame of db.frames) {
    for (const node of frame.workflowNodes) {
      const localPath = localGeneratedVideoPath(node.videoUrl);
      if (node.type === "video" && node.videoUrl && localPath && !(await usableVideoFile(localPath))) {
        delete node.videoUrl;
        node.body = appendCopyNote(cleanVideoStatusNotes(node.body, "pending"), "本地 MP4 文件无有效视频内容，已恢复为等待状态。");
        changed = true;
      } else if (node.type === "video" && node.videoUrl && localPath) {
        const cleanedBody = cleanVideoStatusNotes(node.body, "ready");
        if (cleanedBody !== node.body) {
          node.body = cleanedBody;
          changed = true;
        }
      } else if (node.type === "video" && node.videoId && !node.videoUrl) {
        const cleanedBody = cleanVideoStatusNotes(node.body, "pending");
        if (cleanedBody !== node.body) {
          node.body = cleanedBody;
          changed = true;
        }
      }
    }
    for (const output of frame.outputs) {
      const localPath = localGeneratedVideoPath(output.videoUrl);
      if (output.kind === "video" && output.videoUrl && localPath && !(await usableVideoFile(localPath))) {
        delete output.videoUrl;
        output.copy = appendCopyNote(cleanVideoStatusNotes(output.copy, "pending"), "本地 MP4 文件无有效视频内容，已恢复为等待状态。");
        changed = true;
      } else if (output.kind === "video" && output.videoUrl && localPath) {
        const cleanedCopy = cleanVideoStatusNotes(output.copy, "ready");
        if (cleanedCopy !== output.copy) {
          output.copy = cleanedCopy;
          changed = true;
        }
      } else if (output.kind === "video" && output.videoId && !output.videoUrl) {
        const cleanedCopy = cleanVideoStatusNotes(output.copy, "pending");
        if (cleanedCopy !== output.copy) {
          output.copy = cleanedCopy;
          changed = true;
        }
      }
    }
  }
  if (!config.apiKey) {
    if (changed) await persistDb();
    return;
  }
  const pendingOutputs = db.frames.flatMap((frame) => frame.outputs
    .filter((output) => output.kind === "video" && output.videoId && !output.videoUrl)
    .map((output) => ({ frame, output }))).slice(0, limit);
  const outputResults = await Promise.all(pendingOutputs.map(async ({ frame, output }) => {
    try {
      const videoIds = output.videoId!.split(",").map((item) => item.trim()).filter(Boolean);
      const checks = await Promise.all(videoIds.map(async (videoId) => {
        const data = await getJson(`${config.baseUrl}/videos/${videoId}`, config.apiKey, 3000);
        return { videoId, url: videoUrlFromResponse(data), status: videoStatusFromResponse(data) };
      }));
      const urls = checks.map((item) => item.url).filter(Boolean);
      const statuses = checks.map((item) => item.status).filter(Boolean);
      if (urls.length === videoIds.length) {
        const durationSeconds = videoDurationSeconds(frame.settings);
        const segmentPlan = videoSegmentPlan(durationSeconds, config.model);
        const composedUrl = videoNeedsCompose(durationSeconds, config.model)
          ? await composeLocalVideos(urls, segmentPlan, `xmanx-${frame.id}-${output.id}-refresh-final`)
          : await materializeVideoPublicUrl(urls[0], `xmanx-${frame.id}-${output.id}-refresh-final`, 0);
        if (composedUrl) {
          output.videoUrl = composedUrl;
          output.copy = appendCopyNote(cleanVideoStatusNotes(output.copy, "ready"), `MP4 文件已生成: ${composedUrl}`);
        } else {
          output.copy = appendCopyNote(output.copy, "视频模型已返回临时 URL，但本地下载保存失败；未标记为最终 MP4。");
        }
        return true;
      } else if (statuses.length) {
        output.copy = appendCopyNote(output.copy, `视频任务状态: ${statuses.join(" / ")}`);
        return true;
      }
    } catch {
      // Workspace loading must not fail just because a remote video status check is unavailable.
    }
    return false;
  }));
  const remainingLimit = Math.max(0, limit - pendingOutputs.length);
  const pendingNodes = remainingLimit
    ? db.frames.flatMap((frame) => frame.workflowNodes
      .filter((node) => node.type === "video" && node.videoId && !node.videoUrl)
      .map((node) => ({ frame, node }))).slice(0, remainingLimit)
    : [];
  const nodeResults = await Promise.all(pendingNodes.map(async ({ frame, node }) => {
    try {
      const videoIds = node.videoId!.split(",").map((item) => item.trim()).filter(Boolean);
      const checks = await Promise.all(videoIds.map(async (videoId) => {
        const data = await getJson(`${config.baseUrl}/videos/${videoId}`, config.apiKey, 3000);
        return { videoId, url: videoUrlFromResponse(data), status: videoStatusFromResponse(data) };
      }));
      const urls = checks.map((item) => item.url).filter(Boolean);
      const statuses = checks.map((item) => item.status).filter(Boolean);
      if (urls.length === videoIds.length) {
        const durationSeconds = videoDurationSeconds(frame.settings);
        const segmentPlan = videoSegmentPlan(durationSeconds, config.model);
        const composedUrl = videoIds.length > 1 || videoNeedsCompose(durationSeconds, config.model)
          ? await composeLocalVideos(urls, segmentPlan, `xmanx-${frame.id}-${node.id}-refresh-final`)
          : await materializeVideoPublicUrl(urls[0], `xmanx-${frame.id}-${node.id}-refresh-final`, 0);
        if (composedUrl) {
          node.videoUrl = composedUrl;
          node.body = appendCopyNote(cleanVideoStatusNotes(node.body, "ready"), `MP4 文件已生成: ${composedUrl}`);
        } else {
          node.body = appendCopyNote(node.body, "视频模型已返回临时 URL，但本地下载保存失败；未标记为最终 MP4。");
        }
        return true;
      } else if (statuses.length) {
        node.body = appendCopyNote(node.body, `视频任务状态: ${statuses.join(" / ")}`);
        return true;
      }
    } catch {
      // Workspace loading must not fail just because a remote video status check is unavailable.
    }
    return false;
  }));
  if (changed || outputResults.some(Boolean) || nodeResults.some(Boolean)) await persistDb();
}

type VideoRunResult = {
  videoId: string;
  videoUrl: string;
  raw: unknown;
  usedFirstFrame: boolean;
  fallbackReason?: string;
};

async function submitVideoCreate(prompt: string, model: string, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean; contentLanguage?: ContentLanguage | string }, inputReference?: string, timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? "120000")) {
  const config = serviceConfig("video");
  const capability = videoModelCapability(model);
  if (!inputReference && !capability.supportsTextToVideo) {
    throw new Error(`${model} 不支持纯文生视频，必须提供 input_reference 参考图链接。`);
  }
  const payload: Record<string, unknown> = {
    model,
    prompt,
    size: videoSizeParam(model, settings, Boolean(inputReference))
  };
  if (inputReference) payload.input_reference = inputReference;
  return postJson(`${config.baseUrl}/videos`, config.apiKey, payload, timeoutMs);
}

async function runVideoGeneration(prompt: string, modelName?: string, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean; contentLanguage?: ContentLanguage | string }, options: { firstFrameUrl?: string } = {}): Promise<VideoRunResult | undefined> {
  const config = serviceConfig("video");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const referencePublication = await resolvePublishedReferenceAssetUrl(options.firstFrameUrl);
  const inputReference = referencePublication.url;
  if (options.firstFrameUrl && !inputReference) {
    if (isProduction || !videoModelNeedsFirstFrameFallback(model)) {
      throw new Error(describeReferencePublicationFailure(model, referencePublication));
    }
    const videoUrl = await createFirstFrameLockedVideo(options.firstFrameUrl, `first-frame-locked-${nanoid(8)}`, settings);
    if (videoUrl) {
      return {
        videoId: `local_first_frame_${nanoid(8)}`,
        videoUrl,
        raw: { fallback: "first-frame-locked-motion", model },
        usedFirstFrame: true,
        fallbackReason: `当前视频模型 ${model} 未通过首帧一致性验收，已改用首帧锁定动效视频，确保角色、Logo 和画面不漂移。`
      };
    }
  }
  let usedFirstFrame = Boolean(inputReference);
  let fallbackReason = "";
  let created: unknown;
  try {
    created = await submitVideoCreate(prompt, model, settings, inputReference);
  } catch (error) {
    if (inputReference) {
      throw new Error(`视频 API 未接受 input_reference 参考图，已停止，避免降级成错误的文生视频：${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`);
    }
    throw error;
  }
  const immediateUrl = videoUrlFromResponse(created);
  if (immediateUrl) return { videoId: videoIdFromResponse(created), videoUrl: immediateUrl, raw: created, usedFirstFrame, fallbackReason };
  const videoId = videoIdFromResponse(created);
  if (!videoId) throw new Error(`视频模型未返回 video id: ${JSON.stringify(created).slice(0, 600)}`);

  let last: unknown = created;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 2000 : 5000));
    last = await getJson(`${config.baseUrl}/videos/${videoId}`, config.apiKey);
    const url = videoUrlFromResponse(last);
    if (url) return { videoId, videoUrl: url, raw: last, usedFirstFrame, fallbackReason };
    const status = videoStatusFromResponse(last);
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`视频生成失败: ${JSON.stringify(last).slice(0, 600)}`);
    }
  }
  return { videoId, videoUrl: "", raw: last, usedFirstFrame, fallbackReason };
}

async function createVideoGenerationJob(prompt: string, modelName?: string, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean; contentLanguage?: ContentLanguage | string }, timeoutMs = Number(process.env.WORKFLOW_VIDEO_CREATE_TIMEOUT_MS ?? "45000"), options: { firstFrameUrl?: string } = {}): Promise<VideoRunResult | undefined> {
  const config = serviceConfig("video");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const referencePublication = await resolvePublishedReferenceAssetUrl(options.firstFrameUrl);
  const inputReference = referencePublication.url;
  if (options.firstFrameUrl && !inputReference) {
    if (isProduction || !videoModelNeedsFirstFrameFallback(model)) {
      throw new Error(describeReferencePublicationFailure(model, referencePublication));
    }
    const videoUrl = await createFirstFrameLockedVideo(options.firstFrameUrl, `first-frame-locked-${nanoid(8)}`, settings);
    if (videoUrl) {
      return {
        videoId: `local_first_frame_${nanoid(8)}`,
        videoUrl,
        raw: { fallback: "first-frame-locked-motion", model },
        usedFirstFrame: true,
        fallbackReason: `当前视频模型 ${model} 未通过首帧一致性验收，已改用首帧锁定动效视频，确保角色、Logo 和画面不漂移。`
      };
    }
  }
  let usedFirstFrame = Boolean(inputReference);
  let fallbackReason = "";
  let created: unknown;
  try {
    created = await submitVideoCreate(prompt, model, settings, inputReference, timeoutMs);
  } catch (error) {
    if (inputReference) {
      throw new Error(`视频 API 未接受 input_reference 参考图，已停止，避免降级成错误的文生视频：${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`);
    }
    throw error;
  }
  return {
    videoId: videoIdFromResponse(created),
    videoUrl: videoUrlFromResponse(created),
    raw: created,
    usedFirstFrame,
    fallbackReason
  };
}

async function createVideoProbe(prompt: string, modelName?: string) {
  const config = serviceConfig("video");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const created = await postJson(`${config.baseUrl}/videos`, config.apiKey, {
    model,
    prompt,
    size: videoSizeParam(model, { ratio: "16:9" })
  }, 30000);
  return {
    videoId: videoIdFromResponse(created),
    videoUrl: videoUrlFromResponse(created),
    raw: created
  };
}

function publicBaseUrlStatus() {
  return referencePublicationProvider().status();
}

function launchReadinessStatus() {
  const imageConfig = imageGenerationConfig(defaultImageModel().model);
  const textConfig = serviceConfig("text");
  const videoConfig = serviceConfig("video");
  const publicReference = publicBaseUrlStatus();
  const checks = [
    {
      id: "image-api",
      label: "VDAMO image API",
      ready: Boolean(imageConfig.apiKey && imageConfig.baseUrl),
      message: imageConfig.apiKey ? `Ready: ${imageConfig.model}` : "Missing IMAGE_GEN_KEY or VDAMO_OPENAI_API_KEY."
    },
    {
      id: "text-api",
      label: "VDAMO text API",
      ready: Boolean(textConfig.apiKey && textConfig.baseUrl),
      message: textConfig.apiKey ? `Ready: ${textConfig.model}` : "Missing TEXT_GEN_KEY, VDAMO_OPENAI_API_KEY, or VDAMO_GEMINI_API_KEY."
    },
    {
      id: "video-api",
      label: "yijiarj video API",
      ready: Boolean(videoConfig.apiKey && videoConfig.baseUrl),
      message: videoConfig.apiKey
        ? `Ready: ${videoConfig.model}`
        : process.env.SPARKCANVAS_ALLOW_PAID_VIDEO_GEN === "1"
          ? "Missing VIDEO_GEN_KEY or YIJIARJ_API_KEY."
          : "Paid video generation is disabled by default; set SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1 only when intentionally running yijia generation."
    },
    {
      id: "public-reference",
      label: "Public input_reference URLs",
      ready: publicReference.productionReady,
      message: publicReference.message
    }
  ];
  const missing = checks.filter((item) => !item.ready);
  return {
    productionReady: missing.length === 0,
    level: missing.length === 0 ? "ready" : videoConfig.apiKey || imageConfig.apiKey || textConfig.apiKey ? "blocked" : "missing",
    summary: missing.length === 0
      ? "Launch-ready: image, text, video, and public reference publishing are configured."
      : `Launch blocked: ${missing.map((item) => item.label).join(", ")}.`,
    checks
  };
}

function aiStatus() {
  const imageConfig = imageGenerationConfig(defaultImageModel().model);
  const textConfig = serviceConfig("text");
  const videoConfig = serviceConfig("video");
  return {
    imageGeneration: {
      configured: Boolean(imageConfig.apiKey && imageConfig.baseUrl),
      verified: false,
      baseUrl: imageConfig.baseUrl,
      baseUrlSource: imageConfig.baseUrlSource,
      model: imageConfig.model,
      keySource: imageConfig.apiKey ? imageConfig.keySource : "missing",
      provider: providerForModel(imageConfig.model),
      route: "/v1/images/generations"
    },
    textGeneration: {
      configured: Boolean(textConfig.apiKey && textConfig.baseUrl),
      baseUrl: textConfig.baseUrl,
      model: textConfig.model,
      provider: providerForModel(textConfig.model)
    },
    videoGeneration: {
      configured: Boolean(videoConfig.apiKey && videoConfig.baseUrl),
      baseUrl: videoConfig.baseUrl,
      model: videoConfig.model,
      provider: "yijiarj"
    },
    publicReference: publicBaseUrlStatus(),
    launchReadiness: launchReadinessStatus()
  };
}

async function imageSkillDiagnostics() {
  const imageConfig = imageGenerationConfig(defaultImageModel().model);
  const configured = Boolean(imageConfig.apiKey && imageConfig.baseUrl);
  return {
    ...aiStatus(),
    runtime: {
      endpoint: `${imageConfig.baseUrl.replace(/\/$/, "")}/images/generations`,
      model: imageConfig.model,
      provider: providerForModel(imageConfig.model),
      configured,
      message: configured ? "VDAMO image API is configured." : "VDAMO image API key is missing.",
      canAttemptGeneration: configured
    }
  };
}

function modelDiagnostics() {
  const textConfig = serviceConfig("text");
  const videoConfig = serviceConfig("video");
  return models.map((item) => {
    const isImage = item.type === "image";
    const isVideo = item.type === "video";
    const isText = item.type === "text";
    const imageConfig = isImage ? imageGenerationConfig(item.model) : undefined;
    const configured = isImage
      ? Boolean(imageConfig?.apiKey && imageConfig.baseUrl && item.enabled !== false)
      : isVideo
        ? Boolean(videoConfig.apiKey && videoConfig.baseUrl)
        : isText ? Boolean(textConfig.apiKey && textConfig.baseUrl && item.enabled !== false) : false;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      provider: item.provider,
      model: item.model ?? imageConfig?.model ?? textConfig.model,
      group: "group" in item ? item.group : undefined,
      availability: "availability" in item ? item.availability : item.enabled === false ? "disabled" : "available",
      unitCostCny: "unitCostCny" in item ? item.unitCostCny : undefined,
      clipSeconds: isVideo ? videoModelClipSeconds(item.model) : undefined,
      configured,
      route: isImage ? `${imageConfig?.baseUrl ?? defaultVdamoBaseUrl}/images/generations` : isVideo ? `${videoConfig.baseUrl}/videos` : `${textConfig.baseUrl}/chat/completions`,
      status: item.enabled === false ? "disabled" : item.id === defaultImageModel().id ? "recommended" : configured ? "candidate" : "missing_key",
      note: item.id === defaultImageModel().id
        ? "默认推荐。GPT Image 2 走 VDAMO /v1/images/generations；已通过真实 PNG 出图测试。"
        : item.description
    };
  });
}

async function probeModel(modelId: string, prompt?: string) {
  const model = findModelById(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  const started = Date.now();
  if (model.type === "image") {
    const outputName = `probe-${model.id}-${Date.now().toString(36)}`;
    const imageUrl = await runImageGenerationSkill(
      prompt || "A clean product-style test image of a single horse, no text, neutral background.",
      [],
      outputName,
      model.model,
      { ratio: "1:1", quality: "standard", strength: 70 },
      90000
    );
    return {
      id: model.id,
      ok: Boolean(imageUrl),
      type: model.type,
      model: model.model ?? imageGenerationConfig().model,
      imageUrl,
      elapsedMs: Date.now() - started
    };
  }
  if (model.type === "text") {
    const text = await runTextGeneration(prompt || "只回复 OK", model.model);
    return {
      id: model.id,
      ok: Boolean(text),
      type: model.type,
      model: model.model,
      text: text?.slice(0, 160),
      elapsedMs: Date.now() - started
    };
  }
  const result = await createVideoProbe(
    prompt || "A five second product-style validation video, simple camera push in, no text.",
    model.model
  );
  return {
    id: model.id,
    ok: Boolean(result?.videoId || result?.videoUrl),
    type: model.type,
    model: model.model,
    videoId: result?.videoId,
    videoUrl: result?.videoUrl,
    elapsedMs: Date.now() - started
  };
}

function ratioForImageSkill(ratio?: string) {
  const value = ratio?.split("·")[0]?.trim();
  return value && /^\d+:\d+$/.test(value) ? value : "1:1";
}

function imageFormatFromText(text: string): "png" | "jpeg" {
  return /\b(jpe?g|jpg)\b/i.test(text) ? "jpeg" : "png";
}

function imageExtensionForApi(format: "png" | "jpeg" | "webp") {
  return format === "jpeg" ? "jpg" : format;
}

function workGraphAssetKindFromMime(mime = "", filename = ""): "image" | "video" | "document" | "audio" {
  return assetKindFromMime(mime, filename);
}

function workGraphAssetExtFromInput(filename: string, mime = "") {
  return assetExtFromInput(filename, mime);
}

async function storeWorkGraphAssetBuffer(bytes: Buffer, filename: string, mime = "") {
  return storeAssetBuffer({
    assetDir: workGraphOsAssetDataDir,
    now,
    idFactory: () => Date.now().toString(36)
  }, bytes, filename, mime);
}

function workGraphAssetMetaValue(asset: unknown, name: string) {
  const meta = objectString(asset, "note", objectString(asset, "meta", ""));
  const match = meta.match(new RegExp(`${name}:([^\\s]+)`));
  return match?.[1] ?? "";
}

async function writeWorkGraphAssetCompanionFile(relativePath: string, content: string | Buffer) {
  const safePath = safeWorkGraphRelativePath(relativePath);
  const filePath = path.join(workGraphOsAssetDataDir, safePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return { relativePath: safePath, absolutePath: filePath };
}

async function createWorkGraphAssetCompanions(input: { assetId: string; title: string; stored: Awaited<ReturnType<typeof storeWorkGraphAssetBuffer>>; brandId: string; tags: string[] }) {
  const base = input.stored.relativePath.replace(/\.[^.]+$/, "");
  const thumbnailRelativePath = `${base}.thumb.svg`;
  const versionRelativePath = `${base}.versions/initial.json`;
  const usageRelativePath = `${base}.usage.jsonl`;
  const color = input.stored.kind === "image" ? "#22d3ee" : input.stored.kind === "video" ? "#fb7185" : input.stored.kind === "audio" ? "#a78bfa" : "#94a3b8";
  const thumb = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">`,
    `<rect width="320" height="180" rx="14" fill="#020617"/>`,
    `<rect x="12" y="12" width="296" height="156" rx="10" fill="#0f172a" stroke="${color}" stroke-width="2"/>`,
    `<text x="24" y="64" fill="${color}" font-family="Arial, sans-serif" font-size="16" font-weight="700">${input.stored.kind.toUpperCase()} ASSET</text>`,
    `<text x="24" y="92" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="13">${input.title.replace(/[<>&]/g, "")}</text>`,
    `<text x="24" y="120" fill="#64748b" font-family="Arial, sans-serif" font-size="11">${input.stored.storedName}</text>`,
    `</svg>`
  ].join("");
  await writeWorkGraphAssetCompanionFile(thumbnailRelativePath, thumb);
  await writeWorkGraphAssetCompanionFile(versionRelativePath, `${JSON.stringify({
    assetId: input.assetId,
    version: 1,
    kind: input.stored.kind,
    sourceFile: input.stored.relativePath,
    brandId: input.brandId,
    tags: input.tags,
    size: input.stored.size,
    mime: input.stored.mime,
    createdAt: now()
  }, null, 2)}\n`);
  await writeWorkGraphAssetCompanionFile(usageRelativePath, `${JSON.stringify({
    type: "upload",
    assetId: input.assetId,
    sourceFile: input.stored.relativePath,
    createdAt: now()
  })}\n`);
  return { thumbnailRelativePath, versionRelativePath, usageRelativePath };
}

async function appendWorkGraphAssetUsage(asset: unknown, usage: Record<string, unknown>) {
  const usageRelativePath = workGraphAssetMetaValue(asset, "usage");
  if (!usageRelativePath) return;
  const filePath = path.join(workGraphOsAssetDataDir, safeWorkGraphRelativePath(usageRelativePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  const line = `${JSON.stringify({ createdAt: now(), ...usage })}\n`;
  await writeFile(filePath, existsSync(filePath) ? `${readFileSync(filePath, "utf8")}${line}` : line);
}

async function cleanupWorkGraphAssetSnapshotsByTitle(assetId: string, title: string) {
  const cleanupFile = async (filePath: string) => {
    if (!existsSync(filePath)) return;
    const record = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    let changed = false;
    const removeFromContext = (value: unknown) => {
      if (typeof value !== "string") return value;
      const next = value.split("\n").filter((line) => !line.includes(title)).join("\n");
      if (next !== value) changed = true;
      return next;
    };
    record.context = removeFromContext(record.context);
    const payload = objectField(record, "payload") as Record<string, unknown> | undefined;
    if (payload) {
      payload.context = removeFromContext(payload.context);
      if (Array.isArray(payload.assets)) {
        const nextAssets = payload.assets.filter((asset) => objectString(asset, "id", "") !== assetId && objectString(asset, "title", "") !== title);
        if (nextAssets.length !== payload.assets.length) changed = true;
        payload.assets = nextAssets;
      }
    }
    if (Array.isArray(record.assets)) {
      const nextAssets = record.assets.filter((asset) => objectString(asset, "id", "") !== assetId && objectString(asset, "title", "") !== title);
      if (nextAssets.length !== record.assets.length) changed = true;
      record.assets = nextAssets;
    }
    if (changed) await writeJsonAtomic(filePath, record);
  };
  await cleanupFile(path.join(workGraphOsBrandDataDir, "brand-dapot.json"));
  await cleanupFile(path.join(workGraphOsBrandDataDir, "brand-brand_dapot.json"));
}

function imageApiSize(ratio?: string) {
  const value = ratioForImageSkill(ratio);
  const mapping: Record<string, string> = {
    "1:1": "1024x1024",
    "3:4": "1024x1365",
    "4:5": "1024x1280",
    "9:16": "1024x1792",
    "16:9": "1792x1024"
  };
  return mapping[value] ?? "1024x1024";
}

function firstImageOutput(value: unknown): { kind: "url" | "b64"; value: string } | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageOutput(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["b64_json", "base64", "image_base64", "result"]) {
    const item = record[key];
    if (typeof item === "string" && item) return { kind: "b64", value: item };
  }
  for (const key of ["url", "image_url"]) {
    const item = record[key];
    if (typeof item === "string" && /^https?:\/\//.test(item)) return { kind: "url", value: item };
  }
  for (const item of Object.values(record)) {
    const found = firstImageOutput(item);
    if (found) return found;
  }
  return undefined;
}

async function writeImageApiOutput(output: { kind: "url" | "b64"; value: string }, outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (output.kind === "b64") {
    await writeFile(outputPath, Buffer.from(output.value, "base64"));
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS ?? "120000"));
  try {
    const response = await fetch(output.value, { signal: controller.signal, headers: { "User-Agent": "SparkCanvas/0.1 image-download" } });
    if (!response.ok) throw new Error(`image download failed: HTTP ${response.status}`);
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("image download timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function detectImageExtension(filePath: string): "png" | "jpg" | "webp" | undefined {
  if (!existsSync(filePath)) return undefined;
  const bytes = readFileSync(filePath);
  return detectImageExtensionFromBuffer(bytes);
}

function detectImageExtensionFromBuffer(bytes: Buffer): "png" | "jpg" | "webp" | undefined {
  if (bytes.length < 12) return undefined;
  const header = bytes.subarray(0, 12);
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return undefined;
}

function safeUploadSlug(value = "asset") {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "asset";
}

async function storeAssetImageBuffer(bytes: Buffer, title: string) {
  const ext = detectImageExtensionFromBuffer(bytes);
  if (!ext) throw new Error("Uploaded file is not a valid PNG/JPEG/WEBP image");
  await mkdir(brandUploadDir, { recursive: true });
  const filename = `${Date.now().toString(36)}-${safeUploadSlug(title)}.${ext}`;
  await writeFile(path.join(brandUploadDir, filename), bytes);
  return `/generated/brand-assets/${filename}`;
}

async function materializeAssetImageUrl(imageUrl: string | undefined, title: string) {
  const match = imageUrl?.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return imageUrl;
  if (!["png", "jpeg", "jpg", "webp"].includes(match[1].toLowerCase())) return imageUrl;
  return storeAssetImageBuffer(Buffer.from(match[2], "base64"), title);
}

async function materializeWorkflowNodeImages(nodes: WorkflowNode[]) {
  return Promise.all(nodes.map(async (node) => ({
    ...node,
    refs: node.refs
      ? await Promise.all(node.refs.map(async (reference) => ({
        ...reference,
        imageUrl: await materializeAssetImageUrl(reference.imageUrl, reference.title)
      })))
      : node.refs
  })));
}

async function materializeOutputImages(outputs: CanvasFrame["outputs"]) {
  return Promise.all(outputs.map(async (output) => ({
    ...output,
    imageUrl: await materializeAssetImageUrl(output.imageUrl, output.title)
  })));
}

function fallbackImageDataUrl(label = "Image generation unavailable") {
  const safeLabel = label.replace(/[<>&]/g, "").slice(0, 80) || "Image generation unavailable";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">`,
    `<rect width="1024" height="1024" fill="#10131d"/>`,
    `<rect x="96" y="96" width="832" height="832" rx="48" fill="#181c27" stroke="#334155" stroke-width="4"/>`,
    `<text x="512" y="480" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#e5e7eb">SparkCanvas</text>`,
    `<text x="512" y="540" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#94a3b8">${safeLabel}</text>`,
    `</svg>`
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function runImageGenerationSkill(prompt: string, references: ReferenceItem[], outputName: string, modelName?: string, settings?: Partial<GenerationSettings>, timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_MS ?? "240000"), outputFormat: "png" | "jpeg" | "webp" = "png") {
  const imageConfig = imageGenerationConfig(modelName);
  if (!imageConfig.apiKey || !imageConfig.baseUrl) return undefined;

  await mkdir(generatedDir, { recursive: true });
  const filename = `${outputName}.${imageExtensionForApi(outputFormat)}`;
  const outputPath = path.join(generatedDir, filename);
  const maxReferences = Math.max(1, Math.min(6, Number(process.env.IMAGE_GEN_MAX_REFERENCES ?? "3")));
  const usableReferences = references.filter((reference) => reference.imageUrl).slice(0, maxReferences);
  const imageInputs: string[] = [];
  for (const [index, reference] of usableReferences.entries()) {
    const filePath = await materializeReferenceImage(reference, outputName, index);
    if (filePath) {
      const bytes = await readFile(filePath);
      const mime = /\.webp$/i.test(filePath) ? "image/webp" : /\.jpe?g$/i.test(filePath) ? "image/jpeg" : "image/png";
      imageInputs.push(`data:${mime};base64,${bytes.toString("base64")}`);
    }
  }
  if (providerGroupForModel(imageConfig.model) !== "openai") {
    throw new Error(`VDAMO image model ${imageConfig.model} is not enabled for production image generation`);
  }
  const url = `${imageConfig.baseUrl.replace(/\/$/, "")}/images/generations`;
  const requestPrompt = imageInputs.length
    ? [
        prompt,
        "",
        "Use the attached reference images as real brand/product/character constraints. Preserve identity, product shape, logo-safe spacing, color system, and composition intent."
      ].join("\n")
    : prompt;
  const payload: Record<string, unknown> = {
    model: imageConfig.model,
    prompt: requestPrompt,
    n: 1,
    size: imageApiSize(settings?.ratio)
  };
  if (imageInputs.length) payload.image = imageInputs;
  const parsed = await postJson(url, imageConfig.apiKey, payload, timeoutMs);
  const output = firstImageOutput(parsed);
  if (!output) throw new Error(`VDAMO image API did not return image data for ${imageConfig.model}`);
  await writeImageApiOutput(output, outputPath);
  const actualExt = detectImageExtension(outputPath);
  if (!actualExt) throw new Error("VDAMO image API did not produce a valid PNG/JPEG/WEBP file");
  const expectedExt = imageExtensionForApi(outputFormat);
  if (actualExt !== expectedExt) {
    const actualName = `${outputName}.${actualExt}`;
    renameSync(outputPath, path.join(generatedDir, actualName));
    return `/generated/${actualName}`;
  }
  return `/generated/${filename}`;
}

function generatedReference(id: string, output: Pick<CanvasFrame["outputs"][number], "title" | "copy" | "imageUrl">, color: string, role = "generated"): ReferenceItem | undefined {
  if (!output.imageUrl) return undefined;
  return {
    id,
    role,
    title: output.title,
    description: output.copy,
    color,
    imageUrl: output.imageUrl
  };
}

function upsertNodeReference(node: WorkflowNode | undefined, reference: ReferenceItem | undefined) {
  if (!node || !reference?.imageUrl) return;
  node.refs = [reference, ...(node.refs ?? []).filter((item) => item.imageUrl !== reference.imageUrl && item.id !== reference.id)].slice(0, 12);
}

function matchOutputNode(frame: CanvasFrame, output: CanvasFrame["outputs"][number], index: number) {
  const outputNodes = frame.workflowNodes.filter((node) => node.type === "output");
  const normalizedTitle = output.title.toLowerCase();
  const explicit = outputNodes.find((node) => {
    const id = node.id.toLowerCase();
    if (output.kind === "document") return id.includes("pdf") || node.title.toLowerCase().includes("pdf");
    if (output.kind === "video") return id.includes("mp4") || id.includes("video") || node.title.toLowerCase().includes("视频") || node.title.toLowerCase().includes("mp4");
    return id.includes("poster") || id.includes("image") || node.title.toLowerCase().includes("海报") || node.title.toLowerCase().includes("图片") || node.title.toLowerCase().includes(normalizedTitle);
  });
  return explicit ?? outputNodes[index] ?? outputNodes[0];
}

function nodesForOutput(frame: CanvasFrame, output: CanvasFrame["outputs"][number]) {
  if (output.kind === "document") return frame.workflowNodes.filter((node) => node.id.includes("pdf") || node.title.toLowerCase().includes("pdf"));
  if (output.kind === "video") return frame.workflowNodes.filter((node) => node.id.includes("mp4") || node.type === "video" || node.title.toLowerCase().includes("视频"));
  return frame.workflowNodes.filter((node) => node.type === "output" && (node.id.includes("poster") || node.id === "output"));
}

function appendCopyNote(copy: string, note: string) {
  return copy.includes(note) ? copy : `${copy} · ${note}`;
}

function cleanImageGenerationNotes(text = "") {
  return text
    .replace(/\n?模型: [^\n]+/g, "")
    .replace(/\n?参数: [^\n]+/g, "")
    .replace(/\n?生成状态: [^\n]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanVideoStatusNotes(copy = "", state: "ready" | "pending") {
  const staleReadyPatterns = state === "ready"
    ? [
        / · 本地 MP4 文件无有效视频内容，已恢复为等待状态。/g,
        / · 视频合成计划已生成：[^。]+。/g,
        / · 视频任务状态: [^·]+/g
      ]
    : [
        / · MP4 文件已生成: [^·]+/g,
        / · 最终 MP4 文件已生成: [^·]+/g,
        / · 所有分段视频已返回并完成裁切\/合成: [^·]+/g
      ];
  return staleReadyPatterns.reduce((next, pattern) => next.replace(pattern, ""), copy).trim();
}

function pdfFontPath() {
  return [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ].find((candidate) => existsSync(candidate));
}

function pdfImageBuffer(imageUrl?: string) {
  if (!imageUrl) return undefined;
  const dataMatch = imageUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (dataMatch) return Buffer.from(dataMatch[2], "base64");
  const localPath = localPublicPathFromUrl(imageUrl);
  if (!localPath || !/\.(png|jpe?g)$/i.test(localPath)) return undefined;
  return readFileSync(localPath);
}

function collectPdfImageSources(frame: CanvasFrame, output: CanvasFrame["outputs"][number]) {
  const sources: Array<{ title: string; imageUrl: string; description: string }> = [];
  const add = (title: string, imageUrl?: string, description = "") => {
    if (!imageUrl || sources.some((item) => item.imageUrl === imageUrl)) return;
    sources.push({ title, imageUrl, description });
  };
  add(output.title || "PDF preview", output.imageUrl, output.copy);
  const priorityNodes = [
    ...frame.workflowNodes.filter((node) => node.id === "visual-draft"),
    ...nodesForOutput(frame, output),
    ...frame.workflowNodes.filter((node) => ["image", "reference", "output"].includes(node.type))
  ];
  for (const node of priorityNodes) {
    for (const ref of node.refs ?? []) add(ref.title || node.title, ref.imageUrl, ref.description || node.body);
  }
  const resolved: Array<{ title: string; imageUrl: string; description: string; buffer: Buffer }> = [];
  for (const source of sources.slice(0, 12)) {
    const buffer = pdfImageBuffer(source.imageUrl);
    if (buffer) resolved.push({ ...source, buffer });
  }
  return resolved;
}

function writeCanvasPdf(filePath: string, title: string, lines: string[], images: Array<{ title: string; description: string; buffer: Buffer }>) {
  return new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 46, info: { Title: title } });
    const output = createWriteStream(filePath);
    output.on("finish", () => resolve());
    output.on("error", reject);
    doc.on("error", reject);
    doc.pipe(output);
    const fontPath = pdfFontPath();
    if (fontPath) {
      try {
        doc.registerFont("SparkCanvasFont", fontPath);
        doc.font("SparkCanvasFont");
      } catch {
        doc.font("Helvetica");
      }
    }
    doc.fontSize(20).fillColor("#111827").text(title || "SparkCanvas PDF", { width: 500 });
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor("#64748b").text("Generated by SparkCanvas CAL workflow. Image pages are composed from canvas visual previews and referenced assets.");
    doc.moveDown(0.8);
    doc.fontSize(10).fillColor("#111827");
    for (const line of lines.slice(0, 22)) {
      doc.text(line || " ", { width: 500, lineGap: 2 });
    }
    images.forEach((image, index) => {
      doc.addPage({ size: "A4", margin: 34 });
      doc.fontSize(12).fillColor("#111827").text(`${index + 1}. ${image.title}`, { width: 520 });
      doc.moveDown(0.35);
      try {
        doc.image(image.buffer, 34, 76, { fit: [527, 650], align: "center", valign: "center" });
      } catch {
        doc.fontSize(10).fillColor("#dc2626").text("Image could not be embedded in this PDF. The preview remains available on the canvas.");
      }
      if (image.description) {
        doc.fontSize(8).fillColor("#64748b").text(image.description.replace(/\s+/g, " ").slice(0, 260), 34, 752, { width: 527 });
      }
    });
    if (!images.length) {
      doc.addPage({ size: "A4", margin: 46 });
      doc.fontSize(12).fillColor("#64748b").text("No embeddable PNG/JPG images were available. Canvas preview images are still visible in the app.");
    }
    doc.end();
  });
}

async function createPdfArtifact(frame: CanvasFrame, output: CanvasFrame["outputs"][number], outputName: string) {
  const fileName = `${outputName}.pdf`;
  const filePath = path.join(generatedDir, fileName);
  const docNodes = nodesForOutput(frame, output).filter((node) => node.type !== "output");
  const pdfImages = collectPdfImageSources(frame, output);
  const lines = [
    `项目: ${frame.title}`,
    `品牌: ${frame.brandName || "未绑定品牌"}`,
    `状态: ${frame.brandInjected ? "自动注入品牌上下文" : "仅使用显式 CAL 引用"}`,
    `目标: ${output.title}`,
    `图片页: ${pdfImages.length} 张`,
    "",
    ...docNodes.flatMap((node) => [`${node.title}:`, node.body]),
    "",
    "最终提示词:",
    frame.finalPrompt || frame.prompt,
    "",
    output.copy
  ].filter(Boolean);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeCanvasPdf(filePath, output.title || frame.title, lines, pdfImages);
  return `/generated/${fileName}`;
}

function ensureFrameOutputPreviews(frame: CanvasFrame, note = "已补齐可见预览。") {
  const brand = frameBrand(frame);
  const colors = neutralBrandColor(brand);
  const visualDraftNode = frame.workflowNodes.find((node) => node.id === "visual-draft");
  const existingPreviewUrl = frame.outputs.find((output) => output.imageUrl)?.imageUrl
    ?? visualDraftNode?.refs?.find((reference) => reference.imageUrl)?.imageUrl
    ?? frame.workflowNodes.find((node) => node.id === "input-image")?.refs?.find((reference) => reference.imageUrl)?.imageUrl
    ?? fallbackImageDataUrl("Workflow preview");

  if (visualDraftNode && !visualDraftNode.refs?.some((reference) => ["visual", "generated", "document-preview", "video-preview"].includes(reference.role))) {
    upsertNodeReference(visualDraftNode, {
      id: `generated_${visualDraftNode.id}_${Date.now().toString(36)}`,
      role: "visual",
      title: "视觉草图预览",
      description: note,
      color: visualDraftNode.preview ?? colors.accent,
      imageUrl: existingPreviewUrl
    });
  }

  frame.outputs.forEach((output, index) => {
    if (!output.imageUrl) output.imageUrl = existingPreviewUrl;
    if (output.kind === "document") output.copy = appendCopyNote(output.copy, note.includes("PDF") ? note : `${note} PDF 节点当前显示封面/结构预览。`);
    if (output.kind === "video") output.copy = appendCopyNote(output.copy, note.includes("MP4") ? note : `${note} MP4 节点当前显示首帧/脚本预览。`);
    const outputNode = matchOutputNode(frame, output, index);
    const ref = generatedReference(
      `generated_${outputNode?.id ?? output.id}_${Date.now().toString(36)}_${index}`,
      output,
      outputNode?.preview ?? colors.accent,
      output.kind === "document" ? "document-preview" : output.kind === "video" ? "video-preview" : "generated"
    );
    upsertNodeReference(outputNode, ref);
    for (const node of nodesForOutput(frame, output)) upsertNodeReference(node, ref);
  });
}

async function fillFrameOutputs(frame: CanvasFrame) {
  const brand = frameBrand(frame);
  const resolvedRefs = resolvePromptAssets(frame.prompt, brand).imageReferences;
  const refs = [
    ...resolvedRefs,
    ...(frame.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [])
  ].filter((reference, index, list) => list.findIndex((item) => item.id === reference.id) === index);
  const fallbackImage = fallbackImageDataUrl("Image API unavailable");
  const referenceFallbackImage = refs.find((reference) => ["product", "ip", "model", "storefront", "environment", "logo"].includes(reference.role))?.imageUrl;
  const model = findModelById(frame.modelId) ?? defaultImageModel();
  const visualDraftNode = frame.workflowNodes.find((node) => node.id === "visual-draft");
  let sharedVisualUrl = visualDraftNode?.refs?.find((item) => item.imageUrl && ["visual", "generated", "document-preview", "video-preview"].includes(item.role))?.imageUrl;
  let sharedVisualNote = "";
  const needsMasterVisualGeneration = frame.outputs.some((output) => ["image", "video", "document"].includes(output.kind));

  if (visualDraftNode && !sharedVisualUrl) {
    if (!needsMasterVisualGeneration) {
      sharedVisualUrl = fallbackImage;
      sharedVisualNote = "PDF-only 工作流已跳过图片生成，使用结构预览封面。";
    } else {
      try {
        const generated = await runImageGenerationSkill(
          executableImagePrompt(frame.prompt, brand, visualDraftTargetLabel(frame), frame.settings),
          refs,
          `xmanx-${frame.id}-visual`,
          model.model,
          frame.settings,
          Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "300000")
        );
        sharedVisualUrl = generated ?? fallbackImage;
        if (!generated) sharedVisualNote = "主视觉使用降级预览：未配置有效图片生成 Key。";
      } catch (error) {
        sharedVisualUrl = fallbackImage;
        sharedVisualNote = `主视觉使用降级预览：${error instanceof Error ? error.message.slice(0, 120) : "image API unavailable"}`;
      }
    }
    const visualRef = generatedReference(
      `generated_${visualDraftNode.id}_${Date.now().toString(36)}`,
      { title: "视觉草图", copy: sharedVisualNote || visualDraftNode.body, imageUrl: sharedVisualUrl },
      visualDraftNode.preview ?? neutralBrandColor(brand).accent,
      "visual"
    );
    upsertNodeReference(visualDraftNode, visualRef);
    if (sharedVisualNote) visualDraftNode.body = appendCopyNote(visualDraftNode.body, sharedVisualNote);
  }

  for (const [index, output] of frame.outputs.entries()) {
    const outputNode = matchOutputNode(frame, output, index);
    if (output.imageUrl && !(output.kind === "document" && !output.fileUrl)) {
      const existingRef = generatedReference(`generated_${outputNode?.id ?? output.id}_${Date.now().toString(36)}_${index}`, output, outputNode?.preview ?? neutralBrandColor(brand).accent);
      upsertNodeReference(outputNode, existingRef);
      continue;
    }

    if (output.kind === "image") {
      try {
        const generated = await runImageGenerationSkill(
          executableImagePrompt(frame.prompt, brand, output.title, frame.settings),
          refs,
          `xmanx-${frame.id}-${index + 1}`,
          model.model,
          frame.settings,
          Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "300000"),
          imageFormatFromText(output.title)
        );
        output.imageUrl = generated ?? sharedVisualUrl ?? referenceFallbackImage ?? fallbackImage;
        if (!generated) output.copy = appendCopyNote(output.copy, "图片生成未返回结果，已使用主视觉/降级预览。");
      } catch (error) {
        output.imageUrl = sharedVisualUrl ?? referenceFallbackImage ?? fallbackImage;
        output.copy = appendCopyNote(output.copy, `图片生成降级：${error instanceof Error ? error.message.slice(0, 120) : "image API unavailable"}`);
      }
      const ref = generatedReference(`generated_${outputNode?.id ?? output.id}_${Date.now().toString(36)}_${index}`, output, outputNode?.preview ?? neutralBrandColor(brand).accent);
      upsertNodeReference(outputNode, ref);
      if (visualDraftNode && !visualDraftNode.refs?.some((item) => item.imageUrl === output.imageUrl)) upsertNodeReference(visualDraftNode, ref);
      continue;
    }

    output.imageUrl = sharedVisualUrl ?? fallbackImage;
    if (output.kind === "video") {
      const workflowVideoModel = serviceConfig("video").model;
      const durationSeconds = videoDurationSeconds({ duration: `${frame.settings.duration || 5}s` });
      const segmentPlan = videoSegmentPlan(durationSeconds, workflowVideoModel);
      const keyframeCount = videoKeyframeCount(durationSeconds);
      const videoRefs = stableVideoReferences([
        ...refs,
        ...(sharedVisualUrl ? [{
          id: `first_frame_${frame.id}_${index}`,
          role: "first-frame",
          title: "视频首帧",
          description: "由VDAMO 图片 API 使用品牌素材生成，作为视频一致性锚点。",
          color: outputNode?.preview ?? neutralBrandColor(brand).accent,
          imageUrl: sharedVisualUrl
        }] : [])
      ]);
      const videoSettings = { mode: "图生视频", ratio: `${frame.settings.ratio} · 720P`, duration: `${durationSeconds}s`, sound: true, translate: false, contentLanguage: frame.settings.contentLanguage };
      let storyboardSheetUrl = "";
      try {
        const generatedStoryboard = await runImageGenerationSkill(
          videoStoryboardSheetPrompt(frame.prompt, brand, videoRefs, { ratio: "16:9", duration: `${durationSeconds}s`, contentLanguage: frame.settings.contentLanguage }, segmentPlan),
          videoRefs,
          `xmanx-${frame.id}-video-storyboard-${index + 1}`,
          model.model,
          { ...frame.settings, ratio: "16:9", count: 1, quality: "hd" },
          Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "300000")
        );
        if (generatedStoryboard) storyboardSheetUrl = generatedStoryboard;
      } catch (error) {
        output.copy = appendCopyNote(output.copy, `视频分镜板生成降级：${error instanceof Error ? error.message.slice(0, 100) : "image API unavailable"}`);
      }
      const storyboardRef = storyboardSheetUrl ? {
        id: `video_storyboard_${frame.id}_${index}`,
        role: "storyboard-sheet",
        title: "视频分镜板",
        description: `宽幅分镜板，用于锁定 ${durationSeconds}s 视频的人物、Logo、场景、镜头和片段关系。`,
        color: outputNode?.preview ?? neutralBrandColor(brand).accent,
        imageUrl: storyboardSheetUrl
      } : undefined;
      if (storyboardRef) {
        const scriptNode = frame.workflowNodes.find((node) => node.type === "script");
        const videoNode = frame.workflowNodes.find((node) => node.type === "video" || node.id.includes("mp4"));
        const composeNode = frame.workflowNodes.find((node) => node.type === "compose");
        upsertNodeReference(scriptNode, storyboardRef);
        upsertNodeReference(videoNode, storyboardRef);
        upsertNodeReference(composeNode, storyboardRef);
        output.copy = appendCopyNote(output.copy, "已先生成视频分镜板，再按分镜生成各片段首帧。");
      }
      const keyframeUrls: string[] = [];
      const keyframeSourceRefs = stableVideoReferences([...videoRefs, ...(storyboardRef ? [storyboardRef] : [])]);
      for (let shotIndex = 0; shotIndex < keyframeCount; shotIndex += 1) {
        try {
          const generatedKeyframe = await runImageGenerationSkill(
            videoKeyframePrompt(frame.prompt, brand, keyframeSourceRefs, { ratio: frame.settings.ratio, duration: `${durationSeconds}s`, contentLanguage: frame.settings.contentLanguage }, shotIndex, keyframeCount),
            keyframeSourceRefs,
            `xmanx-${frame.id}-video-keyframe-${index + 1}-${shotIndex + 1}`,
            model.model,
            { ...frame.settings, count: 1 },
            Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "300000")
          );
          if (generatedKeyframe) keyframeUrls.push(generatedKeyframe);
        } catch (error) {
          output.copy = appendCopyNote(output.copy, `视频关键帧 ${shotIndex + 1} 生成降级：${error instanceof Error ? error.message.slice(0, 100) : "image API unavailable"}`);
        }
      }
      const firstFrameUrl = keyframeUrls[0] ?? sharedVisualUrl;
      output.imageUrl = firstFrameUrl ?? output.imageUrl;
      const keyframeRefs = keyframeUrls.map((imageUrl, shotIndex) => ({
        id: `video_keyframe_${frame.id}_${index}_${shotIndex}`,
        role: shotIndex === 0 ? "first-frame" : "keyframe",
        title: `视频关键帧 ${shotIndex + 1}/${keyframeCount}`,
        description: `由VDAMO 图片 API 根据真实品牌素材生成，用于 ${durationSeconds}s 视频第 ${shotIndex + 1} 段视觉一致性。`,
        color: outputNode?.preview ?? neutralBrandColor(brand).accent,
        imageUrl
      }));
      for (const keyframeRef of keyframeRefs) {
        const videoNode = frame.workflowNodes.find((node) => node.type === "video" || node.id.includes("mp4"));
        upsertNodeReference(videoNode, keyframeRef);
      }
      if (keyframeRefs.length) {
        output.copy = appendCopyNote(output.copy, `已按 ${durationSeconds}s 视频生成 ${keyframeRefs.length} 张关键帧；首帧用于图生视频，其余关键帧用于分段/剪辑一致性。`);
      }
      output.copy = appendCopyNote(output.copy, `视频时长策略：最终成片 ${durationSeconds}s；${workflowVideoModel} 固定单次输出 ${videoModelClipSeconds(workflowVideoModel)}s；${videoSegmentSummary(durationSeconds, workflowVideoModel)}。`);
      if (videoNeedsCompose(durationSeconds, workflowVideoModel)) {
        output.copy = appendCopyNote(output.copy, `已拆为 ${segmentPlan.length} 个模型片段任务；短于模型时长的片段会在合成节点裁切，长视频会合并为最终 MP4。`);
      }
      const videoPromptRefs = stableVideoReferences([...videoRefs, ...(storyboardRef ? [storyboardRef] : []), ...keyframeRefs], 12);
      try {
        const segmentResults = [];
        for (const segment of segmentPlan) {
          const segmentIndex = segment.index;
          const segmentFirstFrame = keyframeRefs[segmentIndex]?.imageUrl ?? firstFrameUrl;
          const segmentSettings = {
            ...videoSettings,
            duration: `${segment.modelSeconds}s`,
            mode: "图生视频"
          };
          const segmentPrompt = [
            executableVideoPrompt(frame.prompt, brand, segmentSettings, videoPromptRefs),
            `Segment ${segmentIndex + 1}/${segmentPlan.length}: model must generate a ${segment.modelSeconds}s source clip for final segment target ${segment.targetSeconds}s${segment.trim ? "; editor will trim the usable beginning to target duration" : ""}.`,
            `Audio/voice rule: make this segment self-contained, but keep voice, language, loudness, BGM tone and rhythm consistent with other segments. Do not restart the whole story; continue the same campaign timeline.`
          ].join("\n");
          const video = await createVideoGenerationJob(
            segmentPrompt,
            workflowVideoModel,
            segmentSettings,
            Number(process.env.WORKFLOW_VIDEO_CREATE_TIMEOUT_MS ?? "45000"),
            { firstFrameUrl: segmentFirstFrame }
          );
          segmentResults.push(video);
        }
        const videoIds = segmentResults.map((video) => video?.videoId).filter(Boolean) as string[];
        const videoUrls = segmentResults.map((video) => video?.videoUrl).filter(Boolean) as string[];
        const fallbackReasons = segmentResults.map((video) => video?.fallbackReason).filter(Boolean) as string[];
        if (videoIds.length) output.videoId = videoIds.join(",");
        if (videoUrls.length === segmentPlan.length) {
          const composedUrl = videoNeedsCompose(durationSeconds, workflowVideoModel)
            ? await composeLocalVideos(videoUrls, segmentPlan, `xmanx-${frame.id}-${output.id || "video"}-final`)
            : await materializeVideoPublicUrl(videoUrls[0], `xmanx-${frame.id}-${output.id || "video"}-final`, 0);
          if (composedUrl) output.videoUrl = composedUrl;
        }
        if (output.videoUrl && firstFrameUrl) output.imageUrl = firstFrameUrl;
        if (fallbackReasons.length) output.copy = appendCopyNote(output.copy, fallbackReasons[0]);
        if (segmentResults.some((video) => video?.usedFirstFrame)) output.copy = appendCopyNote(output.copy, `已提交VDAMO 图片 API 首帧/关键帧约束视频模型，使用 ${videoPromptRefs.filter((reference) => reference.role !== "first-frame").length} 张品牌参考图生成。`);
        if (videoUrls.length === segmentPlan.length && videoNeedsCompose(durationSeconds, workflowVideoModel)) {
          output.copy = appendCopyNote(output.copy, output.videoUrl
            ? `所有分段视频已返回并完成裁切/合成: ${output.videoUrl}`
            : "所有分段视频已返回 URL，但本地未完成裁切/合成；需要 ffmpeg 或远端合成服务生成最终 MP4。");
        } else if (videoUrls.length === segmentPlan.length && !output.videoUrl) {
          output.copy = appendCopyNote(output.copy, "视频模型已返回临时 URL，但本地下载保存失败；未标记为最终 MP4。");
        }
        output.copy = appendCopyNote(output.copy, output.videoUrl
          ? `最终 MP4 文件已生成: ${output.videoUrl}`
          : videoIds.length
            ? `MP4 分段任务已创建: ${videoIds.join(" / ")}`
            : "视频 API 未配置，已保留首帧/脚本预览。");
      } catch (error) {
        output.copy = appendCopyNote(output.copy, `MP4 视频任务创建失败：${error instanceof Error ? error.message.slice(0, 140) : "video unavailable"}`);
      }
    } else {
      try {
        const pdfImageCount = collectPdfImageSources(frame, output).length;
        output.fileUrl = await createPdfArtifact(frame, output, `xmanx-${frame.id}-${output.id || "document"}`);
        output.copy = appendCopyNote(output.copy, `PDF 文件已生成: ${output.fileUrl}`);
        if (pdfImageCount > 0) output.copy = appendCopyNote(output.copy, `PDF 已合成 ${pdfImageCount} 张画布图片页。`);
      } catch (error) {
        output.copy = appendCopyNote(output.copy, `PDF 导出失败，已保留封面/结构预览：${error instanceof Error ? error.message.slice(0, 120) : "pdf unavailable"}`);
      }
    }
    const ref = generatedReference(
      `generated_${outputNode?.id ?? output.id}_${Date.now().toString(36)}_${index}`,
      output,
      outputNode?.preview ?? neutralBrandColor(brand).accent,
      output.kind === "document" ? "document-preview" : "video-preview"
    );
    upsertNodeReference(outputNode, ref);
    for (const node of nodesForOutput(frame, output)) {
      upsertNodeReference(node, ref);
      if (node.type !== "output") node.body = appendCopyNote(node.body, output.copy);
    }
  }
}

function buildReferenceItems(brand: Brand, limit = 6): ReferenceItem[] {
  const priority = ["logo", "ip", "model", "product", "menu", "storefront", "environment", "equipment", "general"];
  const assetRefs: ReferenceItem[] = db.assets
    .filter((asset) => asset.brandId === brand.id && !asset.type.startsWith("generated_") && asset.imageUrl)
    .map((asset) => ({
      id: `asset_${asset.id}`,
      role: assetTypeToReferenceRole(asset.type, asset.title, asset.meta),
      title: asset.title,
      description: asset.meta,
      color: asset.color,
      imageUrl: asset.imageUrl
    }));
  return assetRefs
    .filter((reference, index, list) => list.findIndex((item) => item.role === reference.role && item.title === reference.title) === index)
    .sort((a, b) => priority.indexOf(a.role) - priority.indexOf(b.role))
    .slice(0, limit);
}

function mergeWorkflowNodes(nextNodes: WorkflowNode[], currentNodes?: WorkflowNode[]) {
  if (!currentNodes?.length) return nextNodes;
  return nextNodes.map((node) => {
    const current = currentNodes.find((item) => item.id === node.id);
    return current ? { ...node, title: current.title, body: current.body, preview: current.preview ?? node.preview } : node;
  });
}

function createFrame(
  prompt: string,
  mode: CanvasFrame["mode"],
  x = 120,
  y = 120,
  status: CanvasFrame["status"] = "generating",
  taskId?: string,
  templateCost?: number,
  requestedModelId?: string,
  requestedSettings?: Partial<GenerationSettings>,
  requestedBrandId?: string | null,
  requestedBrandInject?: boolean,
  requestedBrandContext?: string,
  requestedWorkflowNodes?: WorkflowNode[],
  requestedOutputs?: CanvasFrame["outputs"]
): CanvasFrame {
  const brand = requestedBrandId === null ? undefined : requestedBrandId ? db.brands.find((item) => item.id === requestedBrandId) : inferBrandFromPrompt(prompt);
  const model = findModelById(requestedModelId) ?? defaultImageModel();
  const settings = defaultSettings(prompt, requestedSettings);
  const explicitSettingsBrandInject = typeof requestedSettings?.brandInject === "boolean";
  settings.brandInject = Boolean(brand && (requestedBrandInject ?? (explicitSettingsBrandInject ? settings.brandInject : promptRequestsWholeBrand(prompt, brand))));
  const brandContext = brand ? requestedBrandContext?.trim() || buildBrandContext(brand) : "";
  const finalPrompt = buildFinalPrompt(prompt, brandContext, settings.brandInject, brand);
  const resolved = resolvePromptAssets(prompt, brand);
  const outputTargets = resolved.outputs.length
    ? resolved.outputs
    : Array.from({ length: Math.max(1, Math.min(settings.count, 6)) }, (_unused, index) => (
        prompt.includes("视频") && index === 0 ? "mp4" : index === 0 ? "image" : `image-${index + 1}`
      ));
  const title = prompt.length > 24 ? `${prompt.slice(0, 24)}...` : prompt;
  const qualityMultiplier = settings.quality === "ultra" ? 1.6 : settings.quality === "hd" ? 1.2 : 1;
  const cost = Math.ceil(estimateCost(prompt, mode, templateCost) * model.costMultiplier * qualityMultiplier * Math.max(1, settings.count / 3));
  const colors = neutralBrandColor(brand);
  const gradients = [
    `linear-gradient(135deg, ${colors.accent}, #f8fafc 58%, ${colors.primary})`,
    "linear-gradient(135deg, #f59e0b, #fff7ed 54%, #0f172a)",
    "linear-gradient(135deg, #14b8a6, #ecfeff 58%, #312e81)",
    "linear-gradient(135deg, #ef4444, #fff1f2 58%, #1f2937)"
  ];

  return {
    id: nanoid(8),
    title,
    prompt,
    mode,
    status,
    x,
    y,
    w: 980,
    h: 360,
    cost,
    progress: status === "success" ? 100 : 8,
    modelId: model.id,
    modelName: model.name,
    settings,
    brandId: brand?.id ?? "",
    brandName: brand?.name ?? "无品牌",
    brandInjected: settings.brandInject,
    brandContext: settings.brandInject ? brandContext : "",
    finalPrompt,
    taskId,
    steps: buildWorkflow(prompt, brand, settings.brandInject),
    workflowNodes: requestedWorkflowNodes ?? buildWorkflowNodes(prompt, brand, model, settings, brandContext, settings.brandInject, buildWorkflowBridge(prompt, brand, settings, settings.brandInject)),
    outputs: requestedOutputs ?? outputTargets.map((target, index) => ({
      id: nanoid(6),
      title: labelForOutputTarget(target),
      kind: outputKindForTarget(target),
      gradient: gradients[index % gradients.length],
      copy: brand ? `${brand.logoText} / ${brand.market.split(" ")[0] ?? "brand"} / ${target}` : `无品牌 / prompt-only / ${target}`
    })),
    createdAt: now(),
    updatedAt: now()
  };
}

function createEmptyFrame(requestedBrandId?: string | null): CanvasFrame {
  const brand = requestedBrandId ? db.brands.find((item) => item.id === requestedBrandId) : undefined;
  const model = defaultImageModel();
  const settings = defaultSettings("", { ratio: "1:1", count: 1, quality: "hd", brandInject: false });
  return {
    id: nanoid(8),
    title: "未命名画布",
    prompt: "",
    mode: "magic",
    status: "ready",
    x: 120,
    y: 120,
    w: 980,
    h: 360,
    cost: 0,
    progress: 0,
    modelId: model.id,
    modelName: model.name,
    settings,
    brandId: brand?.id ?? "",
    brandName: brand?.name ?? "无品牌",
    brandInjected: false,
    brandContext: "",
    finalPrompt: "",
    steps: [],
    workflowNodes: [],
    outputs: [],
    createdAt: now(),
    updatedAt: now()
  };
}

function buildWorkflow(prompt: string, brand?: Brand, brandInject = true) {
  const resolved = resolvePromptAssets(prompt, brand);
  const outputTargets = resolved.outputs.length ? resolved.outputs.map(labelForOutputTarget).join(" + ") : (prompt.includes("视频") ? "视频" : "图片");
  return [
    "Intent Router 解析自然语言目标",
    resolved.commands.length ? `Command Router 执行 ${resolved.commands.map((item) => `/${item}`).join(", ")}` : "Command Router 使用自然语言自动选择工作流",
    brand && brandInject ? `Brand Agent 注入 ${brand.name} 的 Logo、IP、素材角色、色彩、语气与禁用项` : "Brand Agent 跳过品牌上下文注入，仅使用本次提示词和显式 $ 引用",
    prompt.includes("视频") || resolved.outputs.some((item) => outputKindForTarget(item) === "video") ? "编排图像关键帧、分镜脚本与视频节点" : "生成主视觉、背景与商品构图",
    `Output Router 准备 ${outputTargets} 交付节点`,
    "质量检查、资产入库并写回画布历史"
  ];
}

function buildWorkflowNodes(prompt: string, brand: Brand | undefined, model: (typeof models)[number], settings: GenerationSettings, brandContext = brand ? buildBrandContext(brand) : "", brandInjected = settings.brandInject, bridge?: WorkflowBridge) {
  const resolved = resolvePromptAssets(prompt, brand);
  const promptRefs = resolved.imageReferences;
  const outputTargets = resolved.outputs.length
    ? resolved.outputs
    : Array.from({ length: Math.max(1, Math.min(settings.count, 6)) }, (_unused, index) => (
        prompt.includes("视频") && index === 0 ? "mp4" : index === 0 ? "image" : `image-${index + 1}`
      ));
  const colors = neutralBrandColor(brand);
  const referenceItems = [...promptRefs, ...(brand && brandInjected ? buildReferenceItems(brand) : [])]
    .filter((reference, index, list) => list.findIndex((item) => item.id === reference.id) === index)
    .slice(0, 12);
  const nodes: WorkflowNode[] = [
    {
      id: "input-image",
      type: "image" as const,
      title: referenceItems.length ? "多图参考" : "空参考位",
      body: referenceItems.length ? referenceItems.map((asset) => `${asset.role}: ${asset.title}`).join(" / ") : "未引用图片。输入 $logo / $ip / $xmanx.product 或连接前置节点后再生成。",
      preview: colors.accent,
      refs: referenceItems,
      x: 0,
      y: 190,
      w: 250,
      h: 390
    },
    {
      id: "brand",
      type: "brand" as const,
      title: brand && brandInjected ? "品牌上下文" : "资源上下文",
      body: brand && brandInjected ? brandContext : "品牌注入关闭。仅解析提示词中的显式 $ 资源引用，不自动附加项目品牌包。",
      parentId: "input-image",
      x: 245,
      y: 190,
      w: 260,
      h: 360
    },
    {
      id: "prompt",
      type: "prompt" as const,
      title: brandInjected ? "最终提示词" : "提示词",
      body: buildFinalPrompt(prompt, brandContext, brandInjected, brand),
      parentId: "brand",
      x: 490,
      y: 110,
      w: 280,
      h: 250
    }
  ];
  let parentForVisual = "prompt";
  let nextX = 820;
  const needsSharedVisualDraft = outputTargets.some((target) => outputKindForTarget(target) === "document");
  if (needsSharedVisualDraft) {
    nodes.push({
      id: "visual-draft",
      type: "image",
      title: "视觉草图",
      body: [
        `CAL: ${calWorkflowLine(prompt, brand, "image")}`,
        `执行: 生成可复用主视觉，供 PDF 封面、海报和 MP4 首帧引用。输出目标: ${outputTargets.map(labelForOutputTarget).join(" + ")}。`
      ].join("\n"),
      parentId: "prompt",
      preview: colors.accent,
      refs: referenceItems,
      x: nextX,
      y: 100,
      w: 250,
      h: 330
    });
    parentForVisual = "visual-draft";
    nextX += 300;
  }

  for (const [index, target] of outputTargets.entries()) {
    const kind = outputKindForTarget(target);
    if (kind === "document") {
      const docNodeId = `doc-${target}-${index}`;
      nodes.push({
        id: docNodeId,
        type: "process",
        title: `${labelForOutputTarget(target)} 内容编辑器`,
        body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 生成 ${labelForOutputTarget(target)}：封面、目录、品牌介绍、核心视觉、操作步骤、输出规范。可继续编辑为 Markdown 后导出 ${target.toUpperCase()}。`,
        parentId: parentForVisual,
        preview: "#2563eb",
        x: nextX,
        y: 80,
        w: 360,
        h: 260
      });
      nodes.push({
        id: `output-${target}`,
        type: "output",
        title: `${labelForOutputTarget(target)} 输出`,
        body: `最终交付 ${labelForOutputTarget(target)}。来源: ${docNodeId}。`,
        parentId: docNodeId,
        preview: "#1d4ed8",
        x: nextX + 420,
        y: 110,
        w: 250,
        h: 260
      });
      continue;
    }
    if (kind === "video") {
      const workflowVideoModel = serviceConfig("video").model;
      const durationSeconds = videoDurationSeconds(settings);
      const segmentPlan = videoSegmentPlan(durationSeconds, workflowVideoModel);
      const needsCompose = videoNeedsCompose(durationSeconds, workflowVideoModel);
      const scriptNodeId = `script-${target}-${index}`;
      const videoNodeId = `video-${target}-${index}`;
      const composeNodeId = `compose-${target}-${index}`;
      const segmentNodeIds = segmentPlan.map((segment) => `${videoNodeId}-seg-${segment.index + 1}`);
      const segmentColumnX = nextX + 430;
      const composeX = segmentColumnX + 360;
      const segmentStartY = Math.max(90, 360 - (segmentPlan.length - 1) * 145);
      const segmentGapY = 300;
      const composeY = segmentStartY + ((segmentPlan.length - 1) * segmentGapY) / 2;
      nodes.push({
        id: scriptNodeId,
        type: "script",
        title: "视频脚本",
        body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 根据视觉草图生成分镜表格、镜头运动、音效和字幕约束，目标输出 ${labelForOutputTarget(target)}。\n${videoStoryboardBrief(prompt, brand, referenceItems, { duration: `${settings.duration || 5}s`, ratio: settings.ratio, contentLanguage: settings.contentLanguage })}`,
        parentId: parentForVisual,
        preview: "#7c3aed",
        refs: referenceItems,
        x: nextX,
        y: 400,
        w: 360,
        h: 260
      });
      let parentForVideoOutput = videoNodeId;
      if (needsCompose) {
        segmentPlan.forEach((segment) => {
          nodes.push({
            id: segmentNodeIds[segment.index],
            type: "video",
            title: `视频片段 ${segment.index + 1}/${segmentPlan.length}`,
            body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 第 ${segment.index + 1} 段图生视频，模型固定生成 ${segment.modelSeconds}s，最终使用 ${segment.targetSeconds}s${segment.trim ? "，进入合成节点后裁切" : ""}。每段单独使用关键帧、旁白/配音提示和同一品牌约束。`,
            parentId: scriptNodeId,
            preview: "#111827",
            refs: referenceItems,
            x: segmentColumnX,
            y: segmentStartY + segment.index * segmentGapY,
            w: 280,
            h: 260
          });
        });
        nodes.push({
          id: composeNodeId,
          type: "compose",
          title: "视频合成剪辑",
          body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 最终成片 ${durationSeconds}s；${workflowVideoModel} 固定 ${videoModelClipSeconds(workflowVideoModel)}s/段；${videoSegmentSummary(durationSeconds, workflowVideoModel)}。统一音乐床、旁白音色、音量、字幕语言、转场节奏和品牌收尾；避免看出两个不配套的视频。`,
          parentId: scriptNodeId,
          inputIds: segmentNodeIds,
          preview: "#0f766e",
          refs: referenceItems,
          x: composeX,
          y: composeY,
          w: 320,
          h: 260
        });
        parentForVideoOutput = composeNodeId;
      } else {
        nodes.push({
          id: videoNodeId,
          type: "video",
          title: `${labelForOutputTarget(target)} 生成`,
          body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 先用VDAMO 图片 API 生成/锁定视频首帧，再把首帧提交给视频模型做图生视频；如果模型不接受首帧，必须在输出状态中明确降级。`,
          parentId: scriptNodeId,
          preview: "#111827",
          refs: referenceItems,
          x: nextX + 420,
          y: 400,
          w: 260,
          h: 260
        });
      }
      nodes.push({
        id: `output-${target}`,
        type: "output",
        title: `${labelForOutputTarget(target)} 输出`,
        body: `最终交付 ${labelForOutputTarget(target)}。来源: ${parentForVideoOutput}。`,
        parentId: parentForVideoOutput,
        preview: "#0f172a",
        x: needsCompose ? composeX + 390 : nextX + 730,
        y: needsCompose ? composeY : 400,
        w: 250,
        h: 260
      });
      continue;
    }
    nodes.push({
      id: index === 0 && outputTargets.length === 1 ? "output" : `output-${target}-${index}`,
      type: "output",
      title: `${labelForOutputTarget(target)} 输出`,
      body: `${settings.count} 张${brandInjected ? "品牌一致的" : ""}可用结果 · ${model.name} · ${labelForOutputTarget(target)}`,
      parentId: parentForVisual,
      preview: colors.accent,
      x: nextX,
      y: 190 + index * 36,
      w: 250,
      h: 330
    });
  }
  return bridge ? applyWorkflowBridgeToNodes(nodes, bridge) : nodes;
}

async function completeTask(taskId: string) {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task || task.status === "completed") return;
  const frame = db.frames.find((item) => item.id === task.frameId);
  if (!frame) return;

  const phases: Array<{ status: GenerationTask["status"]; progress: number; delay: number }> = [
    { status: "routing", progress: 32, delay: 450 },
    { status: "generating", progress: 72, delay: 650 },
    { status: "completed", progress: 100, delay: 650 }
  ];

  let elapsed = 0;
  for (const phase of phases) {
    elapsed += phase.delay;
    const timer = setTimeout(async () => {
      task.updatedAt = now();
      task.status = phase.status === "completed" ? "generating" : phase.status;
      task.progress = phase.status === "completed" ? 96 : phase.progress;
      frame.progress = task.progress;
      frame.status = "generating";
      frame.updatedAt = now();

      if (phase.status === "completed") {
        try {
          await fillFrameOutputs(frame);
          task.status = "completed";
          task.progress = 100;
          frame.status = "success";
          frame.progress = 100;
          task.completedAt = now();
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 140) : "workflow finalization failed";
          frame.outputs = frame.outputs.map((output) => output.imageUrl ? output : {
            ...output,
            imageUrl: fallbackImageDataUrl("Workflow fallback"),
            copy: appendCopyNote(output.copy, `流程收尾降级：${message}`)
          });
          task.status = "completed";
          task.progress = 100;
          frame.status = "success";
          frame.progress = 100;
          task.completedAt = now();
        } finally {
          task.updatedAt = now();
          frame.updatedAt = now();
          runningTimers.delete(taskId);
        }
      }

      await persistDb();
    }, elapsed);
    runningTimers.set(taskId, timer);
  }
}

function googleClientId() {
  return process.env.SPARKCANVAS_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || localAuthValue("SPARKCANVAS_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID");
}

async function verifyGoogleCredential(credential: string) {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google login is not configured");
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error_description === "string" ? payload.error_description : "Google token verification failed");
  if (payload.aud !== clientId) throw new Error("Google token audience does not match this app");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") throw new Error("Google token issuer is invalid");
  if (payload.email_verified !== "true" && payload.email_verified !== true) throw new Error("Google account email is not verified");
  const email = typeof payload.email === "string" ? payload.email : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!email || !sub) throw new Error("Google token did not include a verified user");
  return {
    email,
    sub,
    name: typeof payload.name === "string" ? payload.name : email.split("@")[0],
    picture: typeof payload.picture === "string" ? payload.picture : undefined
  };
}

const app = express();
app.set("trust proxy", 1);

type AuthRateLimitState = {
  count: number;
  resetAt: number;
};

const authRateLimits = new Map<string, AuthRateLimitState>();
const authRateLimitRules = {
  login: { limit: 10, windowMs: 2 * 60 * 1000 },
  register: { limit: 4, windowMs: 10 * 60 * 1000 },
  google: { limit: 10, windowMs: 2 * 60 * 1000 }
} as const;

function authRateLimitKey(kind: keyof typeof authRateLimitRules, identifier: string) {
  return `${kind}:${identifier}`;
}

function takeAuthRateLimitSlot(kind: keyof typeof authRateLimitRules, identifier: string) {
  const { limit, windowMs } = authRateLimitRules[kind];
  const key = authRateLimitKey(kind, identifier);
  const current = Date.now();
  const state = authRateLimits.get(key);
  if (!state || state.resetAt <= current) {
    authRateLimits.set(key, { count: 1, resetAt: current + windowMs });
    return { allowed: true as const, remaining: limit - 1, resetAt: current + windowMs };
  }
  if (state.count >= limit) {
    return { allowed: false as const, remaining: 0, resetAt: state.resetAt };
  }
  state.count += 1;
  authRateLimits.set(key, state);
  return { allowed: true as const, remaining: limit - state.count, resetAt: state.resetAt };
}

function clearExpiredAuthRateLimits() {
  const current = Date.now();
  for (const [key, state] of authRateLimits) {
    if (state.resetAt <= current) authRateLimits.delete(key);
  }
}

function authRateLimitError(res: Response, state: { resetAt: number }, message: string) {
  const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
  return res.status(429).setHeader("Retry-After", String(retryAfterSeconds)).json({ message });
}

function authClientId(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function installAsyncRouteCatcher(target: express.Express) {
  const methods = ["get", "post", "patch", "delete", "use"] as const;
  const mutableTarget = target as unknown as Record<(typeof methods)[number], (...args: unknown[]) => unknown>;
  for (const method of methods) {
    const original = mutableTarget[method].bind(target);
    mutableTarget[method] = (...args: unknown[]) => original(...args.map((arg) => {
      if (typeof arg !== "function" || arg.length === 4) return arg;
      const handler = arg as (req: Request, res: Response, next: NextFunction) => unknown;
      return (req: Request, res: Response, next: NextFunction) => {
        try {
          return Promise.resolve(handler(req, res, next)).catch(next);
        } catch (error) {
          return next(error);
        }
      };
    }));
  }
}

installAsyncRouteCatcher(app);
if (isProduction && !authToken && !adminAccount && !adminPassword && !googleClientId() && !registrationEnabled) {
  throw new Error("Production auth is not configured. Set SPARKCANVAS_AUTH_TOKEN, admin login envs, Google login, or enable registration explicitly.");
}
app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
  credentials: false
}));
app.use(express.json({ limit: "20mb" }));
app.use((_req, _res, next) => {
  clearExpiredAuthRateLimits();
  next();
});
app.use("/generated", generatedFileMiddleware, express.static(generatedDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sparkcanvas-api", domain: "xmanx.com" });
});

app.get("/auth/config", (_req, res) => {
  const clientId = googleClientId();
  res.json({
    registrationEnabled,
    registrationReason: registrationEnabled
      ? "Registration is available in this environment."
      : "Registration is disabled in this environment.",
    google: {
      configured: Boolean(clientId),
      clientId: clientId || "",
      reason: clientId
        ? "Google sign-in is configured."
        : "Set SPARKCANVAS_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID to enable Google sign-in."
    },
    demo: {
      enabled: demoAuthEnabled,
      defaultAccount: demoAuthEnabled ? DEFAULT_DEMO_ACCOUNT : "",
      defaultPassword: demoAuthEnabled ? DEFAULT_DEMO_PASSWORD : "",
      reason: demoAuthEnabled
        ? "Demo login is available in this environment."
        : "Demo login is disabled in production."
    }
  });
});

app.post("/auth/login", async (req, res) => {
  const parsed = z.object({ account: z.string(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid login payload" });
  const rateLimitState = takeAuthRateLimitSlot("login", `${authClientId(req)}:${parsed.data.account.trim().toLowerCase()}`);
  if (!rateLimitState.allowed) return authRateLimitError(res, rateLimitState, "Too many login attempts, please wait and try again.");
  const user = findAuthUser(parsed.data.account.trim());
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return res.status(401).json({ message: "Invalid email/account or password" });
  }
  const session = upsertSession(user, "login");
  await persistDb();
  res.json({ token: session.token, user: publicUser(user) });
});

app.post("/auth/register", async (req, res) => {
  if (!registrationEnabled) return res.status(403).json({ message: "Registration is disabled" });
  const parsed = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email(),
    password: z.string().min(6)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid registration payload" });
  const email = parsed.data.email.trim().toLowerCase();
  const rateLimitState = takeAuthRateLimitSlot("register", `${authClientId(req)}:${email}`);
  if (!rateLimitState.allowed) return authRateLimitError(res, rateLimitState, "Too many registration attempts, please wait and try again.");
  if (findAuthUser(email)) return res.status(409).json({ message: "Account already exists" });
  const timestamp = now();
  const user: AuthUser = {
    id: `user_${nanoid(8)}`,
    name: parsed.data.name?.trim() || email.split("@")[0] || "New User",
    username: email.split("@")[0] || undefined,
    email,
    plan: "Starter",
    credits: 1260,
    provider: "email",
    passwordHash: passwordHash(parsed.data.password),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.users.unshift(user);
  const session = upsertSession(user, "register");
  await persistDb();
  res.status(201).json({ token: session.token, user: publicUser(user) });
});

app.post("/auth/google", async (req, res) => {
  const parsed = z.object({ credential: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid Google login payload" });
  const rateLimitState = takeAuthRateLimitSlot("google", authClientId(req));
  if (!rateLimitState.allowed) return authRateLimitError(res, rateLimitState, "Too many Google sign-in attempts, please wait and try again.");
  try {
    const verified = await verifyGoogleCredential(parsed.data.credential);
    const existing = db.users.find((user) => user.googleSub === verified.sub || user.email.toLowerCase() === verified.email.toLowerCase());
    const timestamp = now();
    const user: AuthUser = existing
      ? {
          ...existing,
          name: existing.name || verified.name,
          email: verified.email,
          provider: "google",
          googleSub: verified.sub,
          avatarUrl: verified.picture ?? existing.avatarUrl,
          updatedAt: timestamp
        }
      : {
          id: `user_${nanoid(8)}`,
          name: verified.name,
          username: verified.email.split("@")[0] || undefined,
          email: verified.email,
          plan: "Starter",
          credits: 1260,
          provider: "google",
          googleSub: verified.sub,
          avatarUrl: verified.picture,
          createdAt: timestamp,
          updatedAt: timestamp
        };
    if (existing) {
      db.users = db.users.map((item) => item.id === existing.id ? user : item);
    } else {
      db.users.unshift(user);
    }
    const session = upsertSession(user, "google");
    await persistDb();
    res.json({ token: session.token, user: publicUser(user) });
  } catch (error) {
    return res.status(401).json({ message: error instanceof Error ? error.message : "Google login failed" });
  }
});

app.post("/auth/logout", async (req, res) => {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (token) {
    db.sessions = db.sessions.filter((session) => session.token !== token);
    await persistDb();
  }
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (!isProduction && req.path.startsWith("/workgraph-os")) {
    const user = db.users[0] ?? defaultAuthUser();
    if (!db.users.some((item) => item.id === user.id)) db.users.unshift(user);
    req.authUser = user;
    req.authSession = db.sessions.find((session) => session.userId === user.id);
    req.authToken = DEMO_TOKEN;
    return next();
  }
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const authUser = authUserFromToken(token);
  if (!authUser) return res.status(401).json({ message: "Unauthorized" });
  req.authUser = authUser;
  req.authSession = db.sessions.find((session) => session.token === token);
  req.authToken = token;
  next();
});

app.get("/me", (req, res) => {
  res.json(publicUser(req.authUser!));
});

app.post("/me/credits/refill", async (req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_CREDIT_REFILL !== "true") {
    return res.status(403).json({ message: "Demo credit refill is disabled in production" });
  }
  req.authUser!.credits = Math.max(req.authUser!.credits, 1260);
  req.authUser!.updatedAt = now();
  await persistDb();
  res.json(publicUser(req.authUser!));
});

app.get("/workspace", async (req, res) => {
  await repairInterruptedGenerations();
  await refreshPendingVideoOutputs();
  const workspace = applyGeneratedFileAuthToWorkspace(req.authToken);
  res.json({ user: publicUser(req.authUser!), brands: workspace.brands, assets: workspace.assets, templates, models: publicModels(), frames: workspace.frames, tasks: db.tasks, ai: aiStatus() });
});

app.get("/workspace/export", (req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="sparkcanvas-workspace-${Date.now()}.json"`);
  res.json({
    exportedAt: now(),
    domain: "xmanx.com",
    workspace: { user: publicUser(req.authUser!), brands: db.brands, assets: db.assets, templates, models: publicModels(), frames: db.frames, tasks: db.tasks }
  });
});

app.get("/workgraph-os/workspace", async (_req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const objectIndex = buildWorkGraphOsObjectIndex(workspace);
  res.json({
    storage: {
      mode: "filesystem-json",
      file: workGraphOsDataFile,
      exists: Boolean(workspace)
    },
    workspace,
    objectIndex
  });
});

app.get("/workgraph-os/brands", async (_req, res) => {
  const brands = db.brands
    .filter((brand) => !brand.archived)
    .map((brand) => workGraphBrandPayload(brand, brand.id));
  const files = await syncBrandRecords({ brandDir: workGraphOsBrandDataDir }, brands);
  res.json({
    source: "brand-store",
    storage: {
      mode: "filesystem-json",
      dir: workGraphOsBrandDataDir,
      files
    },
    brands
  });
});

app.get("/workgraph-os/assets", async (req, res) => {
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const assets = db.assets
    .filter((asset) => !brandId || asset.brandId === brandId)
    .map(workGraphAssetPayload)
    .filter((asset) => {
      if (!query) return true;
      return [asset.title, asset.token, asset.note, asset.tags.join(" ")].join(" ").toLowerCase().includes(query);
    });
  res.json({
    source: "sparkcanvas-asset-store",
    assets
  });
});

app.post("/workgraph-os/assets/upload", express.raw({ type: "*/*", limit: "100mb" }), async (req, res) => {
  const input = z.object({
    title: z.string().optional(),
    filename: z.string().optional(),
    mime: z.string().optional(),
    brandId: z.string().optional(),
    tags: z.string().optional(),
    note: z.string().optional()
  }).parse(req.query);
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!bytes.length) return res.status(400).json({ message: "Uploaded asset is empty" });
  const filename = input.filename || "asset.bin";
  const title = input.title?.trim() || filename.replace(/\.[^.]+$/, "") || "WorkGraph Asset";
  const mime = input.mime || String(req.headers["content-type"] ?? "application/octet-stream");
  const stored = await storeWorkGraphAssetBuffer(bytes, filename, mime);
  const imageUrl = isPreviewableImageAsset(stored)
    ? `/workgraph-os/assets/file/${stored.relativePath}`
    : undefined;
  const assetType: Asset["type"] = stored.kind === "video" ? "generated_video" : stored.kind === "image" ? "upload" : "upload";
  const meta = [
    input.note || "workgraph-os asset upload",
    `kind:${stored.kind}`,
    `file:${stored.relativePath}`,
    `size:${stored.size}`,
    `mime:${mime}`,
    input.tags ? `tags:${input.tags}` : ""
  ].filter(Boolean).join(" ");
  const asset = createAsset(title, assetType, input.brandId ?? activeBrand().id, "#94a3b8", meta, imageUrl);
  const companion = await createWorkGraphAssetCompanions({
    assetId: asset.id,
    title,
    stored,
    brandId: asset.brandId,
    tags: input.tags ? input.tags.split(",").map((item) => item.trim()).filter(Boolean) : []
  });
  asset.meta = [
    asset.meta,
    `thumbnail:${companion.thumbnailRelativePath}`,
    `version:${companion.versionRelativePath}`,
    `usage:${companion.usageRelativePath}`
  ].join(" ");
  db.assets.unshift(asset);
  await persistDb();
  const workspace = await readWorkGraphOsWorkspace();
  let nextWorkspace = workspace;
  if (workspace) {
    const material = workGraphAssetPayload(asset);
    nextWorkspace = {
      ...workspace,
      materials: [material, ...workspace.materials.filter((item) => objectString(item, "id", "") !== asset.id)],
      selectedIds: workspace.selectedIds.includes(asset.id) ? workspace.selectedIds : [asset.id, ...workspace.selectedIds],
      activeMaterialId: asset.id,
      updatedAt: now()
    };
    await writeWorkGraphOsWorkspace(nextWorkspace);
  }
  res.status(201).json({
    source: "workgraph-asset-store",
    asset: workGraphAssetPayload(asset),
    workspace: nextWorkspace,
    objectIndex: buildWorkGraphOsObjectIndex(nextWorkspace),
    storage: {
      dir: workGraphOsAssetDataDir,
      relativePath: stored.relativePath,
      absolutePath: stored.absolutePath
    }
  });
});

app.delete("/workgraph-os/assets/:id", async (req, res) => {
  const assetId = safeWorkGraphRelativePath(req.params.id ?? "");
  if (!assetId) return res.status(400).json({ message: "Asset id is required" });
  const index = db.assets.findIndex((asset) => asset.id === assetId);
  if (index === -1) return res.status(404).json({ message: "Asset not found" });
  const [asset] = db.assets.splice(index, 1);
  const payload = workGraphAssetPayload(asset);
  await persistDb();

  const workspace = await readWorkGraphOsWorkspace();
  let nextWorkspace = workspace;
  if (workspace) {
    nextWorkspace = {
      ...workspace,
      selectedIds: workspace.selectedIds.filter((id) => id !== assetId),
      activeMaterialId: workspace.activeMaterialId === assetId ? "" : workspace.activeMaterialId,
      materials: workspace.materials.filter((material) => objectString(material, "id", "") !== assetId),
      nodes: workspace.nodes.map((node) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return node;
        const item = node as Record<string, unknown>;
        return {
          ...item,
          materialIds: (Array.isArray(item.materialIds) ? item.materialIds : []).filter((id): id is string => typeof id === "string" && id !== assetId)
        };
      }),
      updatedAt: now()
    };
    await writeWorkGraphOsWorkspace(nextWorkspace);
  }

  for (const file of [payload.dataPath, payload.thumbnailPath, payload.versionPath, payload.usagePath]) {
    if (file && file.startsWith(workGraphOsAssetDataDir)) await rm(file, { recursive: true, force: true });
  }
  await rm(path.join(workGraphOsAssetDataDir, `asset-${assetId}.json`), { recursive: true, force: true });
  await cleanupWorkGraphAssetSnapshotsByTitle(assetId, asset.title);

  res.json({
    ok: true,
    id: assetId,
    workspaceUpdatedAt: nextWorkspace?.updatedAt ?? "",
    assetCount: db.assets.length
  });
});

app.get(/^\/workgraph-os\/assets\/file\/(.+)$/, (req, res) => {
  const relativePath = safeWorkGraphRelativePath(req.params[0] ?? "");
  if (!relativePath) return res.status(404).json({ message: "Asset file not found" });
  const filePath = path.join(workGraphOsAssetDataDir, relativePath);
  if (!filePath.startsWith(workGraphOsAssetDataDir) || !existsSync(filePath)) return res.status(404).json({ message: "Asset file not found" });
  res.sendFile(filePath);
});

app.get("/workgraph-os/skills", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const skills = (await workGraphSkillCatalogWithFs(workspace)).filter((skill) => {
    if (!query) return true;
    return [objectString(skill, "title"), objectString(skill, "command"), objectString(skill, "description"), objectStringArray(skill, "keywords").join(" "), objectString(skill, "capabilityType")].join(" ").toLowerCase().includes(query);
  });
  res.json({
    source: "workgraph-skill-store",
    filesystem: {
      piDir: path.join(workGraphOsPiDir, "skills"),
      dataDir: workGraphOsSkillDataDir,
      systemFiles: [path.join(workGraphOsPiDir, "AGENTS.md"), path.join(workGraphOsPiDir, "SYSTEM.md")]
    },
    onlineSearch: {
      status: "planned",
      disabled: true
    },
    skills
  });
});

app.get("/workgraph-os/models/probe", async (_req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const catalog = workspace ? workGraphModelCatalog(workspace) : buildWorkGraphModelCatalog("imgen", "PNG");
  const piConfig = workGraphPiWebConfig();
  const piModels = await listPiWebModels(piConfig);
  // Index live pi-web models by both "provider:id" and bare id so catalog ids
  // like "vdamo-gpt-image-2" can be matched to provider "vdamo" / id "gpt-image-2".
  const liveIds = new Set<string>();
  for (const model of piModels) {
    // Normalize dots to dashes so pi-web ids like "gpt-image-1.5" match catalog
    // ids like "vdamo-gpt-image-1-5".
    const bare = model.id.toLowerCase().replace(/\./g, "-");
    liveIds.add(bare);
    if (model.provider) liveIds.add(`${model.provider}-${bare}`.toLowerCase());
  }
  const catalogProbe = catalog.map((item) => {
    const id = String(item.id);
    const normalized = id.toLowerCase();
    const bareId = normalized.replace(/^(vdamo|yijiarj|local)-/, "");
    const live = liveIds.size === 0
      ? "unknown"
      : (liveIds.has(normalized) || liveIds.has(bareId)) ? "available" : "unavailable";
    return { id, kind: item.kind, status: item.status, capabilities: item.capabilities, fallbackModelIds: item.fallbackModelIds, live };
  });
  res.json({
    source: "workgraph-model-probe",
    piWeb: { baseUrl: piConfig.baseUrl, mode: piConfig.mode, reachable: piModels.length > 0, modelCount: piModels.length },
    liveModels: piModels,
    catalog: catalogProbe
  });
});

app.get("/workgraph-os/skills/evolution", async (_req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const skills = workspace?.skills ?? [];
  const templates = skills
    .filter((skill) => Boolean(objectField(objectField(skill, "evolution"), "template")) || objectString(objectField(skill, "evolution"), "status", "") === "reusable-template")
    .map((skill) => ({
      id: objectString(skill, "id", ""),
      title: objectString(skill, "title", ""),
      status: objectString(objectField(skill, "evolution"), "status", ""),
      successCount: Number(objectField(objectField(skill, "evolution"), "successCount") ?? 0),
      validatedBy: objectString(objectField(skill, "evolution"), "validatedBy", "")
    }));
  const repairTasks = (workspace?.jobs ?? []).filter((job) => objectString(job, "type", "") === "skill-repair");
  res.json({ source: "workgraph-skill-evolution", templates, repairTasks });
});

app.get("/workgraph-os/skills/:id", async (req, res) => {
  const detail = await workGraphSkillDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "Skill not found" });
  res.json(detail);
});

app.put("/workgraph-os/skills/:id/files", async (req, res) => {
  const parsed = workGraphOsSkillFileSaveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid Skill file payload" });
  const detail = await workGraphSkillDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "Skill not found" });
  const skill = detail.skill as Record<string, unknown>;
  const reason = parsed.data.reason?.trim() || `manual edit ${parsed.data.path}`;
  if (parsed.data.path === "skill.json") {
    try {
      JSON.parse(parsed.data.content);
    } catch {
      return res.status(400).json({ message: "skill.json must be valid JSON" });
    }
  }
  await ensureWorkGraphSkillFiles(skill);
  const snapshotAt = await snapshotWorkGraphSkillVersion(skill, reason);
  await writeWorkGraphSkillFileToDirs(skill, parsed.data.path, `${parsed.data.content.trimEnd()}\n`);
  await appendWorkGraphSkillLog(skill, "file-edited", {
    path: parsed.data.path,
    reason,
    snapshotAt,
    bytes: Buffer.byteLength(parsed.data.content, "utf8")
  });
  const nextDetail = await workGraphSkillDetail(req.params.id);
  const workspace = await readWorkGraphOsWorkspace();
  res.json({
    source: "pi-adapter",
    status: "saved",
    writesFiles: true,
    file: parsed.data.path,
    snapshotAt,
    detail: nextDetail,
    objectIndex: buildWorkGraphOsObjectIndex(workspace),
    message: "Skill file saved with a version snapshot and edit log."
  });
});

app.post("/workgraph-os/skills/:id/optimize", async (req, res) => {
  const parsed = workGraphOsSkillOptimizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid skill optimization payload" });
  const detail = await workGraphSkillDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "Skill not found" });
  const skillMd = detail.files.find((file) => file.path === "SKILL.md")?.content ?? "";
  const plan = [
    `Read ${detail.folder}/SKILL.md and skill.json.`,
    `Apply requested change: ${parsed.data.prompt}`,
    "Create a new version under versions/ after user confirmation.",
    "Record optimization log under logs/ without overwriting previous files."
  ];
  const diffPreview = [
    `--- ${detail.folder}/SKILL.md`,
    `+++ ${detail.folder}/SKILL.md (preview)`,
    "@@",
    skillMd ? skillMd.split("\n").slice(0, 6).map((line) => ` ${line}`).join("\n") : " # Empty SKILL.md",
    "+",
    `+## Proposed Optimization`,
    `+${parsed.data.prompt}`,
    "+",
    "+Acceptance: user reviews this diff before WorkGraph OS writes a new version."
  ].join("\n");
  res.json({
    source: "pi-adapter",
    status: "preview",
    writesFiles: false,
    skill: detail.skill,
    plan,
    diffPreview,
    message: "Optimization preview only. Confirm/apply is intentionally separate so Skill files are not silently overwritten."
  });
});

app.post("/workgraph-os/skills/:id/optimize/apply", async (req, res) => {
  const parsed = workGraphOsSkillOptimizeApplySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid skill optimization apply payload" });
  const detail = await workGraphSkillDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "Skill not found" });
  const applied = await applyWorkGraphSkillOptimization(detail.skill as Record<string, unknown>, parsed.data.prompt);
  const nextDetail = await workGraphSkillDetail(req.params.id);
  const workspace = await readWorkGraphOsWorkspace();
  res.json({
    source: "pi-adapter",
    status: "applied",
    writesFiles: true,
    applied,
    skill: nextDetail?.skill ?? detail.skill,
    detail: nextDetail,
    objectIndex: buildWorkGraphOsObjectIndex(workspace),
    message: "Skill optimization applied with a version snapshot and log entry."
  });
});

app.post("/workgraph-os/skills/:id/copy", async (req, res) => {
  const parsed = workGraphOsSkillCopySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid Skill copy payload" });
  const detail = await workGraphSkillDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "Skill not found" });
  const workspace = await readWorkGraphOsWorkspace();
  if (!workspace) return res.status(409).json({ message: "WorkGraph OS workspace is empty; save a workspace before copying skills" });
  const sourceSkill = detail.skill as Record<string, unknown>;
  const title = parsed.data.title?.trim() || `${objectString(sourceSkill, "title", "Skill")} Copy`;
  const command = (parsed.data.command?.trim() || `${objectString(sourceSkill, "command", "/skill")}-copy-${nanoid(4)}`).replace(/^\/?/, "/");
  const copiedSkill = workGraphNormalizeSkill({
    ...sourceSkill,
    id: `skill-copy-${Date.now().toString(36)}-${nanoid(6)}`,
    title,
    command,
    source: "workgraph-skill-copy",
    createdAt: now(),
    evolution: {
      ...workGraphSkillEvolution(sourceSkill),
      status: "draft",
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      copiedFromSkillId: objectString(sourceSkill, "id", req.params.id),
      history: [{
        id: `skill-history-${Date.now().toString(36)}-${nanoid(6)}`,
        type: "copy",
        sourceSkillId: objectString(sourceSkill, "id", req.params.id),
        status: "draft",
        createdAt: now()
      }]
    }
  });
  await ensureWorkGraphSkillFiles(copiedSkill);
  await appendWorkGraphSkillLog(copiedSkill, "skill-copied", {
    sourceSkillId: objectString(sourceSkill, "id", req.params.id),
    sourceFolder: detail.folder
  });
  const nextWorkspace: WorkGraphOsWorkspace = {
    ...workspace,
    skills: [copiedSkill, ...workspace.skills.filter((skill) => objectString(skill, "id", "") !== objectString(copiedSkill, "id", ""))],
    updatedAt: now()
  };
  const syncedWorkspace = await writeWorkGraphOsWorkspace(nextWorkspace);
  const objectIndex = buildWorkGraphOsObjectIndex(syncedWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(syncedWorkspace, "manual");
  res.status(201).json({
    source: "workgraph-skill-store",
    status: "copied",
    skill: copiedSkill,
    detail: await workGraphSkillDetail(objectString(copiedSkill, "id", "")),
    workspace: syncedWorkspace,
    objectIndex,
    historyEntry
  });
});

app.post("/workgraph-os/skills/:id/test", async (req, res) => {
  const parsed = workGraphOsSkillTestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid Skill test payload" });
  const detail = await workGraphSkillDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "Skill not found" });
  const workspace = await readWorkGraphOsWorkspace();
  if (!workspace) return res.status(409).json({ message: "WorkGraph OS workspace is empty; save a workspace before testing skills" });
  const skill = detail.skill as Record<string, unknown>;
  const testNode = workspace.nodes.find((node) => objectString(node, "id", "") === parsed.data.nodeId)
    ?? workspace.nodes.find((node) => objectString(node, "skillId", "") === objectString(skill, "id", ""))
    ?? {
      id: `skill-test-${objectString(skill, "id", req.params.id)}`,
      title: `Test ${objectString(skill, "title", "Skill")}`,
      type: objectString(skill, "nodeType", "skill_execute"),
      body: parsed.data.prompt || workspace.prompt,
      skillId: objectString(skill, "id", req.params.id),
      status: "ready"
    };
  const output = objectString(skill, "output", workGraphDefaultOutput(workspace, testNode));
  const routingDecision = buildWorkGraphModelRoutingDecision(workspace, testNode, output);
  const brandId = resolveWorkGraphBrandId(workspace.activeBrandId, `${workspace.prompt}\n${parsed.data.prompt ?? ""}`);
  const brandPayload = workGraphBrandPayload(findBrand(brandId), brandId);
  const materialIds = objectStringArray(testNode, "materialIds").length ? objectStringArray(testNode, "materialIds") : workspace.selectedIds;
  const selectedAssets = materialIds.map((id) => {
    const dbAsset = db.assets.find((asset) => asset.id === id);
    if (dbAsset) return workGraphAssetPayload(dbAsset);
    return workspace.materials.find((item) => objectString(item, "id", "") === id) ?? { id };
  });
  const runtime = runWorkGraphSkill({
    mode: "node",
    prompt: parsed.data.prompt?.trim() || workspace.prompt,
    output,
    node: {
      id: objectString(testNode, "id", "skill-test"),
      title: objectString(testNode, "title", "Skill Test"),
      type: objectString(testNode, "type", "skill_execute"),
      body: objectString(testNode, "body", "")
    },
    workflowId: objectString(workspace.workflow, "id", "workflow-active"),
    skill: {
      id: objectString(skill, "id", req.params.id),
      title: objectString(skill, "title", "Skill"),
      command: objectString(skill, "command", ""),
      output,
      skillMdPath: objectString(skill, "skillMdPath", ""),
      runtime: objectString(skill, "runtime", "pi-skill")
    },
    modelPolicy: routingDecision,
    brand: {
      id: brandPayload.id,
      name: brandPayload.name,
      context: brandPayload.context
    },
    assets: selectedAssets.map((asset) => ({
      id: objectString(asset, "id", ""),
      title: objectString(asset, "title", ""),
      kind: objectString(asset, "kind", objectString(asset, "type", "")),
      type: objectString(asset, "type", ""),
      token: objectString(asset, "token", ""),
      referencePath: objectString(asset, "referencePath", ""),
      tags: objectStringArray(asset, "tags")
    })),
    materialIds,
    now
  });
  const testId = `skill-test-${Date.now().toString(36)}-${nanoid(6)}`;
  const updatedSkill = withWorkGraphSkillEvolution(skill, {
    type: "test",
    status: runtime.status,
    testId,
    nodeId: objectString(testNode, "id", ""),
    workflowId: objectString(workspace.workflow, "id", "workflow-active"),
    modelId: routingDecision.selectedModelId,
    output
  });
  await appendWorkGraphSkillLog(updatedSkill, "skill-tested", {
    testId,
    status: runtime.status,
    routingDecision,
    logs: runtime.logs,
    previewLength: runtime.preview.length
  });
  const nextWorkspace: WorkGraphOsWorkspace = {
    ...workspace,
    skills: workspace.skills.map((item) => objectString(item, "id", "") === objectString(updatedSkill, "id", "") ? updatedSkill : item),
    executionLog: [
      ...runtime.logs.map((entry, index) => ({
        id: `${testId}-runtime-${index + 1}`,
        executionId: testId,
        step: entry.step,
        status: "done",
        nodeId: objectString(testNode, "id", ""),
        workflowId: objectString(workspace.workflow, "id", "workflow-active"),
        message: entry.message,
        payload: entry.payload,
        createdAt: now()
      })),
      ...(workspace.executionLog ?? [])
    ].slice(0, 500),
    updatedAt: now()
  };
  const syncedWorkspace = await writeWorkGraphOsWorkspace(nextWorkspace);
  const objectIndex = buildWorkGraphOsObjectIndex(syncedWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(syncedWorkspace, "manual");
  res.json({
    source: "workgraph-skill-runtime",
    status: runtime.status,
    testId,
    skill: updatedSkill,
    preview: runtime.preview,
    logs: runtime.logs,
    routingDecision,
    workspace: syncedWorkspace,
    objectIndex,
    historyEntry
  });
});

app.post("/workgraph-os/skills", async (req, res) => {
  const parsed = workGraphOsSkillInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid WorkGraph OS skill payload" });
  const workspace = await readWorkGraphOsWorkspace();
  if (!workspace) return res.status(409).json({ message: "WorkGraph OS workspace is empty; save a workspace before creating skills" });
  const skill = workGraphNormalizeSkill({
    ...parsed.data,
    id: `skill-${Date.now().toString(36)}-${nanoid(6)}`,
    source: "workgraph-skill-store",
    createdAt: now()
  });
  await ensureWorkGraphSkillFiles(skill);
  const nextWorkspace: WorkGraphOsWorkspace = {
    ...workspace,
    skills: [skill, ...workspace.skills],
    updatedAt: now()
  };
  await writeWorkGraphOsWorkspace(nextWorkspace);
  const objectIndex = buildWorkGraphOsObjectIndex(nextWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(nextWorkspace, "manual");
  res.status(201).json({
    source: "workgraph-skill-store",
    skill,
    workspace: nextWorkspace,
    objectIndex,
    historyEntry
  });
});

app.post("/workgraph-os/plan", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  if (!workspace) return res.status(409).json({ message: "WorkGraph OS workspace is empty; save a workspace before planning workflows" });
  const parsed = workGraphOsPlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid WorkGraph OS planner payload" });
  const planned = buildWorkGraphOsPlan(workspace, parsed.data, await workGraphSkillCatalogWithFs(workspace));
  await Promise.all(planned.workspace.skills.map((skill, index) => ensureWorkGraphSkillFiles(workGraphNormalizeSkill(skill, index), index)));
  const syncedWorkspace = await writeWorkGraphOsWorkspace(planned.workspace);
  const objectIndex = buildWorkGraphOsObjectIndex(syncedWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(syncedWorkspace, "manual");
  res.json({
    source: "workgraph-workflow-planner",
    plan: planned.plan,
    workspace: syncedWorkspace,
    routingDecision: planned.routingDecision,
    memory: planned.memory,
    objectIndex,
    historyEntry
  });
});

app.put("/workgraph-os/workspace", async (req, res) => {
  const parsed = workGraphOsWorkspaceSchema.safeParse({
    ...req.body,
    updatedAt: now()
  });
  if (!parsed.success) return res.status(400).json({ message: "Invalid WorkGraph OS workspace payload" });
  const syncedWorkspace = await writeWorkGraphOsWorkspace(parsed.data);
  const objectIndex = buildWorkGraphOsObjectIndex(syncedWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(syncedWorkspace);
  res.json({
    storage: {
      mode: "filesystem-json",
      file: workGraphOsDataFile,
      exists: true
    },
    workspace: syncedWorkspace,
    objectIndex,
    historyEntry
  });
});

app.post("/workgraph-os/feedback", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  if (!workspace) return res.status(409).json({ message: "WorkGraph OS workspace is empty; save a workspace before recording feedback" });
  const parsed = workGraphOsFeedbackSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid WorkGraph OS feedback payload" });
  const input = parsed.data;
  const createdAt = now();
  const feedback = {
    id: input.id ?? `fb-${Date.now().toString(36)}-${nanoid(6)}`,
    targetId: input.targetId,
    targetType: input.targetType,
    rating: input.rating,
    action: input.action ?? (input.rating === "accepted" ? "reuse" : input.rating === "failed" ? "avoid" : "revise"),
    note: input.note.trim(),
    memoryId: input.memoryId ?? `mem-${Date.now().toString(36)}-${nanoid(6)}`,
    sourceResultId: input.sourceResultId,
    sourceWorkflowId: input.sourceWorkflowId ?? objectString(workspace.workflow, "id", "workflow-active"),
    brandId: input.brandId ?? workspace.activeBrandId,
    createdAt
  };
  const brand = findBrand(feedback.brandId) ?? inferBrandFromPrompt(`${workspace.prompt}\n${feedback.note}`);
  const learning = workGraphFeedbackBrandLearning(feedback.note, feedback.rating);
  const appliedLearning = {
    brandId: brand?.id ?? "",
    brandForbiddenWords: [] as string[],
    brandSceneKeywords: [] as string[],
    modelPolicyId: "",
    modelPolicyStrategy: "",
    assetIds: [] as string[],
    assetTags: [] as string[],
    memoryReusable: learning.memoryReusable
  };
  if (brand) {
    if (learning.forbiddenRule) {
      brand.forbiddenWords = uniqueAppend(brand.forbiddenWords, learning.forbiddenRule);
      appliedLearning.brandForbiddenWords = brand.forbiddenWords;
    }
    if (learning.sceneRule) {
      brand.sceneKeywords = uniqueAppend(brand.sceneKeywords, learning.sceneRule);
      appliedLearning.brandSceneKeywords = brand.sceneKeywords;
    }
    brand.updatedAt = createdAt;
    await persistDb();
    await syncBrandRecords({ brandDir: workGraphOsBrandDataDir }, [workGraphBrandPayload(brand, brand.id)]);
  }
  const targetResult = workspace.results.find((item) => objectString(item, "id", "") === feedback.targetId)
    ?? workspace.results.find((item) => objectString(item, "id", "") === feedback.sourceResultId)
    ?? workspace.results[0];
  const feedbackMaterialIds = Array.from(new Set([
    ...(feedback.targetType === "asset" ? [feedback.targetId] : []),
    ...objectStringArray(targetResult, "materialIds"),
    ...objectStringArray((workspace.promptRecords ?? []).find((item) => objectString(item, "id", "") === objectString(targetResult, "promptRecordId", "")), "materialIds")
  ].filter(Boolean)));
  const feedbackAssetTags = [
    `feedback-${feedback.action}`,
    feedback.rating === "accepted" ? "feedback-reuse" : "feedback-avoid",
    brand?.id ? `brand-${brand.id}` : ""
  ].filter(Boolean);
  const targetRouting = objectField(targetResult, "routingDecision");
  const targetPromptRecord = (workspace.promptRecords ?? []).find((item) => objectString(item, "id", "") === objectString(targetResult, "promptRecordId", ""));
  const modelId = objectString(targetRouting, "selectedModelId", "") || objectString(targetResult, "modelId", "") || objectString(targetPromptRecord, "modelId", "") || workspace.activeModelId;
  const strategy = objectString(targetRouting, "strategy", "") || objectString(targetResult, "modelStrategy", "") || objectString(targetPromptRecord, "modelStrategy", "") || "balanced";
  const modelPolicy = {
    id: `model-policy-${Date.now().toString(36)}-${nanoid(6)}`,
    type: "model_policy",
    targetType: feedback.targetType,
    targetId: feedback.targetId,
    feedbackId: feedback.id,
    action: feedback.action,
    rating: feedback.rating,
    strategy,
    provider: objectString(targetRouting, "selectedCapability", "custom"),
    modelId,
    fallbackModelIds: objectStringArray(targetRouting, "fallbackModelIds"),
    note: feedback.note,
    avoid: feedback.action === "avoid" || feedback.rating === "failed" || feedback.rating === "needs_revision",
    updatedAt: createdAt
  };
  appliedLearning.modelPolicyId = modelPolicy.id;
  appliedLearning.modelPolicyStrategy = strategy;
  const updatedAssets = feedbackMaterialIds.map((assetId) => {
    const asset = db.assets.find((item) => item.id === assetId);
    if (!asset) return null;
    asset.meta = mergeWorkGraphAssetMetaTags(asset.meta, feedbackAssetTags);
    return asset;
  }).filter(Boolean) as Asset[];
  if (updatedAssets.length) {
    appliedLearning.assetIds = updatedAssets.map((asset) => asset.id);
    appliedLearning.assetTags = feedbackAssetTags;
    await persistDb();
    await Promise.all(updatedAssets.map((asset) => appendWorkGraphAssetUsage(workGraphAssetPayload(asset), {
      type: "feedback",
      feedbackId: feedback.id,
      targetType: feedback.targetType,
      targetId: feedback.targetId,
      rating: feedback.rating,
      action: feedback.action,
      note: feedback.note,
      tags: feedbackAssetTags
    })));
  }
  const memory = buildWorkGraphFeedbackMemory({
    memoryId: feedback.memoryId,
    feedbackId: feedback.id,
    targetType: feedback.targetType,
    targetId: feedback.targetId,
    rating: feedback.rating,
    action: feedback.action,
    note: feedback.note,
    brandId: brand?.id ?? feedback.brandId,
    createdAt,
    learning
  });
  const nextWorkspace = {
    ...workspace,
    materials: workspace.materials.map((item) => {
      const asset = updatedAssets.find((candidate) => candidate.id === objectString(item, "id", ""));
      return asset ? workGraphAssetPayload(asset) : item;
    }),
    results: workspace.results.map((item) => {
      const id = objectString(item, "id", "");
      if (id !== feedback.targetId && id !== feedback.sourceResultId) return item;
      const currentTrace = objectField(item, "trace");
      const currentFeedbackIds = objectStringArray(item, "feedbackIds").length
        ? objectStringArray(item, "feedbackIds")
        : objectStringArray(currentTrace, "feedbackIds");
      return {
        ...(item as Record<string, unknown>),
        feedbackIds: uniqueAppend(currentFeedbackIds, feedback.id),
        trace: {
          ...(currentTrace && typeof currentTrace === "object" ? currentTrace as Record<string, unknown> : {}),
          feedbackIds: uniqueAppend(currentFeedbackIds, feedback.id)
        },
        updatedAt: createdAt
      };
    }),
    modelPolicies: [modelPolicy, ...(workspace.modelPolicies ?? []).filter((item) => objectString(item, "id", "") !== modelPolicy.id)].slice(0, 200),
    feedback: [feedback, ...workspace.feedback.filter((item) => objectString(item, "id", "") !== feedback.id)],
    memories: [memory, ...workspace.memories.filter((item) => objectString(item, "id", "") !== memory.id)],
    updatedAt: createdAt
  };
  const syncedWorkspace = await writeWorkGraphOsWorkspace(nextWorkspace);
  const objectIndex = buildWorkGraphOsObjectIndex(syncedWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(syncedWorkspace, "manual");
  res.status(201).json({
    source: "workgraph-feedback-store",
    feedback,
    memory,
    appliedLearning,
    brand: brand ? workGraphBrandPayload(brand, brand.id) : null,
    workspace: syncedWorkspace,
    objectIndex,
    historyEntry
  });
});

app.post("/workgraph-os/run", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  if (!workspace) return res.status(409).json({ message: "WorkGraph OS workspace is empty; save a workspace before running nodes" });
  const parsed = workGraphOsRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid WorkGraph OS run payload" });
  const run = buildWorkGraphOsExecution(workspace, parsed.data);
  let bridge: Awaited<ReturnType<typeof applyWorkGraphPiBridge>>;
  try {
    bridge = await applyWorkGraphPiBridge(run, parsed.data.bridge);
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: number }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 502;
    return res.status(statusCode).json({ message: (error as Error).message });
  }
  const artifacts = await persistWorkGraphRunArtifacts(run);
  const piSession = await writeWorkGraphPiSession(run, artifacts);
  await Promise.all((run.result as Record<string, unknown>).materialIds instanceof Array
    ? ((run.result as Record<string, unknown>).materialIds as unknown[]).map((assetId) => {
        const asset = run.workspace.materials.find((item) => objectString(item, "id", "") === String(assetId));
        return asset ? appendWorkGraphAssetUsage(asset, {
          type: "node-run",
          executionId: run.execution.id,
          workflowId: run.execution.workflowId,
          nodeId: run.execution.nodeId,
          resultId: run.execution.resultId,
          skillId: run.execution.skillId,
          modelId: run.execution.modelId
        }) : Promise.resolve();
      })
    : []);
  const skillEvolution = await applyWorkGraphSkillEvolutionOutcome(run);
  const variantSet = buildWorkGraphResultVariants(artifacts.result as Record<string, unknown>, parsed.data.variants ?? 1, run.routingDecision);
  const workspaceWithArtifacts = {
    ...run.workspace,
    results: [
      ...variantSet.variants.slice(1),
      ...run.workspace.results.map((item) => objectString(item, "id", "") === run.execution.resultId ? variantSet.variants[0] : item)
    ]
  };
  const syncedWorkspace = await writeWorkGraphOsWorkspace(workspaceWithArtifacts);
  const objectIndex = buildWorkGraphOsObjectIndex(syncedWorkspace);
  const historyEntry = await appendWorkGraphOsHistory(syncedWorkspace, "manual");
  res.json({
    execution: run.execution,
    workspace: syncedWorkspace,
    job: run.job,
    result: variantSet.variants[0],
    variantGroupId: variantSet.variantGroupId,
    variants: variantSet.variants,
    memory: run.memory,
    promptRecord: run.promptRecord,
    routingDecision: run.routingDecision,
    executionLog: run.executionLog,
    piSession,
    bridge: { ...run.execution.bridge, outcome: bridge.mode, simulated: run.execution.simulated },
    skillEvolution: skillEvolution.decision,
    repairTask: skillEvolution.repairTask,
    artifacts: artifacts.artifactPaths,
    objectIndex,
    historyEntry
  });
});

app.get("/workgraph-os/pi/status", async (_req, res) => {
  const config = workGraphPiWebConfig();
  const probe = await probePiWebBridge(config);
  res.json({
    source: "pi-web-bridge",
    baseUrl: config.baseUrl,
    mode: config.mode,
    timeoutMs: config.timeoutMs,
    enabled: probe.enabled,
    reachable: probe.reachable,
    version: probe.version,
    reason: probe.reason
  });
});

app.get("/workgraph-os/pi/sessions", async (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const sessions = await listPiSessionRecords(workGraphPiAdapterConfig(), Number.isFinite(limit) ? limit : 20);
  res.json({
    source: "pi-adapter",
    piDir: workGraphOsPiDir,
    sessions
  });
});

app.get("/workgraph-os/pi/sessions/:id", async (req, res) => {
  try {
    const session = await readPiSessionRecord(workGraphPiAdapterConfig(), req.params.id);
    res.json({
      source: "pi-adapter",
      piDir: workGraphOsPiDir,
      session
    });
  } catch {
    res.status(404).json({ message: "Pi session not found" });
  }
});

app.get("/workgraph-os/logs", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
  const executionId = typeof req.query.executionId === "string" ? req.query.executionId : "";
  const limit = Math.min(Number.parseInt(typeof req.query.limit === "string" ? req.query.limit : "50", 10) || 50, 200);
  const logs = (workspace?.executionLog ?? [])
    .filter((entry) => !nodeId || objectString(entry, "nodeId", "") === nodeId)
    .filter((entry) => !executionId || objectString(entry, "executionId", "") === executionId)
    .slice(0, limit);
  res.json({
    source: "workgraph-log-store",
    logs,
    count: logs.length
  });
});

app.get("/workgraph-os/objects", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  // Prefer the SQLite index when reads are enabled; fall back to the JSON index.
  const fromSqlite = readWorkGraphOsObjectIndexFromSqlite();
  const { counts, objects } = fromSqlite ?? buildWorkGraphOsObjectIndex(workspace);
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const filtered = objects.filter((object) => {
    if (type && object.type !== type) return false;
    if (!query) return true;
    return [object.id, object.type, object.title, object.summary].join(" ").toLowerCase().includes(query);
  });
  res.json({
    storage: fromSqlite
      ? { mode: "sqlite-index", file: workGraphOsDbFile, exists: true }
      : { mode: "filesystem-json-index", file: workGraphOsDataFile, exists: Boolean(workspace) },
    counts,
    objects: filtered
  });
});

app.get("/workgraph-os/memories", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const targetType = typeof req.query.targetType === "string" ? req.query.targetType.trim().toLowerCase() : "";
  const reusableOnly = req.query.reusable === "true";
  const limit = Math.min(Number.parseInt(typeof req.query.limit === "string" ? req.query.limit : "10", 10) || 10, 50);
  const memories = (workspace?.memories ?? [])
    .filter((memory) => !reusableOnly || objectField(memory, "reusable") === true)
    .filter((memory) => !targetType || objectString(memory, "targetType", "").toLowerCase() === targetType)
    .map((memory, index) => {
      const searchable = [
        objectString(memory, "id", ""),
        objectString(memory, "title", ""),
        objectString(memory, "body", ""),
        objectString(memory, "source", ""),
        objectString(memory, "sourceType", ""),
        objectString(memory, "targetType", ""),
        objectString(memory, "targetId", "")
      ].join(" ").toLowerCase();
      const score = query
        ? query.split(/\s+/).filter(Boolean).reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0)
        : 1;
      return { memory, index, score };
    })
    .filter((item) => !query || item.score > 0)
    .sort((left, right) => {
      const confidenceDelta = Number(objectField(right.memory, "confidence") ?? 0) - Number(objectField(left.memory, "confidence") ?? 0);
      return right.score - left.score || confidenceDelta || left.index - right.index;
    })
    .slice(0, limit)
    .map((item) => item.memory);
  res.json({
    source: "workgraph-memory-store",
    memories,
    count: memories.length
  });
});

app.get("/workgraph-os/objects/:type/:id", async (req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const { objects } = buildWorkGraphOsObjectIndex(workspace);
  const id = `${req.params.type}:${req.params.id}`;
  const object = objects.find((item) => item.id === id);
  if (!object) return res.status(404).json({ message: "WorkGraph OS object not found" });
  res.json(object);
});

app.get("/workgraph-os/sqlite/schema", async (_req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const history = await readWorkGraphOsHistory();
  const exportPayload = buildWorkGraphOsSqliteExport(workspace, history);
  await syncWorkGraphOsSqlite(exportPayload);
  res.json({
    ...workGraphOsSqliteReadiness(exportPayload),
    schema: exportPayload.tables.map((table) => ({ name: table.name, createSql: table.createSql }))
  });
});

app.get("/workgraph-os/sqlite/export", async (_req, res) => {
  const workspace = await readWorkGraphOsWorkspace();
  const history = await readWorkGraphOsHistory();
  const exportPayload = buildWorkGraphOsSqliteExport(workspace, history);
  await syncWorkGraphOsSqlite(exportPayload);
  res.json({
    ...exportPayload,
    readiness: workGraphOsSqliteReadiness(exportPayload)
  });
});

app.get("/workgraph-os/snapshots", async (_req, res) => {
  let manifest: unknown = null;
  try {
    manifest = JSON.parse(await readFile(workGraphOsSnapshotFile, "utf8"));
  } catch {
    manifest = null;
  }
  const directories = manifest && typeof manifest === "object" ? objectField(manifest, "directories") : undefined;
  const directoryEntries = directories && typeof directories === "object" ? Object.entries(directories as Record<string, unknown>) : [];
  const snapshots = await Promise.all(directoryEntries.map(async ([type, dir]) => {
    if (typeof dir !== "string") return { type, dir: "", exists: false, indexes: [], files: [] };
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return {
        type,
        dir,
        exists: true,
        indexes: entries.filter((entry) => entry.isFile() && entry.name.startsWith("_") && entry.name.endsWith(".json")).map((entry) => entry.name),
        files: entries.filter((entry) => entry.isFile() && !entry.name.startsWith("_") && entry.name.endsWith(".json")).slice(0, 20).map((entry) => entry.name)
      };
    } catch {
      return { type, dir, exists: false, indexes: [], files: [] };
    }
  }));
  res.json({
    source: "workgraph-object-snapshot-store",
    storage: {
      mode: "filesystem-json-snapshots",
      file: workGraphOsSnapshotFile,
      exists: Boolean(manifest)
    },
    manifest,
    snapshots
  });
});

app.get("/workgraph-os/history", async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20) || 20));
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const history = await readWorkGraphOsHistory();
  const entries = history
    .filter((entry) => !type || entry.counts[type] || entry.objects.some((object) => object.type === type))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      reason: entry.reason,
      prompt: entry.prompt,
      counts: entry.counts,
      objectIds: entry.objectIds
    }));
  res.json({
    storage: {
      mode: "filesystem-json-history",
      file: workGraphOsHistoryFile,
      exists: history.length > 0
    },
    entries
  });
});

app.get("/workgraph-os/history/:id", async (req, res) => {
  const history = await readWorkGraphOsHistory();
  const entry = history.find((item) => item.id === req.params.id);
  if (!entry) return res.status(404).json({ message: "WorkGraph OS history entry not found" });
  res.json(entry);
});

// Version history for any object (material/skill/workflow/result/node/...) derived
// from history snapshots. Returns the ordered states the object passed through,
// collapsing consecutive identical snapshots so only real changes are versions.
app.get("/workgraph-os/versions/:type/:id", async (req, res) => {
  const history = await readWorkGraphOsHistory();
  const ordered = [...history].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const versions: Array<{ version: number; historyId: string; createdAt: string; reason: string; object: unknown }> = [];
  let lastSignature = "";
  for (const entry of ordered) {
    // Match on the object's real payload id (the index id is positional, e.g.
    // "result-0", so we also accept the stable id carried in the payload).
    const match = (entry.objects ?? []).find((object) => object.type === req.params.type
      && (object.id === req.params.id || objectString(object.payload, "id", "") === req.params.id));
    if (!match) continue;
    const signature = JSON.stringify(match.payload ?? match);
    if (signature === lastSignature) continue;
    lastSignature = signature;
    versions.push({ version: versions.length + 1, historyId: entry.id, createdAt: entry.createdAt, reason: entry.reason, object: match });
  }
  res.json({
    source: "workgraph-version-history",
    type: req.params.type,
    id: req.params.id,
    versionCount: versions.length,
    versions: versions.reverse()
  });
});

app.get("/brands", (_req, res) => {
  res.json(db.brands);
});

app.get("/entities", (_req, res) => {
  res.json(db.brands.map((brand) => brandToEntity(brand)));
});

app.post("/brands", async (req, res) => {
  const input = z.object({
    name: z.string().min(1),
    logoText: z.string().min(1).max(8).default("XM"),
    primaryColor: z.string().default("#111827"),
    accentColor: z.string().default("#0ea5e9"),
    tone: z.string().default("clean commercial visuals"),
    market: z.string().default("ecommerce brand"),
    slogan: z.string().optional(),
    industry: z.string().optional(),
    targetAudience: z.string().optional(),
    brandStory: z.string().optional(),
    ipName: z.string().optional(),
    ipDescription: z.string().optional(),
    logoUsage: z.string().optional(),
    visualStyle: z.string().optional(),
    sceneKeywords: z.array(z.string()).optional(),
    forbiddenWords: z.array(z.string()).optional(),
    assetRoles: z.array(assetRoleSchema).optional(),
    autoInject: z.boolean().optional()
  }).parse(req.body);
  const brand: Brand = defaultBrandDetails({ id: nanoid(8), active: false, updatedAt: now(), ...input });
  db.brands.push(brand);
  db.assets.unshift(createAsset(`${brand.name} Logo`, "logo", brand.id, brand.primaryColor, `${brand.logoText} · transparent`));
  await persistDb();
  res.status(201).json(brand);
});

app.patch("/brands/:id", async (req, res) => {
  const brand = db.brands.find((item) => item.id === req.params.id);
  if (!brand) return res.status(404).json({ message: "Brand not found" });
  Object.assign(brand, brandDetailSchema.parse(req.body), { updatedAt: now() });
  if (brand.active) {
    brand.archived = false;
    db.brands.forEach((item) => { if (item.id !== brand.id) item.active = false; });
  }
  await persistDb();
  res.json(brand);
});

app.patch("/brands/:id/archive", async (req, res) => {
  const brand = db.brands.find((item) => item.id === req.params.id);
  if (!brand) return res.status(404).json({ message: "Brand not found" });
  const input = z.object({ archived: z.boolean().default(true) }).parse(req.body ?? {});
  brand.archived = input.archived;
  if (brand.archived) brand.active = false;
  brand.updatedAt = now();
  if (!db.brands.some((item) => item.active && !item.archived)) {
    const fallback = db.brands.find((item) => !item.archived);
    if (fallback) fallback.active = true;
  }
  await persistDb();
  res.json(brand);
});

app.delete("/brands/:id", async (req, res) => {
  const index = db.brands.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "Brand not found" });
  if (db.brands.length <= 1) return res.status(409).json({ message: "Cannot delete the last brand" });
  const [brand] = db.brands.splice(index, 1);
  const removedAssets = db.assets.filter((asset) => asset.brandId === brand.id);
  db.assets = db.assets.filter((asset) => asset.brandId !== brand.id);
  const removedImageUrls = new Set(removedAssets.map((asset) => asset.imageUrl).filter(Boolean));
  const removedAssetRefPrefixes = new Set(removedAssets.map((asset) => `asset_${asset.id}`));
  for (const frame of db.frames) {
    if (frame.brandId === brand.id) {
      frame.brandId = "";
      frame.brandName = "";
      frame.brandInjected = false;
      frame.brandContext = "";
      frame.updatedAt = now();
    }
    frame.workflowNodes = frame.workflowNodes.map((node) => {
      if (!node.refs?.length) return node;
      return {
        ...node,
        refs: node.refs.filter((reference) => {
          const removedAssetRef = Array.from(removedAssetRefPrefixes).some((prefix) => reference.id === prefix || reference.id.startsWith(`${prefix}_`));
          return !removedAssetRef && (!reference.imageUrl || !removedImageUrls.has(reference.imageUrl));
        })
      };
    });
  }
  if (!db.brands.some((item) => item.active && !item.archived)) {
    const fallback = db.brands.find((item) => !item.archived) ?? db.brands[0];
    if (fallback) fallback.active = true;
  }
  await persistDb();
  res.json({ ok: true, id: brand.id, removedAssets: removedAssets.length });
});

app.post("/assets/upload", express.raw({ type: ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/octet-stream"], limit: "25mb" }), async (req, res) => {
  const input = z.object({
    assetId: z.string().optional(),
    title: z.string().min(1),
    type: z.enum(["upload", "logo", "product", "model", "generated_image", "generated_video"]).default("upload"),
    brandId: z.string().optional(),
    color: z.string().default("#e2e8f0"),
    meta: z.string().default("manual asset")
  }).parse(req.query);
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!bytes.length) return res.status(400).json({ message: "Uploaded image is empty" });
  const imageUrl = await storeAssetImageBuffer(bytes, input.title);
  if (input.assetId) {
    const existing = db.assets.find((item) => item.id === input.assetId);
    if (!existing) return res.status(404).json({ message: "Asset not found" });
    Object.assign(existing, {
      title: input.title,
      type: input.type,
      brandId: input.brandId ?? existing.brandId,
      color: input.color,
      meta: input.meta,
      imageUrl
    });
    await persistDb();
    return res.json(existing);
  }
  const asset = createAsset(input.title, input.type, input.brandId ?? activeBrand().id, input.color, input.meta, imageUrl);
  db.assets.unshift(asset);
  await persistDb();
  res.status(201).json(asset);
});

app.get("/assets", (_req, res) => {
  res.json(db.assets);
});

app.post("/assets", async (req, res) => {
  const input = z.object({
    title: z.string().min(1),
    type: z.enum(["upload", "logo", "product", "model", "generated_image", "generated_video"]).default("upload"),
    brandId: z.string().optional(),
    color: z.string().default("#e2e8f0"),
    meta: z.string().default("manual asset"),
    imageUrl: z.string().optional()
  }).parse(req.body);
  const imageUrl = await materializeAssetImageUrl(input.imageUrl, input.title);
  const asset = createAsset(input.title, input.type, input.brandId ?? activeBrand().id, input.color, input.meta, imageUrl);
  db.assets.unshift(asset);
  await persistDb();
  res.status(201).json(asset);
});

app.patch("/assets/:id", async (req, res) => {
  const asset = db.assets.find((item) => item.id === req.params.id);
  if (!asset) return res.status(404).json({ message: "Asset not found" });
  const input = z.object({
    title: z.string().min(1).optional(),
    type: z.enum(["upload", "logo", "product", "model", "generated_image", "generated_video"]).optional(),
    color: z.string().optional(),
    meta: z.string().optional(),
    imageUrl: z.string().optional()
  }).parse(req.body);
  const imageUrl = input.imageUrl === undefined ? undefined : await materializeAssetImageUrl(input.imageUrl, input.title ?? asset.title);
  Object.assign(asset, { ...input, ...(imageUrl !== undefined ? { imageUrl } : {}) });
  await persistDb();
  res.json(asset);
});

app.delete("/assets/:id", async (req, res) => {
  const index = db.assets.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "Asset not found" });
  const [asset] = db.assets.splice(index, 1);
  const assetRefPrefix = `asset_${asset.id}`;
  for (const frame of db.frames) {
    frame.workflowNodes = frame.workflowNodes.map((node) => {
      if (!node.refs?.length) return node;
      return {
        ...node,
        refs: node.refs.filter((reference) => (
          reference.id !== assetRefPrefix
          && !reference.id.startsWith(`${assetRefPrefix}_`)
          && (!asset.imageUrl || reference.imageUrl !== asset.imageUrl)
        ))
      };
    });
  }
  await persistDb();
  res.json({ ok: true, id: asset.id });
});

app.get("/templates", (_req, res) => {
  res.json(templates);
});

app.get("/models", (_req, res) => {
  res.json(publicModels());
});

app.get("/ai/status", (_req, res) => {
  res.json(aiStatus());
});

app.get("/ai/diagnostics", async (_req, res) => {
  res.json(await imageSkillDiagnostics());
});

app.get("/ai/models/diagnostics", (_req, res) => {
  res.json({ models: modelDiagnostics() });
});

app.post("/ai/models/probe", async (req, res) => {
  const input = z.object({
    modelId: z.string().min(1),
    prompt: z.string().optional()
  }).parse(req.body);
  try {
    res.json(await probeModel(input.modelId, input.prompt));
  } catch (error) {
    res.status(502).json({
      ok: false,
      modelId: input.modelId,
      message: error instanceof Error ? error.message : "model probe failed"
    });
  }
});

app.post("/ai/transform-text", async (req, res) => {
  const input = z.object({
    text: z.string().min(1),
    action: z.enum(["translate", "optimize"]),
    targetLanguage: z.string().default("English"),
    brandId: z.string().nullable().optional(),
    model: z.string().optional(),
    outputTarget: z.enum(["jpg", "png", "poster", "pdf", "mp4", "kit"]).default("jpg"),
    orientation: z.enum(["square", "portrait", "landscape"]).default("landscape"),
    contentLanguage: contentLanguageSchema.default("zh-en"),
    nodeType: z.enum(["image", "brand", "prompt", "model", "output", "reference", "process", "script", "video", "compose", "audio"]).optional()
  }).parse(req.body);
  const brand = input.brandId === null ? undefined : findBrand(input.brandId);
  const resolved = resolvePromptAssets(input.text, brand);
  if (input.action === "optimize") {
    const text = input.nodeType
      ? optimizeNodePrompt(input.text, brand, input.nodeType, input.outputTarget, input.orientation, { contentLanguage: input.contentLanguage })
      : optimizeWorkflowPrompt(input.text, brand, input.outputTarget, input.orientation, { contentLanguage: input.contentLanguage });
    return res.json({ text, action: input.action, model: "cal-optimizer", resolved: resolvePromptAssets(text, brand) });
  }
  const instruction = input.action === "translate"
    ? `把用户内容翻译成 ${input.targetLanguage}。保留 CAL 语法 token，例如 @设计师、/生成海报、$logo、$copy.slogan、%高级感、-> 海报，不要改写这些 token。`
    : "优化为可直接执行的 CAL 1.0 画布提示词。保留用户已写的 CAL token，补齐必要的 @智能体、/命令、$资源、%标签、参数和输出目标，保持简洁可控。";
  const fallback = input.action === "translate"
    ? `${input.text}\n\nTranslation unavailable; keep original CAL prompt.`
    : resolved.prompt;
  let text = fallback;
  try {
    const remote = await runTextGeneration(
      [
        instruction,
        `当前品牌: ${brand ? brand.name : "无品牌"}`,
        `品牌风格: ${brand ? brand.visualStyle : "无品牌，仅使用用户提示词和显式 $ 跨品牌引用"}`,
        `资源解析: ${JSON.stringify({ imageReferences: resolved.imageReferences.map((item) => item.description), textReferences: resolved.textReferences, lockedTexts: resolved.lockedTexts, tags: resolved.tags, params: resolved.params })}`,
        contentLanguageInstruction({ contentLanguage: input.contentLanguage }, "text"),
        `用户内容:\n${input.text}`
      ].join("\n"),
      input.model
    );
    if (remote) text = remote.trim();
  } catch (error) {
    text = `${fallback}\n\n远程文本模型降级: ${error instanceof Error ? error.message.slice(0, 160) : "unavailable"}`;
  }
  res.json({ text, action: input.action, model: input.model ?? serviceConfig("text").model, resolved });
});

app.post("/ai/resolve-references", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional()
  }).parse(req.body);
  const brand = input.brandId === null ? undefined : findBrand(input.brandId);
  const resolved = resolvePromptAssets(input.prompt, brand);
  res.json({
    ...resolved,
    brandId: brand?.id ?? "",
    brandKey: brand ? brandKey(brand) : "",
    finalPrompt: buildFinalPrompt(input.prompt, brand ? buildBrandContext(brand) : "", Boolean(brand && (input.brandInject ?? true)), brand)
  });
});

app.post("/ai/resolve-graph", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional()
  }).parse(req.body);
  res.json(buildResolverGraph(input.prompt, {
    brandId: input.brandId,
    brandInject: input.brandInject
  }));
});

app.post("/ai/ir", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);
  const ir = buildCreativeIR(input.prompt, {
    brandId: input.brandId,
    brandInject: input.brandInject,
    settings: input.settings
  });
  res.json(ir);
});

app.post("/ai/plan", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);
  const ir = buildCreativeIR(input.prompt, {
    brandId: input.brandId,
    brandInject: input.brandInject,
    settings: input.settings
  });
  res.json(buildPlannerPlanFromCreativeIR(ir));
});

app.post("/ai/canvas-plan", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);
  const ir = buildCreativeIR(input.prompt, {
    brandId: input.brandId,
    brandInject: input.brandInject,
    settings: input.settings
  });
  const plan = buildPlannerPlanFromCreativeIR(ir);
  res.json(buildCanvasPlanGraphFromPlan(plan));
});

app.post("/ai/workflow-bridge", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);
  const brand = input.brandId === null ? undefined : input.brandId ? db.brands.find((item) => item.id === input.brandId) : inferBrandFromPrompt(input.prompt);
  const settings = defaultSettings(input.prompt, input.settings);
  settings.brandInject = Boolean(brand && (input.brandInject ?? (typeof input.settings?.brandInject === "boolean" ? settings.brandInject : promptRequestsWholeBrand(input.prompt, brand))));
  const bridge = buildWorkflowBridge(input.prompt, brand, settings, settings.brandInject);
  const model = models[0];
  res.json({
    ...bridge,
    workflowNodes: buildWorkflowNodes(input.prompt, brand, model, settings, brand ? buildBrandContext(brand) : "", settings.brandInject, bridge)
  });
});

app.get("/canvas/frames", (_req, res) => {
  res.json(db.frames);
});

app.post("/canvas/frames", async (req, res) => {
  const input = z.object({
    brandId: z.string().nullable().optional(),
    title: z.string().optional()
  }).parse(req.body);
  const frame = createEmptyFrame(input.brandId ?? undefined);
  if (input.brandId === null) {
    frame.brandId = "";
    frame.brandName = "无品牌";
  }
  if (input.title?.trim()) frame.title = input.title.trim();
  db.frames.unshift(frame);
  await persistDb();
  res.status(201).json(frame);
});

app.patch("/canvas/frames/:id", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const input = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    modelId: z.string().optional(),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional(),
    brandContext: z.string().optional(),
    workflowNodes: z.array(workflowNodeSchema).optional(),
    outputs: z.array(outputSchema).optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);

  const manualWorkflowNodes = input.workflowNodes ? await materializeWorkflowNodeImages(input.workflowNodes) : undefined;
  const manualOutputs = input.outputs ? await materializeOutputImages(input.outputs) : undefined;
  Object.assign(frame, { ...input, workflowNodes: frame.workflowNodes, outputs: frame.outputs }, { updatedAt: now() });

  if (input.modelId) {
    const model = findModelById(input.modelId);
    if (model) {
      frame.modelId = model.id;
      frame.modelName = model.name;
    }
  }

  if (input.settings) {
    frame.settings = { ...defaultSettings(frame.prompt, frame.settings), ...input.settings };
  }
  if (typeof input.brandInject === "boolean") {
    frame.settings.brandInject = input.brandInject;
  }
  if (input.brandId === null) {
    frame.brandId = "";
    frame.brandName = "无品牌";
    frame.brandContext = "";
    frame.brandInjected = false;
    frame.settings.brandInject = false;
  } else if (input.brandId) {
    const requestedBrand = db.brands.find((item) => item.id === input.brandId);
    if (requestedBrand) {
      frame.brandId = requestedBrand.id;
      frame.brandName = requestedBrand.name;
    }
  }

  const model = findModelById(frame.modelId) ?? defaultImageModel();
  const hasFrameBrand = Boolean(frame.brandId && db.brands.some((item) => item.id === frame.brandId));
  const brand = hasFrameBrand ? findBrand(frame.brandId) : activeBrand();
  const generatedBrandContext = buildBrandContext(brand);
  const nextBrandContext = input.brandContext ?? (frame.brandContext || generatedBrandContext);
  if (hasFrameBrand) {
    frame.brandId = brand.id;
    frame.brandName = brand.name;
  } else {
    frame.brandId = "";
    frame.brandName = "无品牌";
  }
  frame.brandInjected = hasFrameBrand && frame.settings.brandInject;
  frame.brandContext = frame.brandInjected ? nextBrandContext : "";
  frame.finalPrompt = buildFinalPrompt(frame.prompt, nextBrandContext, frame.brandInjected, hasFrameBrand ? brand : undefined);
  const emptyManualCoreWorkflow = Boolean(manualWorkflowNodes?.length) && !frame.prompt.trim() && manualWorkflowNodes!.every((node) => autoCoreNodeIds.has(node.id));
  if (emptyManualCoreWorkflow || (!manualWorkflowNodes && isEmptyAutoWorkflowFrame(frame))) {
    frame.workflowNodes = [];
    frame.outputs = [];
    frame.brandContext = "";
    frame.finalPrompt = "";
    frame.steps = [];
    frame.status = "ready";
    frame.progress = 0;
    await persistDb();
    return res.json(frame);
  }
  frame.workflowNodes = manualWorkflowNodes ?? frame.workflowNodes;
  frame.outputs = manualOutputs ?? frame.outputs;
  frame.steps = buildWorkflow(frame.prompt, brand, frame.brandInjected);
  if (!manualWorkflowNodes && frame.prompt.trim() && frame.workflowNodes.some((node) => autoCoreNodeIds.has(node.id))) {
    const bridge = buildWorkflowBridge(frame.prompt, brand, frame.settings, frame.brandInjected);
    const rebuiltNodes = buildWorkflowNodes(frame.prompt, hasFrameBrand ? brand : undefined, model, frame.settings, frame.brandContext, frame.brandInjected, bridge);
    frame.workflowNodes = rebuiltNodes.map((node) => {
      const current = frame.workflowNodes.find((item) => item.id === node.id);
      if (!current) return node;
      if (!frame.brandInjected && node.id === "input-image") {
        const nextRefs = [
          ...(node.refs ?? []),
          ...((current.refs ?? []).filter((reference) => ["general", "reference", "uploaded"].includes(reference.role) || !reference.id.startsWith("asset_")))
        ].filter((reference, index, list) => list.findIndex((item) => item.id === reference.id || (item.imageUrl && item.imageUrl === reference.imageUrl)) === index);
        return { ...node, refs: nextRefs, body: nextRefs.length ? nextRefs.map((asset) => `${asset.role}: ${asset.title}`).join(" / ") : node.body };
      }
      if (!frame.brandInjected && (node.id === "brand" || node.id === "prompt")) return node;
      return { ...node, title: current.title, body: current.body, preview: current.preview ?? node.preview, x: current.x ?? node.x, y: current.y ?? node.y, w: current.w ?? node.w, h: current.h ?? node.h };
    });
  }

  await persistDb();
  res.json(frame);
});

app.post("/canvas/frames/:id/run", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  if (!frame.prompt.trim()) return res.status(400).json({ message: "Frame has no workflow prompt to run" });
  if (frame.status === "generating") return res.status(409).json({ message: "Frame is already generating" });

  const input = z.object({
    modelId: z.string().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body ?? {});

  if (input.modelId) {
    const model = findModelById(input.modelId);
    if (model) {
      frame.modelId = model.id;
      frame.modelName = model.name;
    }
  }
  if (input.settings) frame.settings = { ...defaultSettings(frame.prompt, frame.settings), ...input.settings };

  for (const output of frame.outputs) {
    delete output.imageUrl;
    delete output.fileUrl;
    delete output.videoId;
    delete output.videoUrl;
  }
  for (const node of frame.workflowNodes) {
    node.refs = (node.refs ?? []).filter((reference) => !["generated", "visual", "document-preview", "video-preview", "version"].includes(reference.role));
  }

  const brand = frameBrand(frame);
  const taskId = nanoid(10);
  frame.taskId = taskId;
  frame.status = "generating";
  frame.progress = 8;
  frame.updatedAt = now();
  frame.finalPrompt = buildFinalPrompt(frame.prompt, frame.brandContext || (brand ? buildBrandContext(brand) : ""), frame.brandInjected, brand);
  frame.steps = buildWorkflow(frame.prompt, brand, frame.brandInjected);
  const task: GenerationTask = {
    id: taskId,
    frameId: frame.id,
    prompt: frame.prompt,
    finalPrompt: frame.finalPrompt,
    brandId: frame.brandId,
    brandName: frame.brandName,
    brandInjected: frame.brandInjected,
    brandContext: frame.brandContext,
    status: "queued",
    progress: 8,
    creditsCost: frame.cost,
    workflow: frame.steps,
    createdAt: now(),
    updatedAt: now()
  };
  req.authUser!.credits = Math.max(0, req.authUser!.credits - frame.cost);
  req.authUser!.updatedAt = now();
  db.tasks.unshift(task);
  await persistDb();
  void completeTask(taskId);
  res.status(202).json({ taskId, task, frame: applyGeneratedFileAuthToFrame(frame, req.authToken), credits: req.authUser!.credits });
});

function ensureFrameWorkflowNode(frame: CanvasFrame, nodeId: string) {
  const existing = frame.workflowNodes.find((item) => item.id === nodeId);
  if (existing) return existing;
  if (!autoCoreNodeIds.has(nodeId)) return undefined;
  const brand = frameBrand(frame);
  const model = findModelById(frame.modelId) ?? defaultImageModel();
  frame.workflowNodes = mergeWorkflowNodes(
    buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || (brand ? buildBrandContext(brand) : ""), frame.brandInjected),
    frame.workflowNodes
  );
  return frame.workflowNodes.find((item) => item.id === nodeId);
}

app.post("/canvas/frames/:id/nodes/:nodeId/generate", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = ensureFrameWorkflowNode(frame, req.params.nodeId);
  if (!node) return res.status(409).json({ message: "Node not synced yet. Save canvas workflow before generation." });

  const input = z.object({
    prompt: z.string().min(1).optional(),
    modelId: z.string().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const colors = neutralBrandColor(brand);
  const selectedModel = findModelById(input.modelId) ?? findModelById(frame.modelId) ?? defaultImageModel();
  if (selectedModel.type !== "image") {
    return res.status(400).json({ message: "Selected model is not an image generation model" });
  }
  if (input.settings) {
    frame.settings = { ...defaultSettings(frame.prompt, frame.settings), ...input.settings };
  }
  const refs = [
    ...resolvePromptAssets(input.prompt?.trim() || node.body || frame.prompt, brand).imageReferences,
    ...(node.parentId ? (frame.workflowNodes.find((item) => item.id === node.parentId)?.refs ?? []) : []),
    ...(node.refs ?? [])
  ].filter((reference, index, list) => list.findIndex((item) => item.id === reference.id) === index);
  const shouldInjectBrand = input.settings?.brandInject ?? frame.settings.brandInject;
  const executablePrompt = executableImagePrompt(input.prompt?.trim() || node.body || frame.prompt, Boolean(brand && shouldInjectBrand) ? brand : undefined, node.title || "canvas image", frame.settings);
  const outputName = `node-${frame.id}-${node.id}-${Date.now().toString(36)}`;
  let imageUrl = fallbackImageDataUrl("Image API unavailable");
  let generationNote = "";
  let generated = false;

  try {
    const generatedImageUrl = await runImageGenerationSkill(executablePrompt, refs, outputName, selectedModel.model, frame.settings, undefined, imageFormatFromText(`${node.title} ${input.prompt ?? ""}`));
    if (generatedImageUrl) {
      imageUrl = generatedImageUrl;
      generated = true;
    }
    else generationNote = "生成状态: 使用内置品牌图降级，未配置有效图片生成 Key。";
  } catch (error) {
    generationNote = `生成状态: 使用内置品牌图降级，${error instanceof Error ? error.message.slice(0, 120) : "unavailable"}`;
  }

  const baseNodeBody = cleanImageGenerationNotes(input.prompt?.trim() || node.body || frame.prompt);
  node.body = baseNodeBody;
  node.body = [
    node.body,
    `模型: ${selectedModel.name}`,
    `参数: ${frame.settings.ratio} · ${frame.settings.width ?? 1080}x${frame.settings.height ?? 1080} · ${frame.settings.quality} · strength ${frame.settings.strength} · ${contentLanguageLabel(frame.settings.contentLanguage)}`,
    generationNote
  ].filter(Boolean).join("\n");
  const generatedRef: ReferenceItem = {
    id: `generated_${node.id}_${Date.now().toString(36)}`,
    role: node.type === "reference" ? "reference" : "generated",
    title: node.title || "Generated image",
    description: node.body,
    color: node.preview ?? colors.accent,
    imageUrl
  };
  if (node.type === "image" || node.type === "reference" || node.type === "output") {
    node.refs = [generatedRef, ...(node.refs ?? []).filter((item) => item.imageUrl !== imageUrl)].slice(0, 12);
  }
  if (node.type === "output") {
    const outputIndex = frame.workflowNodes.filter((item) => item.type === "output").findIndex((item) => item.id === node.id);
    const nextOutput = {
      id: `out_${node.id}`,
      title: node.title || "Output",
      kind: "image" as const,
      gradient: `linear-gradient(135deg, ${colors.accent}, #f8fafc 58%, ${colors.primary})`,
      copy: node.body || frame.prompt,
      imageUrl
    };
    if (outputIndex >= 0 && frame.outputs[outputIndex]) frame.outputs[outputIndex] = { ...frame.outputs[outputIndex], ...nextOutput };
    else frame.outputs.push(nextOutput);
  }

  frame.updatedAt = now();
  await persistDb();
  res.json({
    frame: applyGeneratedFileAuthToFrame(frame, req.authToken),
    node: applyGeneratedFileAuthToNode(frame, node, req.authToken),
    imageUrl: generatedFileUrl(imageUrl, req.authToken),
    generated,
    message: generated ? "图片已由VDAMO 图片 API 生成。" : generationNote
  });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-text", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = ensureFrameWorkflowNode(frame, req.params.nodeId);
  if (!node) return res.status(404).json({ message: "Node not found" });

  const input = z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    translate: z.boolean().optional(),
    contentLanguage: contentLanguageSchema.optional(),
    mode: z.enum(["story", "table", "text"]).optional()
  }).parse(req.body);
  const textMode = input.mode === "text" ? "story" : input.mode ?? "story";

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const contentLanguage = input.contentLanguage ?? frame.settings.contentLanguage;
  const source = input.prompt.trim();
  const resolved = resolvePromptAssets(source, brand);
  const translated = input.translate
    ? `English prompt: ${resolved.prompt}. Keep CAL resource intent${brand ? ` and ${brand.name} visual language` : ""}.`
    : resolved.prompt;
  const fallbackText = [
    translated,
    "",
    `品牌约束: ${brandLabel(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
    contentLanguageInstruction({ contentLanguage }, "text"),
    "输出要求: 作为文本节点内容直接进入画布编辑器；可包含标题、段落、列表、提示词或文案，但不要输出分镜表格。分镜表格和故事版请使用脚本节点。"
  ].join("\n");
  let generatedText = fallbackText;
  try {
    const remote = await runTextGeneration(
      [
        "任务: 根据用户指令自动生成可直接进入画布文本编辑器的内容。可以是故事、文案、角色设定、图片反推提示词、品牌说明或普通 Markdown 文本。不要生成分镜表格；如果用户要求分镜/故事版/视频脚本，提示其应使用脚本节点或输出非表格摘要。",
        `用户输入: ${translated}`,
        `CAL解析: ${JSON.stringify({ agents: resolved.agents, commands: resolved.commands, imageReferences: resolved.imageReferences.map((item) => item.description), textReferences: resolved.textReferences, lockedTexts: resolved.lockedTexts, tags: resolved.tags, params: resolved.params, outputs: resolved.outputs })}`,
        `品牌: ${brandLabel(contextBrand)}`,
        `品牌风格: ${brandVisualStyle(contextBrand)}`,
        `品牌语气: ${brandTone(contextBrand)}`,
        `文本模式: ${textMode}`,
        contentLanguageInstruction({ contentLanguage }, "text")
      ].join("\n"),
      input.model
    );
    if (remote) generatedText = remote;
  } catch (error) {
    generatedText = `${fallbackText}\n\n远程文本模型降级: ${error instanceof Error ? error.message.slice(0, 160) : "unavailable"}`;
  }
  const languageLabel = contentLanguageLabel(contentLanguage);
  if (contentLanguage !== "auto" && !generatedText.includes(languageLabel)) {
    generatedText = `Content language: ${languageLabel}\n\n${generatedText}`;
  }

  node.body = generatedText;
  node.title = node.title || "Text";
  node.type = "process";
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame: applyGeneratedFileAuthToFrame(frame, req.authToken), node: applyGeneratedFileAuthToNode(frame, node, req.authToken), text: generatedText, mode: textMode, model: input.model ?? serviceConfig("text").model });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-script", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = ensureFrameWorkflowNode(frame, req.params.nodeId);
  if (!node) return res.status(404).json({ message: "Node not found" });

  const input = z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    translate: z.boolean().optional(),
    contentLanguage: contentLanguageSchema.optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const contentLanguage = input.contentLanguage ?? frame.settings.contentLanguage;
  const source = input.prompt.trim();
  const resolved = resolvePromptAssets(source, brand);
  const wantsTable = /表格|故事版|分镜表|storyboard|table/i.test(source);
  const storyboardRefs = contextBrand ? buildReferenceItems(contextBrand, 4) : [];
  const fallbackScript = wantsTable
    ? [
        "| 镜号 | 参考图 | 时长 | 画面描述 | 角色 | 景别 | 角色动作 | 情绪 | 光影氛围 | 音效 | 分镜提示词 | 视频运动提示词 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        `| 1 | ${storyboardRefs[0]?.title ?? "参考素材"} | 3s | ${resolved.prompt} 的开场 | ${contextBrand?.ipName ?? "主角/产品"} | 特写 | 建立场景和主体关系 | 克制专业 | ${brandVisualStyle(contextBrand)} | 轻节奏铺底 | 清晰主体层级 | 摄影机缓慢推进 |`,
        `| 2 | ${storyboardRefs[1]?.title ?? "产品/角色参考"} | 4s | 展示关键冲突、动作或卖点 | ${contextBrand?.ipName ?? "主角"} | 中景 | 推进核心动作 | 紧凑 | 背景有层次 | 节奏增强 | 动作和构图明确 | 横移跟随主体动作 |`,
        `| 3 | ${storyboardRefs[2]?.title ?? "收尾参考"} | 3s | 收束到结论、品牌或下一节点输入 | ${contextBrand?.logoText ?? "CTA"} | 全景 | 定格收尾 | 干净有力 | 明暗清晰 | 收尾音 | 输出可接视频节点 | 轻微拉远后定格 |`
      ].join("\n")
    : [
        `分镜脚本: ${node.title || "Script"}`,
        "",
        `剧情目标: ${resolved.prompt}`,
        `品牌约束: ${brandLabel(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
        contentLanguageInstruction({ contentLanguage }, "script"),
        "",
        "镜头 1",
        "- 时长: 3s",
        "- 画面: 建立品牌场景，明确商品、角色和主视觉方向。",
        "- 运动: 缓慢推进，保持构图稳定。",
        "- 音效: 干净环境声，弱节奏铺底。",
        "",
        "镜头 2",
        "- 时长: 4s",
        "- 画面: 结合角色参考和视频参考，突出核心动作与产品质感。",
        "- 运动: 中速横移或环绕，避免复杂眩晕镜头。",
        "- 音效: 节奏增强，保留商业短视频质感。",
        "",
        "镜头 3",
        "- 时长: 3s",
        "- 画面: 收束到品牌 Logo、域名或行动号召。",
        "- 运动: 轻微拉远，给后续视频节点稳定输入。",
        "- 音效: 清晰收尾音。",
        "",
        input.translate ? "提示: 已按英文视频模型可读结构整理。" : "提示: 可直接连接视频节点继续生成。"
      ].join("\n");
  let script = fallbackScript;
  try {
    const remote = await runTextGeneration(
      [
        wantsTable
          ? "任务: 生成标准 Markdown 分镜故事版表格，表头必须包含 镜号、参考图、时长、画面描述、音效、分镜提示词、视频运动提示词。"
          : "任务: 生成可执行的视频分镜脚本，分镜清晰，包含镜头、时长、画面、运动、音效、品牌收束。",
        `剧情目标: ${resolved.prompt}`,
        `CAL解析: ${JSON.stringify({ agents: resolved.agents, commands: resolved.commands, imageReferences: resolved.imageReferences.map((item) => item.description), textReferences: resolved.textReferences, lockedTexts: resolved.lockedTexts, tags: resolved.tags, params: resolved.params, outputs: resolved.outputs })}`,
        `品牌: ${brandLabel(contextBrand)}`,
        `品牌风格: ${brandVisualStyle(contextBrand)}`,
        contentLanguageInstruction({ contentLanguage }, "script"),
        input.translate ? "同时整理为英文视频模型易读结构。" : ""
      ].filter(Boolean).join("\n"),
      input.model
    );
    if (remote) script = remote;
  } catch (error) {
    script = `${fallbackScript}\n\n远程文本模型降级: ${error instanceof Error ? error.message.slice(0, 160) : "unavailable"}`;
  }

  node.type = "script";
  node.title = node.title || "Script";
  node.body = script;
  if (wantsTable) node.refs = storyboardRefs;
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame: applyGeneratedFileAuthToFrame(frame, req.authToken), node: applyGeneratedFileAuthToNode(frame, node, req.authToken), script, model: input.model ?? serviceConfig("text").model });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-video", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = ensureFrameWorkflowNode(frame, req.params.nodeId);
  if (!node) return res.status(404).json({ message: "Node not found" });

  const input = z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    settings: z.object({
      mode: z.string().optional(),
      ratio: z.string().optional(),
      duration: z.string().optional(),
      sound: z.boolean().optional(),
      translate: z.boolean().optional(),
      contentLanguage: contentLanguageSchema.optional()
    }).optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const settings = input.settings ?? {};
  const selectedVideoModel = input.model || serviceConfig("video").model;
  if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
    console.error("[video-smoke] route start", JSON.stringify({ frameId: frame.id, nodeId: node.id, model: selectedVideoModel, firstFrameRefs: (node.refs ?? []).length }));
  }
  const sourcePrompt = node.type === "output" ? `${frame.prompt}\n${input.prompt.trim()}`.trim() : input.prompt.trim();
  const outputNodes = frame.workflowNodes.filter((item) => item.type === "output");
  const outputIndex = outputNodes.findIndex((item) => item.id === node.id);
  const targetOutput = outputIndex >= 0 ? frame.outputs[outputIndex] : frame.outputs.find((item) => item.kind === "video");
  const visualDraftNode = frame.workflowNodes.find((item) => item.id === "visual-draft");
  const inputRefs = frame.workflowNodes.find((item) => item.id === "input-image")?.refs ?? [];
  const resolvedRefs = resolvePromptAssets(sourcePrompt, contextBrand).imageReferences;
  const videoRefs = stableVideoReferences([
    ...resolvedRefs,
    ...inputRefs,
    ...(node.refs ?? [])
  ], 10);
  let firstFrameUrl = node.refs?.find((reference) => ["first-frame", "visual", "video-preview", "generated"].includes(reference.role) && reference.imageUrl)?.imageUrl
    ?? targetOutput?.imageUrl
    ?? visualDraftNode?.refs?.find((reference) => reference.imageUrl)?.imageUrl
    ?? frame.outputs.find((output) => output.kind === "image" && output.imageUrl)?.imageUrl
    ?? "";
  if (firstFrameUrl && /^data:image\//i.test(firstFrameUrl)) {
    const materializedFirstFrame = await materializeAssetImageUrl(firstFrameUrl, `xmanx-${frame.id}-${node.id}-first-frame`);
    if (materializedFirstFrame) {
      firstFrameUrl = materializedFirstFrame;
    }
  }
  let firstFrameNote = "";
  const durationSeconds = videoDurationSeconds(settings);
  const segmentPlan = videoSegmentPlan(durationSeconds, selectedVideoModel);
  const keyframeCount = videoKeyframeCount(durationSeconds);
  const generatedKeyframeRefs: ReferenceItem[] = [];
  let storyboardSheetRef: ReferenceItem | undefined;
  const shouldSynthesizeStoryboardAssets = videoRefs.length > 0 && !firstFrameUrl;
  if (shouldSynthesizeStoryboardAssets) {
    try {
      const generatedStoryboard = await runImageGenerationSkill(
        videoStoryboardSheetPrompt(sourcePrompt, contextBrand, videoRefs, { ratio: "16:9", duration: `${durationSeconds}s`, contentLanguage: settings.contentLanguage ?? frame.settings.contentLanguage }, segmentPlan),
        videoRefs,
        `xmanx-${frame.id}-${node.id}-storyboard`,
        models[0]?.model,
        { ...frame.settings, ratio: "16:9", contentLanguage: settings.contentLanguage ?? frame.settings.contentLanguage },
        Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "300000")
      );
      if (generatedStoryboard) {
        storyboardSheetRef = {
          id: `video_storyboard_${node.id}`,
          role: "storyboard-sheet",
          title: "视频分镜板",
          description: `宽幅分镜板，用于锁定 ${durationSeconds}s 视频的人物、Logo、场景、镜头和片段关系。`,
          color: node.preview ?? "#111827",
          imageUrl: generatedStoryboard
        };
      }
    } catch (error) {
      firstFrameNote = `视频分镜板生成失败，继续生成单镜头首帧：${error instanceof Error ? error.message.slice(0, 140) : "image API unavailable"}`;
    }
  }
  if (shouldSynthesizeStoryboardAssets) {
    const startIndex = firstFrameUrl ? 1 : 0;
    const keyframeSourceRefs = stableVideoReferences([...videoRefs, ...(storyboardSheetRef ? [storyboardSheetRef] : [])], 12);
    try {
      for (let shotIndex = startIndex; shotIndex < keyframeCount; shotIndex += 1) {
        const generated = await runImageGenerationSkill(
          videoKeyframePrompt(sourcePrompt, contextBrand, keyframeSourceRefs, { ratio: settings.ratio?.split("·")[0]?.trim() || frame.settings.ratio, duration: `${durationSeconds}s`, contentLanguage: settings.contentLanguage ?? frame.settings.contentLanguage }, shotIndex, keyframeCount),
          keyframeSourceRefs,
          `xmanx-${frame.id}-${node.id}-keyframe-${shotIndex + 1}`,
          models[0]?.model,
          { ...frame.settings, ratio: settings.ratio?.split("·")[0]?.trim() || frame.settings.ratio, contentLanguage: settings.contentLanguage ?? frame.settings.contentLanguage },
          Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "300000")
        );
        if (!generated) continue;
        if (!firstFrameUrl) {
          firstFrameUrl = generated;
          firstFrameNote = `已先用VDAMO 图片 API 和 ${videoRefs.length} 张参考素材生成视频首帧。`;
        }
        generatedKeyframeRefs.push({
          id: `video_keyframe_${node.id}_${shotIndex}`,
          role: shotIndex === 0 ? "first-frame" : "keyframe",
          title: `视频关键帧 ${shotIndex + 1}/${keyframeCount}`,
          description: `按 ${durationSeconds}s 视频节奏生成的分镜关键帧。`,
          color: node.preview ?? "#111827",
          imageUrl: generated
        });
      }
    } catch (error) {
      firstFrameNote = `视频关键帧生成失败，继续使用视频模型自身能力：${error instanceof Error ? error.message.slice(0, 140) : "image API unavailable"}`;
    }
  } else if (firstFrameUrl) {
    firstFrameNote = firstFrameNote || "已检测到现成首帧/参考图，跳过额外分镜板与关键帧预生成，直接提交视频模型。";
  }
  const videoPromptRefs = [
    ...videoRefs,
    ...(storyboardSheetRef ? [storyboardSheetRef] : []),
    ...generatedKeyframeRefs,
    ...(firstFrameUrl ? [{
      id: `first_frame_${node.id}_${Date.now().toString(36)}`,
      role: "first-frame",
      title: "视频首帧",
      description: "视频生成使用的一致性锚点。",
      color: node.preview ?? "#111827",
      imageUrl: firstFrameUrl
    }] : [])
  ];
  const effectiveVideoMode = firstFrameUrl || videoPromptRefs.some((reference) => reference.imageUrl)
    ? "图生视频"
    : settings.mode ?? "文生视频";
  const modelDurationSettings = { ...settings, duration: `${segmentPlan[0]?.modelSeconds ?? videoModelClipSeconds(selectedVideoModel)}s` };
  const prompt = executableVideoPrompt(sourcePrompt, contextBrand, modelDurationSettings, videoPromptRefs);
  let generationLines: string[] = [];
  let videoId = "";
  let videoUrl = "";
  let usedFirstFrame = false;
  let fallbackReason = "";
  let generationErrorMessage = "";
  if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
    console.error("[video-smoke] enter generate-video", JSON.stringify({ frameId: frame.id, nodeId: node.id, firstFrameUrl, segmentCount: segmentPlan.length, effectiveVideoMode, refs: videoRefs.length }));
  }
  try {
    const segmentResults: VideoRunResult[] = [];
    if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
      console.error("[video-smoke] before segment loop", JSON.stringify({ segmentPlan, firstFrameUrl, videoRefs: videoRefs.length, shouldSynthesizeStoryboardAssets }));
    }
    const segmentFirstFrames = [firstFrameUrl, ...generatedKeyframeRefs.map((reference) => reference.imageUrl).filter(Boolean)];
    for (const segment of segmentPlan) {
      const segmentFirstFrame = segmentFirstFrames[segment.index] ?? firstFrameUrl;
      const segmentSettings = { ...settings, duration: `${segment.modelSeconds}s`, mode: effectiveVideoMode };
      const segmentPrompt = [
        executableVideoPrompt(sourcePrompt, contextBrand, segmentSettings, videoPromptRefs),
        `Segment ${segment.index + 1}/${segmentPlan.length}: generate a ${segment.modelSeconds}s source clip for final ${segment.targetSeconds}s${segment.trim ? "; final editor trims the beginning to target duration" : ""}.`,
        "Keep the same character, logo, store/product environment, voice tone, language and BGM bed across all segments."
      ].join("\n");
      if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
        console.error("[video-smoke] before video generation", JSON.stringify({ segmentIndex: segment.index, segmentFirstFrame: Boolean(segmentFirstFrame), segmentPrompt: segmentPrompt.slice(0, 120) }));
      }
      const result = segmentPlan.length === 1
        ? await runVideoGeneration(segmentPrompt, selectedVideoModel, segmentSettings, { firstFrameUrl: segmentFirstFrame })
        : await createVideoGenerationJob(segmentPrompt, selectedVideoModel, segmentSettings, Number(process.env.WORKFLOW_VIDEO_CREATE_TIMEOUT_MS ?? "45000"), { firstFrameUrl: segmentFirstFrame });
      if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
        console.error("[video-smoke] segment finished", JSON.stringify({ segmentIndex: segment.index, hasResult: Boolean(result), videoId: result?.videoId ?? "", videoUrl: result?.videoUrl ?? "" }));
      }
      if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
        console.error("[video-smoke] segment result", JSON.stringify({ segmentIndex: segment.index, hasResult: Boolean(result), videoId: result?.videoId ?? "", videoUrl: result?.videoUrl ?? "", usedFirstFrame: result?.usedFirstFrame ?? false }));
      }
      if (result) segmentResults.push(result);
    }
    const videoIds = segmentResults.map((result) => result.videoId).filter(Boolean);
    const sourceVideoUrls = segmentResults.map((result) => result.videoUrl).filter(Boolean);
    usedFirstFrame = segmentResults.some((result) => result.usedFirstFrame);
    fallbackReason = segmentResults.map((result) => result.fallbackReason).filter(Boolean)[0] ?? "";
    if (videoIds.length) videoId = videoIds.join(",");
    if (sourceVideoUrls.length === segmentPlan.length) {
      const composedUrl = videoNeedsCompose(durationSeconds, selectedVideoModel)
        ? await composeLocalVideos(sourceVideoUrls, segmentPlan, `xmanx-${frame.id}-${node.id}-final`)
        : await bestEffortMaterializeVideoPublicUrl(sourceVideoUrls[0], `xmanx-${frame.id}-${node.id}-final`, 0);
      if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
        console.error("[video-smoke] materialize result", JSON.stringify({ sourceVideoUrls, composedUrl }));
      }
      if (composedUrl) videoUrl = composedUrl;
    }
    if (videoUrl) {
      generationLines = [
        videoId ? `视频ID: ${videoId}` : "视频ID: completed",
        `视频URL: ${videoUrl}`,
        usedFirstFrame ? "执行状态: 已由视频模型按首帧图生视频生成，并完成最终时长裁切/合成。" : "执行状态: 已由视频模型生成，并完成最终时长裁切/合成。"
      ];
    } else if (videoId) {
      const localSaveFailed = sourceVideoUrls.length === segmentPlan.length && !videoUrl;
      generationLines = [
        `视频ID: ${videoId}`,
        sourceVideoUrls.length ? `源片URL: ${sourceVideoUrls.join(" / ")}` : "",
        localSaveFailed
          ? "执行状态: 视频模型已返回临时 URL，但本地下载保存失败；未标记为最终 MP4。"
          : videoNeedsCompose(durationSeconds, selectedVideoModel)
            ? "执行状态: 视频片段任务已创建；最终 MP4 需要等待片段 videoUrl 后进入合成/裁切。"
            : "执行状态: 视频任务已创建但仍在生成，可用 /v1/videos/{video_id} 查询。"
      ].filter(Boolean);
    }
  } catch (error) {
    generationErrorMessage = error instanceof Error ? error.message.slice(0, 180) : "unavailable";
    generationLines = [`执行状态: 视频生成请求失败，${generationErrorMessage}`];
  }
  const videoPlan = [
    prompt,
    "",
    "分镜规范:",
    videoStoryboardBrief(sourcePrompt, contextBrand, videoPromptRefs, settings),
    "",
    `视频类型: ${effectiveVideoMode}`,
    `模型: ${selectedVideoModel}`,
    `规格: ${settings.ratio ?? "16:9 · 720P"}`,
    `语言: ${contentLanguageLabel(settings.contentLanguage ?? frame.settings.contentLanguage)}`,
    `声音: ${settings.sound === false ? "关闭" : "开启"}`,
    `翻译: ${settings.translate ? "开启" : "关闭"}`,
    `时长策略: 最终成片 ${durationSeconds}s；${selectedVideoModel} 固定单次输出 ${videoModelClipSeconds(selectedVideoModel)}s；${videoSegmentSummary(durationSeconds, selectedVideoModel)}。`,
    `首帧: ${firstFrameUrl ? usedFirstFrame ? "已提交给视频模型" : "已生成/已选择，但视频接口未确认使用" : "未使用首帧"}`,
    `分镜板: ${storyboardSheetRef?.imageUrl ? "已生成并作为关键帧生成参考" : "未生成/使用已有分镜文本"}`,
    `关键帧: ${generatedKeyframeRefs.length ? `${generatedKeyframeRefs.length} 张，长视频可拆段后合成` : keyframeCount > 1 ? "当前仅使用已有首帧；建议继续生成补充关键帧" : "短视频单首帧"}`,
    `引用素材: ${videoRefs.length ? videoRefs.map((reference) => `${reference.role}:${reference.title}`).join(" / ") : "无"}`,
    `品牌约束: ${brandLabel(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
    firstFrameNote,
    fallbackReason,
    ...(generationLines.length ? generationLines : ["执行状态: 已保存视频生成配置，未配置视频 API Key。"])
  ].filter(Boolean).join("\n");

  if (node.type !== "output") node.type = "video";
  node.title = node.title || "Video";
  node.body = videoPlan;
  if (videoId) node.videoId = videoId;
  if (videoUrl) node.videoUrl = videoUrl;
  if (videoUrl && firstFrameUrl) node.imageUrl = firstFrameUrl;
  if (firstFrameUrl) {
    upsertNodeReference(node, {
      id: `first_frame_${node.id}`,
      role: "first-frame",
      title: "视频首帧",
      description: usedFirstFrame ? "已作为 input_reference 提交给视频模型。" : "由VDAMO 图片 API/画布输出生成，用于人工检查视频一致性。",
      color: node.preview ?? "#111827",
      imageUrl: firstFrameUrl
    });
  }
  if (storyboardSheetRef) upsertNodeReference(node, storyboardSheetRef);
  for (const keyframeRef of generatedKeyframeRefs) upsertNodeReference(node, keyframeRef);
  if (node.type === "output") {
    if (targetOutput) {
      if (videoId) targetOutput.videoId = videoId;
      if (videoUrl) {
        targetOutput.videoUrl = videoUrl;
        if (firstFrameUrl) targetOutput.imageUrl = firstFrameUrl;
      }
      if (firstFrameNote) targetOutput.copy = appendCopyNote(targetOutput.copy, firstFrameNote);
      if (usedFirstFrame) targetOutput.copy = appendCopyNote(targetOutput.copy, "已提交视频首帧 input_reference 以锁定人物、Logo 和品牌画面。");
      if (fallbackReason) targetOutput.copy = appendCopyNote(targetOutput.copy, fallbackReason);
      targetOutput.copy = appendCopyNote(targetOutput.copy, generationLines.join(" ") || "执行状态: 已保存视频生成配置，未配置视频 API Key。");
      if (targetOutput.videoUrl) {
        const ref = generatedReference(`generated_${node.id}_${Date.now().toString(36)}`, targetOutput, node.preview ?? "#0f172a", "video-preview");
        upsertNodeReference(node, ref);
      }
    }
  }
  frame.updatedAt = now();
  await persistDb();
  if (process.env.SPARKCANVAS_DEBUG_VIDEO_SMOKE === "1") {
    console.error("[video-smoke] route complete", JSON.stringify({ frameId: frame.id, nodeId: node.id, videoId, videoUrl, generationErrorMessage }));
  }
  const payload = {
    frame: applyGeneratedFileAuthToFrame(frame, req.authToken),
    node: applyGeneratedFileAuthToNode(frame, node, req.authToken),
    videoPlan,
    model: input.model ?? serviceConfig("video").model,
    videoId,
    videoUrl: generatedFileUrl(videoUrl, req.authToken)
  };
  if (generationErrorMessage && !videoId && !videoUrl) {
    return res.status(500).json(payload);
  }
  res.json(payload);
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-audio", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = ensureFrameWorkflowNode(frame, req.params.nodeId);
  if (!node) return res.status(404).json({ message: "Node not found" });

  const input = z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    settings: z.object({
      mode: z.string().optional(),
      duration: z.string().optional(),
      scene: z.string().optional(),
      loop: z.boolean().optional(),
      translate: z.boolean().optional(),
      contentLanguage: contentLanguageSchema.optional()
    }).optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const settings = input.settings ?? {};
  const resolved = resolvePromptAssets(input.prompt.trim(), brand);
  const prompt = resolved.prompt;
  const contentLanguage = settings.contentLanguage ?? frame.settings.contentLanguage;
  const selectedAudioModel = input.model ?? defaultTextModel();
  const audioPlan = [
    prompt,
    "",
    `音频类型: ${settings.mode ?? "配乐"}`,
    `模型: ${selectedAudioModel}`,
    `时长: ${settings.duration ?? "15s"}`,
    `场景: ${settings.scene ?? "广告短视频"}`,
    `语言: ${contentLanguageLabel(contentLanguage)}`,
    `循环: ${settings.loop ? "开启" : "关闭"}`,
    `翻译: ${settings.translate ? "开启" : "关闭"}`,
    `CAL解析: ${JSON.stringify({ agents: resolved.agents, commands: resolved.commands, imageReferences: resolved.imageReferences.map((item) => item.description), textReferences: resolved.textReferences, lockedTexts: resolved.lockedTexts, tags: resolved.tags, params: resolved.params, outputs: resolved.outputs })}`,
    `品牌约束: ${brandLabel(contextBrand)}; ${brandTone(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
    "执行状态: 已保存音频生成配置，等待接入真实音频生成 API。"
  ].join("\n");

  node.type = "audio";
  node.title = node.title || "Audio";
  node.body = audioPlan;
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame: applyGeneratedFileAuthToFrame(frame, req.authToken), node: applyGeneratedFileAuthToNode(frame, node, req.authToken), audioPlan, model: selectedAudioModel });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-compose", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = ensureFrameWorkflowNode(frame, req.params.nodeId);
  if (!node) return res.status(404).json({ message: "Node not found" });

  const input = z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    settings: z.object({
      duration: z.string().optional(),
      ratio: z.string().optional(),
      contentLanguage: contentLanguageSchema.optional(),
      transition: z.string().optional(),
      audioMode: z.string().optional()
    }).optional()
  }).parse(req.body);

  const brand = frameContextBrand(frame);
  const settings = input.settings ?? {};
  const composeVideoModel = input.model || serviceConfig("video").model;
  const durationSeconds = videoDurationSeconds({ duration: settings.duration ?? `${frame.settings.duration || 20}s` });
  const segmentPlan = videoSegmentPlan(durationSeconds, composeVideoModel);
  const videoNodes = frame.workflowNodes.filter((item) => item.type === "video" || /seg|片段|video|mp4/i.test(`${item.id} ${item.title}`));
  const inputVideoNodes = (node.inputIds ?? [])
    .map((id) => frame.workflowNodes.find((item) => item.id === id))
    .filter((item): item is WorkflowNode => Boolean(item));
  const videoOutputs = frame.outputs.filter((output) => output.kind === "video");
  const segmentUrls = [
    ...inputVideoNodes.flatMap((item) => item.videoUrl ? [item.videoUrl] : []),
    ...videoNodes.flatMap((item) => item.videoUrl ? [item.videoUrl] : []),
    ...videoOutputs.flatMap((output) => output.videoUrl ? [output.videoUrl] : []),
    ...(node.refs ?? []).map((reference) => reference.imageUrl ?? "").filter((url) => /\.mp4($|\?)/i.test(url)),
    ...videoNodes.flatMap((item) => (item.refs ?? []).map((reference) => reference.imageUrl ?? "").filter((url) => /\.mp4($|\?)/i.test(url)))
  ].filter((url, index, list) => url && list.indexOf(url) === index);
  const composeVerification = await composeLocalVideosDetailed(segmentUrls, segmentPlan, `xmanx-${frame.id}-${node.id}-merged`);
  const mergedUrl = composeVerification.mergedUrl;
  const refs = [
    ...videoNodes.flatMap((item) => item.refs ?? []),
    ...(frame.workflowNodes.find((item) => item.id === "input-image")?.refs ?? [])
  ].filter((reference, index, list) => reference.imageUrl && list.findIndex((item) => item.id === reference.id || item.imageUrl === reference.imageUrl) === index).slice(0, 12);

  const composePlan = [
    input.prompt.trim(),
    "",
    `合成目标: ${durationSeconds}s ${settings.ratio ?? frame.settings.ratio} 最终 MP4`,
    `模型约束: ${composeVideoModel} 固定单次输出 ${videoModelClipSeconds(composeVideoModel)}s；短成片要先生成模型固定源片再裁切。`,
    `分段策略: ${segmentPlan.length} 段 · ${videoSegmentSummary(durationSeconds, composeVideoModel)}`,
    `片段状态: ${segmentUrls.length ? `${segmentUrls.length} 个片段已有 videoUrl` : "暂无可合并 videoUrl，等待各视频片段生成完成"}`,
    `剪辑规则: ${settings.transition ?? "短交叉淡入淡出 + 节奏点硬切"}；保持同一品牌空间、同一 IP/模特、同一 Logo 安全边距。`,
    `配音规则: ${settings.audioMode ?? "每段单独生成旁白/音效提示，但统一语言、音色、响度、BGM 音色和节奏"}；不要让用户听出两个不配套的视频。`,
    `语言: ${contentLanguageLabel(settings.contentLanguage ?? frame.settings.contentLanguage)}`,
    `品牌约束: ${brandLabel(brand)}; ${brandTone(brand)}; ${brandVisualStyle(brand)}`,
    refs.length ? `视觉引用: ${refs.map((reference) => `${reference.role}:${reference.title}`).join(" / ")}` : "视觉引用: 无",
    `合成校验: ${composeVerification.continuityChecks.join(" | ")}`,
    mergedUrl
      ? `执行状态: 已用 ffmpeg 完成裁切/合成 ${mergedUrl}`
      : composeVerification.failureReason === "insufficient-video-urls"
        ? `执行状态: 片段不足，需 ${composeVerification.requiredSegments} 段、当前仅 ${composeVerification.sourceCount} 段；等待更多 videoUrl 后再合成。`
        : composeVerification.failureReason === "ffmpeg-unavailable"
          ? "执行状态: 本地 ffmpeg 不可用，无法完成裁切/合成验证。"
          : composeVerification.failureReason
            ? `执行状态: 合成验证失败（${composeVerification.failureReason}），已暴露失败原因供排查。`
            : "执行状态: 已保存合成计划，等待视频片段全部生成。"
  ].filter(Boolean).join("\n");

  node.type = "compose";
  node.title = node.title || "视频合成剪辑";
  node.body = composePlan;
  node.refs = refs;
  const targetOutput = frame.outputs.find((output) => output.kind === "video");
  if (targetOutput) {
    if (mergedUrl) targetOutput.videoUrl = mergedUrl;
    const composeStatusNote = mergedUrl
      ? `最终 MP4 已合成: ${mergedUrl}`
      : composeVerification.failureReason === "insufficient-video-urls"
        ? `视频合成计划已生成：${segmentPlan.length} 段，当前仅收到 ${composeVerification.sourceCount}/${composeVerification.requiredSegments} 段 videoUrl；等待更多片段后再裁切/合成。`
        : composeVerification.failureReason === "ffmpeg-unavailable"
          ? "视频合成计划已生成，但本地 ffmpeg 不可用，暂时无法完成裁切/合成验证。"
          : composeVerification.failureReason
            ? `视频合成验证失败：${composeVerification.failureReason}。请先排查失败原因，再重试裁切/合成。`
            : `视频合成计划已生成：${segmentPlan.length} 段，等待片段 videoUrl 后裁切/合成。`;
    targetOutput.copy = appendCopyNote(targetOutput.copy, composeStatusNote);
  }
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame: applyGeneratedFileAuthToFrame(frame, req.authToken), node: applyGeneratedFileAuthToNode(frame, node, req.authToken), composePlan, mergedUrl: generatedFileUrl(mergedUrl, req.authToken), segments: segmentPlan.map((segment) => segment.targetSeconds), segmentPlan, composeVerification });
});

app.get("/tasks/:id", (req, res) => {
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ message: "Task not found" });
  const frame = db.frames.find((item) => item.id === task.frameId);
  res.json({ task, frame: frame ? applyGeneratedFileAuthToFrame(frame, req.authToken) : frame, credits: req.authUser!.credits });
});

app.post("/generate", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(2),
    mode: z.enum(["magic", "template"]).default("magic"),
    templateId: z.string().optional(),
    modelId: z.string().optional(),
    brandId: z.string().nullable().optional(),
    brandInject: z.boolean().optional(),
    brandContext: z.string().optional(),
    workflowNodes: z.array(workflowNodeSchema).optional(),
    outputs: z.array(outputSchema).optional(),
    outputTarget: z.enum(["jpg", "png", "poster", "pdf", "mp4", "kit"]).optional(),
    orientation: z.enum(["square", "portrait", "landscape"]).optional(),
    settings: generationSettingsPatchSchema.optional(),
    x: z.number().optional(),
    y: z.number().optional()
  }).parse(req.body);

  const template = templates.find((item) => item.id === input.templateId);
  const inferredBrand = input.brandId === null ? undefined : input.brandId ? db.brands.find((item) => item.id === input.brandId) : inferBrandFromPrompt(input.prompt);
  const effectiveOutputTarget = input.outputTarget ?? finalOutputFromPrompt(input.prompt);
  const effectiveOrientation = input.orientation ?? "landscape";
  const optimizedPrompt = optimizeWorkflowPrompt(input.prompt, inferredBrand, effectiveOutputTarget, effectiveOrientation, input.settings);
  const prompt = template ? `${template.title}：${optimizedPrompt || template.intent}` : optimizedPrompt;
  const optimizedSettings = settingsForFinalOutput(effectiveOutputTarget, effectiveOrientation, input.settings, optimizedPrompt || input.prompt);
  const taskId = nanoid(10);
  const frame = createFrame(
    prompt,
    input.mode,
    input.x ?? 220 + db.frames.length * 96,
    input.y ?? 80 + db.frames.length * 48,
    "generating",
    taskId,
    template?.cost,
    input.modelId,
    optimizedSettings,
    input.brandId,
    input.brandInject,
    input.brandContext,
    input.workflowNodes,
    input.outputs
  );
  const task: GenerationTask = {
    id: taskId,
    frameId: frame.id,
    prompt,
    finalPrompt: frame.finalPrompt,
    brandId: frame.brandId,
    brandName: frame.brandName,
    brandInjected: frame.brandInjected,
    brandContext: frame.brandContext,
    status: "queued",
    progress: 8,
    creditsCost: frame.cost,
    workflow: frame.steps,
    createdAt: now(),
    updatedAt: now()
  };

  req.authUser!.credits = Math.max(0, req.authUser!.credits - frame.cost);
  req.authUser!.updatedAt = now();
  db.frames.unshift(frame);
  db.tasks.unshift(task);
  await persistDb();
  void completeTask(taskId);
  res.status(201).json({ taskId, task, frame: applyGeneratedFileAuthToFrame(frame, req.authToken), credits: req.authUser!.credits });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ message: "Invalid request payload", issues: error.issues });
  }
  const message = isProduction ? "Internal server error" : error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ message });
};

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4100);
// Output watcher: when pi/generation drops a real media file into the watch
// directory, register it as an Asset and surface it back in the workspace so
// outputs automatically flow back into the material library.
const workGraphOutputWatcherState = {
  enabled: workGraphOsOutputWatchEnabled,
  dir: workGraphOsOutputWatchDir,
  dirs: [] as string[],
  active: false,
  registered: [] as Array<{ assetId: string; path: string; kind: string; createdAt: string }>,
  seen: new Set<string>(),
  pending: new Map<string, NodeJS.Timeout>()
};

function isWatchableOutputFile(filePath: string) {
  // Skip WorkGraph bookkeeping artifacts; only real media/documents flow back.
  if (/[\\/]/.test(path.basename(filePath)) ) return false;
  if (/\.(md|json|jsonl|tmp|part|crdownload)$/i.test(filePath)) return false;
  if (path.basename(filePath).startsWith(".")) return false;
  return /\.(png|jpe?g|webp|gif|svg|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|pdf|docx?|pptx?)$/i.test(filePath);
}

async function registerWatchedOutputFile(absolutePath: string) {
  if (workGraphOutputWatcherState.seen.has(absolutePath)) return;
  if (!existsSync(absolutePath)) return;
  let bytes: Buffer;
  try {
    bytes = readFileSync(absolutePath);
  } catch {
    return;
  }
  if (!bytes.length) return;
  workGraphOutputWatcherState.seen.add(absolutePath);
  const filename = path.basename(absolutePath);
  const mime = "";
  const stored = await storeWorkGraphAssetBuffer(bytes, filename, mime);
  const imageUrl = isPreviewableImageAsset(stored) ? `/workgraph-os/assets/file/${stored.relativePath}` : undefined;
  const assetType: Asset["type"] = stored.kind === "video" ? "generated_video" : stored.kind === "image" ? "generated_image" : "upload";
  const meta = [
    "workgraph-os output watcher",
    `kind:${stored.kind}`,
    `file:${stored.relativePath}`,
    `size:${stored.size}`,
    `source:output-watcher`,
    `origin:${absolutePath}`
  ].join(" ");
  const asset = createAsset(filename.replace(/\.[^.]+$/, "") || "Generated Output", assetType, activeBrand().id, "#94a3b8", meta, imageUrl);
  const companion = await createWorkGraphAssetCompanions({ assetId: asset.id, title: asset.title, stored, brandId: asset.brandId, tags: ["output", stored.kind] });
  asset.meta = [asset.meta, `thumbnail:${companion.thumbnailRelativePath}`, `version:${companion.versionRelativePath}`, `usage:${companion.usageRelativePath}`].join(" ");
  db.assets.unshift(asset);
  await persistDb();
  const workspace = await readWorkGraphOsWorkspace();
  if (workspace) {
    const material = workGraphAssetPayload(asset);
    await writeWorkGraphOsWorkspace({
      ...workspace,
      materials: [material, ...workspace.materials.filter((item) => objectString(item, "id", "") !== asset.id)],
      updatedAt: now()
    });
  }
  workGraphOutputWatcherState.registered.unshift({ assetId: asset.id, path: absolutePath, kind: stored.kind, createdAt: asset.createdAt });
  workGraphOutputWatcherState.registered = workGraphOutputWatcherState.registered.slice(0, 200);
  console.log(`WorkGraph output watcher registered asset ${asset.id} from ${absolutePath}`);
}

function scheduleWatchedOutputFile(absolutePath: string) {
  // Debounce so a file is only imported once it has finished being written.
  const existing = workGraphOutputWatcherState.pending.get(absolutePath);
  if (existing) clearTimeout(existing);
  workGraphOutputWatcherState.pending.set(absolutePath, setTimeout(() => {
    workGraphOutputWatcherState.pending.delete(absolutePath);
    registerWatchedOutputFile(absolutePath).catch((error) => console.warn(`WorkGraph output watcher failed for ${absolutePath}: ${(error as Error).message}`));
  }, 750));
}

async function startWorkGraphOutputWatcher() {
  if (!workGraphOsOutputWatchEnabled) return;
  const dirs = workGraphOsWatchDirs();
  const watched: string[] = [];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    try {
      fsWatch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const absolutePath = path.resolve(dir, filename.toString());
        if (!isWatchableOutputFile(absolutePath)) return;
        scheduleWatchedOutputFile(absolutePath);
      });
      watched.push(dir);
    } catch (error) {
      console.warn(`WorkGraph output watcher could not start on ${dir}: ${(error as Error).message}`);
    }
  }
  workGraphOutputWatcherState.active = watched.length > 0;
  workGraphOutputWatcherState.dirs = watched;
  if (watched.length) console.log(`WorkGraph output watcher active on ${watched.join(", ")}`);
}

app.get("/workgraph-os/outputs", (_req, res) => {
  res.json({
    source: "workgraph-output-watcher",
    enabled: workGraphOutputWatcherState.enabled,
    active: workGraphOutputWatcherState.active,
    dir: workGraphOutputWatcherState.dir,
    dirs: workGraphOutputWatcherState.dirs,
    registeredCount: workGraphOutputWatcherState.registered.length,
    registered: workGraphOutputWatcherState.registered.slice(0, 50)
  });
});

await loadDb();
await startWorkGraphOutputWatcher();
app.listen(port, () => {
  console.log(`SparkCanvas API listening on http://localhost:${port}`);
});
