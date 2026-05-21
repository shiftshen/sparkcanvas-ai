import cors from "cors";
import express from "express";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { z } from "zod";

const DEMO_TOKEN = "demo-token";

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

type Db = {
  user: {
    id: string;
    name: string;
    email: string;
    plan: string;
    credits: number;
  };
  brands: Brand[];
  assets: Asset[];
  frames: CanvasFrame[];
  tasks: GenerationTask[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const dataFile = process.env.SPARKCANVAS_DATA_FILE ?? path.join(dataDir, "sparkcanvas.json");
const projectRoot = path.resolve(__dirname, "../..");
const frontendPublicDir = path.join(projectRoot, "frontend", "public");
const generatedDir = process.env.SPARKCANVAS_GENERATED_DIR ?? path.join(frontendPublicDir, "generated");
const brandUploadDir = path.join(generatedDir, "brand-assets");
const defaultAiBaseUrl = "https://api.yijiarj.cn/v1";
const defaultImageGenBaseUrl = defaultAiBaseUrl;
const isProduction = process.env.NODE_ENV === "production";
const demoAuthEnabled = !isProduction || process.env.SPARKCANVAS_DEMO_AUTH === "true";
const authToken = process.env.SPARKCANVAS_AUTH_TOKEN || (demoAuthEnabled ? DEMO_TOKEN : "");
const adminAccount = process.env.SPARKCANVAS_ADMIN_ACCOUNT;
const adminPassword = process.env.SPARKCANVAS_ADMIN_PASSWORD;
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

const models = [
  { id: "imgen-skill", provider: "otcbot", model: "nano_banana_2", name: "@imgen · image skill", type: "image", costMultiplier: 1, unitCostCny: 0.24, reasoningEffort: "high", description: "默认图片角色，统一走本地 scripts/generate_image.py；默认模型 nano_banana_2，网关和密钥由 IMAGE_GEN_* / auth.json 控制" },
  { id: "yijiarj-nano-banana-2", provider: "yijiarj", model: "nano_banana_2", name: "yijiarj · nano_banana_2", type: "image", costMultiplier: 1, unitCostCny: 0.24, reasoningEffort: "high", description: "默认图片模型，经本地 skill 调用 yijiarj Gemini native image API，支持多图参考；约 ¥0.24/次" },
  { id: "cliproxyapi-gpt-5-4", provider: "cliproxyapi", model: "gpt-5.4", name: "cliproxyapi · gpt-5.4", type: "image", costMultiplier: 1, reasoningEffort: "high", description: "兼容图片模型，本地 image-generation-gpt skill，经 /v1/responses 调用 image_generation" },
  { id: "cliproxyapi-gpt-5", provider: "cliproxyapi", model: "gpt-5", name: "cliproxyapi · gpt-5", type: "image", costMultiplier: 1, reasoningEffort: "high", description: "兼容图片模型，本地 image-generation-gpt skill，经 /v1/responses 调用 image_generation" },
  { id: "yijiarj-grok-video-super", provider: "yijiarj", model: "grok-imagine-1.0-video-super", name: "yijiarj · grok video super", type: "video", costMultiplier: 4, unitCostCny: 0.38, reasoningEffort: "medium", description: "最低成本视频模型；yijiarj /v1/videos；参考图必须传 input_reference 链接；竖屏用 size=720x1280；约 ¥0.38/次，模型池可能临时无可用账号" },
  { id: "yijiarj-grok-video-720p", provider: "yijiarj", model: "grok-imagine-1.0-video-super-720p", name: "yijiarj · grok video 720p", type: "video", costMultiplier: 4, unitCostCny: 0.58, reasoningEffort: "medium", description: "yijiarj /v1/videos；参考图必须传 input_reference 链接；竖屏用 size=720x1280；约 ¥0.58/次" },
  { id: "yijiarj-veo-3-1-fast", provider: "yijiarj", model: "veo_3_1-fast", name: "yijiarj · veo_3_1-fast", type: "video", costMultiplier: 4, unitCostCny: 0.437, reasoningEffort: "medium", description: "VEO 文生/图生；传图时 ad 分组只支持横屏，自动使用 size=1920x1080；链接约 6 小时过期，完成后需下载本地；约 ¥0.437/次" },
  { id: "yijiarj-veo-3-1-fast-fl", provider: "yijiarj", model: "veo_3_1-fast-fl", name: "yijiarj · veo_3_1-fast-fl", type: "video", costMultiplier: 4, reasoningEffort: "medium", description: "VEO 首尾帧模型；不支持纯文生，必须传 input_reference，支持多图用 | 分隔" }
];

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

let db: Db = undefined as unknown as Db;
let persistDbQueue = Promise.resolve();
const runningTimers = new Map<string, NodeJS.Timeout>();
const autoCoreNodeIds = new Set(["input-image", "brand", "prompt", "output", "model"]);

function now() {
  return new Date().toISOString();
}

function isEmptyAutoWorkflowFrame(frame: CanvasFrame) {
  if (frame.prompt.trim()) return false;
  if (!frame.workflowNodes?.length) return true;
  return frame.workflowNodes.every((node) => autoCoreNodeIds.has(node.id));
}

function defaultBrandDetails(brand: Partial<Brand> & Pick<Brand, "id" | "name" | "logoText" | "primaryColor" | "accentColor" | "tone" | "market">): Brand {
  const isXmanx = brand.id === "brand_xmanx" || brand.name.toLowerCase().includes("xmanx");
  const slogan = isXmanx ? "AI-native brand operations for xmanx.com" : `${brand.name} reusable AI brand kit`;
  const industry = isXmanx ? "AI commerce, brand operation, product launch creative" : "commercial content and ecommerce creative";
  const targetAudience = isXmanx ? "xmanx.com 运营、设计、投放和品牌维护团队" : "brand operators, designers and campaign teams";
  const brandStory = isXmanx
    ? "XMANX 将品牌资产、商品素材、IP 形象和投放场景沉淀为可复用的 AI 工作流，帮助团队快速生成一致的电商视觉、社媒内容和维护素材。"
    : `${brand.name} 需要把品牌识别、素材角色和营销语气整理为可重复调用的 AI 生成上下文。`;
  const ipName = isXmanx ? "XM Navigator" : `${brand.logoText} Brand IP`;
  const ipDescription = isXmanx
    ? "冷静、直接、懂电商增长的品牌助理 IP，可出现在教程、片尾和运营物料中。"
    : "可在海报、短视频、说明卡和品牌维护素材中复用的品牌角色。";
  const logoUsage = isXmanx
    ? "优先使用黑底白字或黑橙组合，Logo 保持安全边距，不压住商品主体，片尾或角标露出。"
    : "Logo 应保持清晰、安全边距和品牌色一致，可用于角标、片尾、包装与背景水印。";
  const visualStyle = isXmanx
    ? "黑白基础、橙色强调，清晰商品层级，少装饰，偏高效商业视觉；适合主图、社媒海报、品牌维护画布。"
    : brand.tone;
  const sceneKeywords = isXmanx ? ["studio product hero", "ecommerce launch", "clean black-orange set", "AI workflow dashboard"] : ["product hero", "lifestyle scene", "social campaign"];
  const forbiddenWords = isXmanx ? ["cheap", "low quality", "fake logo", "cluttered layout"] : ["off-brand color", "blurred logo", "messy composition"];
  const assetRoles: BrandAssetRole[] = isXmanx ? [
    { role: "logo", title: "XMANX Logo", description: "黑白/黑橙 Logo，用于角标、片尾和品牌水印。", color: brand.primaryColor },
    { role: "ip", title: "XM Navigator", description: "品牌助理 IP，负责解释 AI 工作流、活动和维护建议。", color: brand.accentColor },
    { role: "product", title: "核心商品素材", description: "需要保持真实比例、材质和卖点层级的商品参考。", color: brand.accentColor },
    { role: "model", title: "固定 AI 模特", description: "用于服装、穿搭、生活方式和社媒场景的可复用模特设定。", color: "#111827" },
    { role: "storefront", title: "xmanx.com 店铺视觉", description: "页面首屏、活动 banner、店铺入口和品牌专区素材。", color: "#f8fafc" },
    { role: "environment", title: "黑橙商业场景", description: "干净棚拍、运动街区、科技电商操作台等背景。", color: "#334155" }
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
    user: {
      id: "user_shift",
      name: "Shift",
      email: "shift@sparkcanvas.local",
      plan: "Pro",
      credits: 1260
    },
    brands,
    assets: [
      createAsset("XMANX Logo 透明底", "logo", "brand_xmanx", "#111827", "XM · transparent", "/brand-assets/optimized/xmanx-logo.jpg"),
      createAsset("黑橙首发运动鞋", "product", "brand_xmanx", "#f97316", "product · launch hero", "/brand-assets/optimized/xmanx-product.jpg"),
      createAsset("XM Navigator IP", "model", "brand_xmanx", "#f97316", "IP · brand assistant", "/brand-assets/optimized/xmanx-ip.jpg"),
      createAsset("固定 AI 模特", "model", "brand_xmanx", "#111827", "model · urban sport", "/brand-assets/optimized/xmanx-model.jpg"),
      createAsset("xmanx.com 店铺视觉", "upload", "brand_xmanx", "#f8fafc", "storefront · campaign landing", "/brand-assets/optimized/xmanx-storefront.jpg")
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
  const knownBrandKeys = new Set(db.brands.flatMap((brand) => [brandKey(brand), normalizeKey(brand.name), brand.id]));
  const refs: ParsedAssetRef[] = [];
  const regex = /(\$)([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prompt)) !== null) {
    const symbol = "$" as const;
    const parts = match[2].split(".");
    const first = normalizeKey(parts[0]);
    const hasBrandPrefix = knownBrandKeys.has(first) && (parts.length === 1 || parts.length > 1);
    const brand = hasBrandPrefix ? first : currentKey;
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
    const brand = ref.explicitBrand ? findBrandByKey(ref.brandKey) : currentBrand;
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
      const brandValue = [
        `${brand.name}: ${brand.slogan}`,
        brand.visualStyle,
        brand.tone,
        brand.sceneKeywords?.length ? `场景: ${brand.sceneKeywords.join(", ")}` : "",
        brand.forbiddenWords?.length ? `禁用: ${brand.forbiddenWords.join(", ")}` : ""
      ].filter(Boolean).join("；");
      textReferences.push({ key: `${brandKey(brand)}.brand_package`, value: brandValue, raw: ref.raw });
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

    const asset = db.assets.find((item) => item.brandId === brand.id && item.imageUrl && assetMatchesPath(item, ref.path));
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
    await migrateDb();
  } catch {
    const backupFile = `${dataFile}.bak`;
    if (existsSync(backupFile)) {
      db = JSON.parse(await readFile(backupFile, "utf8")) as Db;
      await persistDb();
      return;
    }
    db = createSeedDb();
    await persistDb();
  }
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
  if (xmanxBrand && !db.brands.some((brand) => brand.active)) {
    xmanxBrand.active = true;
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
    const model = models.find((item) => item.id === frame.modelId) ?? models[0];
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
    if (!frame.modelId || !frame.modelName || !models.some((item) => item.id === frame.modelId)) {
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
  return `${brandContext}\n\n【本次任务】${taskPrompt}\n\n请按 CAL 1.0 执行：@ 是智能体，/ 是命令，$ 是真实资源，双引号是锁定画面文字，% 是主题标签，: 是参数，-> 是输出。$ 图片资源已作为真实参考图传入 skill；$copy 和 $brand 文本资源已展开。严格保持品牌字段、素材角色、色彩、Logo/IP/商品一致。`;
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

function publicUrlFromLocalAsset(assetUrl?: string) {
  if (!assetUrl?.startsWith("/")) return "";
  const publicBase = (process.env.SPARKCANVAS_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return publicBase ? `${publicBase}${assetUrl}` : "";
}

function videoInputReferenceUrl(imageUrl?: string) {
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return publicUrlFromLocalAsset(imageUrl);
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
  const response = await fetch(videoUrl);
  if (!response.ok) return "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 512) return "";
  await writeFile(outputPath, bytes);
  return outputPath;
}

async function usableVideoFile(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.size > 512;
  } catch {
    return false;
  }
}

async function composeLocalVideos(videoUrls: string[], segments: ReturnType<typeof videoSegmentPlan>, outputName: string) {
  if (!videoUrls.length || videoUrls.length < segments.length || !resolveFfmpegPath()) return "";
  await mkdir(generatedDir, { recursive: true });
  const preparedPaths: string[] = [];
  for (const [index, segment] of segments.entries()) {
    const sourcePath = await materializeVideoUrl(videoUrls[index], outputName, index);
    if (!sourcePath) return "";
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
    if (!ok || !existsSync(segmentPath) || !(await usableVideoFile(segmentPath))) return "";
    preparedPaths.push(segmentPath);
  }
  if (preparedPaths.length === 1) {
    const finalPath = path.join(generatedDir, `${outputName}.mp4`);
    renameSync(preparedPaths[0], finalPath);
    return await usableVideoFile(finalPath) ? `/generated/${outputName}.mp4` : "";
  }
  const listPath = path.join(generatedDir, `${outputName}-concat.txt`);
  const outputPath = path.join(generatedDir, `${outputName}.mp4`);
  const listBody = preparedPaths.map((filePath) => `file '${String(filePath).replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listBody);
  const ok = await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  return ok && existsSync(outputPath) && await usableVideoFile(outputPath) ? `/generated/${outputName}.mp4` : "";
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
  const durationSeconds = videoDurationSeconds(settings);
  const frames = Math.max(1, durationSeconds * 30);
  const { width, height } = videoCanvasSize(settings);
  await mkdir(generatedDir, { recursive: true });
  const outputPath = path.join(generatedDir, `${outputName}.mp4`);
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `zoompan=z='min(1.04,1+0.04*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=30`,
    "format=yuv420p"
  ].join(",");
  const ok = await runFfmpeg([
    "-loop", "1",
    "-i", sourcePath,
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", `[0:v]${filter}[v]`,
    "-map", "[v]",
    "-map", "1:a",
    "-t", String(durationSeconds),
    "-shortest",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ], 180000);
  return ok && existsSync(outputPath) && await usableVideoFile(outputPath) ? `/generated/${outputName}.mp4` : "";
}

function localPublicPathFromUrl(imageUrl?: string) {
  if (!imageUrl?.startsWith("/")) return undefined;
  const relative = imageUrl.replace(/^\/+/, "");
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

function generatedFileRequestAuthorized(req: Request) {
  if (!isProduction) return true;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  return Boolean(authToken && (bearer === authToken || queryToken === authToken));
}

function generatedFileMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!generatedFileRequestAuthorized(req)) return res.status(401).json({ message: "Unauthorized generated file request" });
  next();
}

function generatedFileUrl(url?: string) {
  if (!url?.startsWith("/generated/")) return url;
  if (!isProduction || !authToken) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(authToken)}`;
}

function applyGeneratedFileAuthToFrame(frame: CanvasFrame) {
  if (!isProduction || !authToken) return frame;
  const patchReference = (reference: ReferenceItem): ReferenceItem => ({
    ...reference,
    imageUrl: generatedFileUrl(reference.imageUrl)
  });
  return {
    ...frame,
    workflowNodes: frame.workflowNodes.map((node) => ({
      ...node,
      imageUrl: generatedFileUrl(node.imageUrl),
      fileUrl: generatedFileUrl(node.fileUrl),
      videoUrl: generatedFileUrl(node.videoUrl),
      refs: node.refs?.map(patchReference)
    })),
    outputs: frame.outputs.map((output) => ({
      ...output,
      imageUrl: generatedFileUrl(output.imageUrl),
      fileUrl: generatedFileUrl(output.fileUrl),
      videoUrl: generatedFileUrl(output.videoUrl)
    }))
  };
}

function applyGeneratedFileAuthToWorkspace() {
  if (!isProduction || !authToken) {
    return { brands: db.brands, assets: db.assets, frames: db.frames };
  }
  return {
    brands: db.brands,
    assets: db.assets.map((asset) => ({ ...asset, imageUrl: generatedFileUrl(asset.imageUrl) })),
    frames: db.frames.map(applyGeneratedFileAuthToFrame)
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
      baseUrl: defaultImageGenBaseUrl,
      apiKey: "",
      model: modelName || "gpt-5.4",
      keySource: "disabled",
      baseUrlSource: "disabled"
    };
  }
  const localBaseUrl = localAuthWithSource("IMAGE_GEN_BASE_URL", "YIJIARJ_BASE_URL", "OTCBOT_BASE_URL", "CPA_BASE_URL", "OPENAI_BASE_URL");
  const localApiKey = localAuthWithSource("IMAGE_GEN_KEY", "YIJIARJ_API_KEY", "OTCBOT_API_KEY", "CPA_API_KEY", "OPENAI_API_KEY");
  const baseUrl = process.env.IMAGE_GEN_BASE_URL
    || process.env.YIJIARJ_BASE_URL
    || process.env.OTCBOT_BASE_URL
    || process.env.CPA_BASE_URL
    || process.env.OPENAI_BASE_URL
    || localBaseUrl.value
    || defaultImageGenBaseUrl;
  const apiKey = process.env.IMAGE_GEN_KEY
    || process.env.YIJIARJ_API_KEY
    || process.env.OTCBOT_API_KEY
    || process.env.CPA_API_KEY
    || process.env.OPENAI_API_KEY
    || localApiKey.value;
  return {
    baseUrl,
    apiKey,
    model: modelName || process.env.IMAGE_GEN_MODEL || localAuthValue("IMAGE_GEN_MODEL") || "nano_banana_2",
    keySource: process.env.IMAGE_GEN_KEY ? "IMAGE_GEN_KEY"
      : process.env.YIJIARJ_API_KEY ? "YIJIARJ_API_KEY"
        : process.env.OTCBOT_API_KEY ? "OTCBOT_API_KEY"
          : process.env.CPA_API_KEY ? "CPA_API_KEY"
            : process.env.OPENAI_API_KEY ? "OPENAI_API_KEY"
              : localApiKey.source,
    baseUrlSource: process.env.IMAGE_GEN_BASE_URL ? "IMAGE_GEN_BASE_URL"
      : process.env.YIJIARJ_BASE_URL ? "YIJIARJ_BASE_URL"
        : process.env.OTCBOT_BASE_URL ? "OTCBOT_BASE_URL"
          : process.env.CPA_BASE_URL ? "CPA_BASE_URL"
            : process.env.OPENAI_BASE_URL ? "OPENAI_BASE_URL"
              : localBaseUrl.value ? localBaseUrl.source : "default"
  };
}

function serviceConfig(kind: "text" | "video") {
  if (process.env.SPARKCANVAS_DISABLE_IMAGE_GEN === "1") {
    return {
      baseUrl: defaultAiBaseUrl,
      apiKey: "",
      model: kind === "text" ? "gpt-5.4" : "grok-imagine-1.0-video-super"
    };
  }
  const prefix = kind === "text" ? "TEXT_GEN" : "VIDEO_GEN";
  const modelFallback = kind === "text" ? "gpt-5.4" : "grok-imagine-1.0-video-super";
  const baseUrl = process.env[`${prefix}_BASE_URL`]
    || localAuthValue(`${prefix}_BASE_URL`)
    || process.env.YIJIARJ_BASE_URL
    || localAuthValue("YIJIARJ_BASE_URL")
    || process.env.OPENAI_BASE_URL
    || localAuthValue("OPENAI_BASE_URL")
    || defaultAiBaseUrl;
  const apiKey = process.env[`${prefix}_KEY`]
    || localAuthValue(`${prefix}_KEY`)
    || process.env.YIJIARJ_API_KEY
    || localAuthValue("YIJIARJ_API_KEY")
    || process.env.OPENAI_API_KEY
    || localAuthValue("OPENAI_API_KEY");
  const model = process.env[`${prefix}_MODEL`] || localAuthValue(`${prefix}_MODEL`) || modelFallback;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
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
  const data = await postJson(`${config.baseUrl}/chat/completions`, config.apiKey, {
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
          : urls[0];
        if (composedUrl) {
          output.videoUrl = composedUrl;
          output.copy = appendCopyNote(cleanVideoStatusNotes(output.copy, "ready"), `MP4 文件已生成: ${composedUrl}`);
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
        const composedUrl = urls.length === 1
          ? urls[0]
          : videoIds.length > 1 || videoNeedsCompose(durationSeconds, config.model)
          ? await composeLocalVideos(urls, segmentPlan, `xmanx-${frame.id}-${node.id}-refresh-final`)
          : urls[0];
        if (composedUrl) {
          node.videoUrl = composedUrl;
          node.body = appendCopyNote(cleanVideoStatusNotes(node.body, "ready"), `MP4 文件已生成: ${composedUrl}`);
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
  const inputReference = videoInputReferenceUrl(options.firstFrameUrl);
  if (options.firstFrameUrl && !inputReference && !videoModelNeedsFirstFrameFallback(model)) {
    throw new Error(`${model} 的参考图参数需要公网图片链接。请设置 SPARKCANVAS_PUBLIC_BASE_URL，或先把本地图片上传到图床后再生成视频。`);
  }
  if (options.firstFrameUrl && !inputReference && videoModelNeedsFirstFrameFallback(model)) {
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
  const inputReference = videoInputReferenceUrl(options.firstFrameUrl);
  if (options.firstFrameUrl && !inputReference && !videoModelNeedsFirstFrameFallback(model)) {
    throw new Error(`${model} 的参考图参数需要公网图片链接。请设置 SPARKCANVAS_PUBLIC_BASE_URL，或先把本地图片上传到图床后再生成视频。`);
  }
  if (options.firstFrameUrl && !inputReference && videoModelNeedsFirstFrameFallback(model)) {
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

function aiStatus() {
  const imageConfig = imageGenerationConfig(models[0].model);
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
      provider: imageConfig.model === "nano_banana_2" ? "yijiarj" : "cliproxyapi",
      skill: "scripts/generate_image.py"
    },
    textGeneration: {
      configured: Boolean(textConfig.apiKey && textConfig.baseUrl),
      baseUrl: textConfig.baseUrl,
      model: textConfig.model,
      provider: "yijiarj"
    },
    videoGeneration: {
      configured: Boolean(videoConfig.apiKey && videoConfig.baseUrl),
      baseUrl: videoConfig.baseUrl,
      model: videoConfig.model,
      provider: "yijiarj"
    }
  };
}

async function imageSkillDiagnostics() {
  const imageConfig = imageGenerationConfig(models[0].model);
  const scriptPath = path.join(projectRoot, "scripts", "generate_image.py");
  const scriptExists = existsSync(scriptPath);
  if (!scriptExists) {
    return {
      ...aiStatus(),
      runtime: {
        scriptExists,
        helpOk: false,
        message: "scripts/generate_image.py not found"
      }
    };
  }

  const helpResult = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    const child = spawn("python3", [scriptPath, "--help"], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, message: "python3 --help timed out" });
    }, 5000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, message: output.slice(0, 180) || `python exited with code ${code}` });
    });
  });

  return {
    ...aiStatus(),
    runtime: {
      scriptExists,
      helpOk: helpResult.ok,
      message: helpResult.message,
      canAttemptGeneration: Boolean(imageConfig.apiKey && scriptExists && helpResult.ok)
    }
  };
}

function modelDiagnostics() {
  const imageConfig = imageGenerationConfig(models[0].model);
  const textConfig = serviceConfig("text");
  const videoConfig = serviceConfig("video");
  return models.map((item) => {
    const isImage = item.type === "image";
    const isVideo = item.type === "video";
    const configured = isImage
      ? Boolean(imageConfig.apiKey && imageConfig.baseUrl)
      : isVideo
        ? Boolean(videoConfig.apiKey && videoConfig.baseUrl)
        : Boolean(textConfig.apiKey && textConfig.baseUrl);
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      provider: item.provider,
      model: item.model ?? imageConfig.model,
      unitCostCny: "unitCostCny" in item ? item.unitCostCny : undefined,
      clipSeconds: isVideo ? videoModelClipSeconds(item.model) : undefined,
      configured,
      route: isImage ? "scripts/generate_image.py" : isVideo ? `${videoConfig.baseUrl}/videos` : `${textConfig.baseUrl}/chat/completions`,
      status: item.id === "imgen-skill" ? "recommended" : configured ? "candidate" : "missing_key",
      note: item.id === "imgen-skill"
        ? "默认推荐。@imgen 会走本地 skill，并把 $ 引用图片真实传入。"
        : item.description
    };
  });
}

async function probeModel(modelId: string, prompt?: string) {
  const model = models.find((item) => item.id === modelId);
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

function imageExtensionForSkill(format: "png" | "jpeg" | "webp") {
  return format === "jpeg" ? "jpg" : format;
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

async function runImageGenerationSkill(prompt: string, references: ReferenceItem[], outputName: string, modelName?: string, settings?: Partial<GenerationSettings>, timeoutMs = Number(process.env.IMAGE_GEN_TIMEOUT_MS ?? "180000"), outputFormat: "png" | "jpeg" | "webp" = "png") {
  const imageConfig = imageGenerationConfig(modelName);
  if (!imageConfig.apiKey || !imageConfig.baseUrl) return undefined;

  await mkdir(generatedDir, { recursive: true });
  const filename = `${outputName}.${imageExtensionForSkill(outputFormat)}`;
  const outputPath = path.join(generatedDir, filename);
  const args = [
    path.join(projectRoot, "scripts", "generate_image.py"),
    "--prompt",
    prompt,
    "--output",
    outputPath,
    "--format",
    outputFormat,
    "--model",
    imageConfig.model,
    "--aspect-ratio",
    ratioForImageSkill(settings?.ratio),
    "--image-size",
    settings?.quality === "ultra" ? "4K" : "2K",
    "--retries",
    "4",
    "--session-id",
    `sparkcanvas-${outputName}`
  ];
  const maxReferences = Math.max(1, Math.min(6, Number(process.env.IMAGE_GEN_MAX_REFERENCES ?? "3")));
  const usableReferences = references.filter((reference) => reference.imageUrl).slice(0, maxReferences);
  for (const [index, reference] of usableReferences.entries()) {
    const filePath = await materializeReferenceImage(reference, outputName, index);
    if (filePath) args.push("--input-image", filePath);
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const child = spawn("python3", args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        IMAGE_GEN_BASE_URL: imageConfig.baseUrl,
        IMAGE_GEN_KEY: imageConfig.apiKey,
        IMAGE_GEN_MODEL: imageConfig.model
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`image generation skill timed out after ${Math.round(timeoutMs / 1000)}s for model ${imageConfig.model}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        const actualExt = detectImageExtension(outputPath);
        if (!actualExt) return reject(new Error("image generation skill did not produce a valid PNG/JPEG/WEBP file"));
        const expectedExt = imageExtensionForSkill(outputFormat);
        if (actualExt && actualExt !== expectedExt) {
          const actualName = `${outputName}.${actualExt}`;
          renameSync(outputPath, path.join(generatedDir, actualName));
          return resolve(`/generated/${actualName}`);
        }
        return resolve(`/generated/${filename}`);
      }
      reject(new Error(stderr || stdout || `image generation skill exited with code ${code}`));
    });
  });
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
  const fallbackImage = fallbackImageDataUrl("Skill unavailable");
  const referenceFallbackImage = refs.find((reference) => ["product", "ip", "model", "storefront", "environment", "logo"].includes(reference.role))?.imageUrl;
  const model = models.find((item) => item.id === frame.modelId) ?? models[0];
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
        sharedVisualNote = `主视觉使用降级预览：${error instanceof Error ? error.message.slice(0, 120) : "image skill unavailable"}`;
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
        output.copy = appendCopyNote(output.copy, `图片生成降级：${error instanceof Error ? error.message.slice(0, 120) : "image skill unavailable"}`);
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
          description: "由图片 skill 使用品牌素材生成，作为视频一致性锚点。",
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
        output.copy = appendCopyNote(output.copy, `视频分镜板生成降级：${error instanceof Error ? error.message.slice(0, 100) : "image skill unavailable"}`);
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
          output.copy = appendCopyNote(output.copy, `视频关键帧 ${shotIndex + 1} 生成降级：${error instanceof Error ? error.message.slice(0, 100) : "image skill unavailable"}`);
        }
      }
      const firstFrameUrl = keyframeUrls[0] ?? sharedVisualUrl;
      output.imageUrl = firstFrameUrl ?? output.imageUrl;
      const keyframeRefs = keyframeUrls.map((imageUrl, shotIndex) => ({
        id: `video_keyframe_${frame.id}_${index}_${shotIndex}`,
        role: shotIndex === 0 ? "first-frame" : "keyframe",
        title: `视频关键帧 ${shotIndex + 1}/${keyframeCount}`,
        description: `由图片 skill 根据真实品牌素材生成，用于 ${durationSeconds}s 视频第 ${shotIndex + 1} 段视觉一致性。`,
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
            : videoUrls[0];
          if (composedUrl) output.videoUrl = composedUrl;
          else if (!videoNeedsCompose(durationSeconds, workflowVideoModel)) output.videoUrl = videoUrls[0];
        }
        if (output.videoUrl && firstFrameUrl) output.imageUrl = firstFrameUrl;
        if (fallbackReasons.length) output.copy = appendCopyNote(output.copy, fallbackReasons[0]);
        if (segmentResults.some((video) => video?.usedFirstFrame)) output.copy = appendCopyNote(output.copy, `已提交图片 skill 首帧/关键帧约束视频模型，使用 ${videoPromptRefs.filter((reference) => reference.role !== "first-frame").length} 张品牌参考图生成。`);
        if (videoUrls.length === segmentPlan.length && videoNeedsCompose(durationSeconds, workflowVideoModel)) {
          output.copy = appendCopyNote(output.copy, output.videoUrl
            ? `所有分段视频已返回并完成裁切/合成: ${output.videoUrl}`
            : "所有分段视频已返回 URL，但本地未完成裁切/合成；需要 ffmpeg 或远端合成服务生成最终 MP4。");
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
  const model = models.find((item) => item.id === requestedModelId) ?? models[0];
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
    workflowNodes: requestedWorkflowNodes ?? buildWorkflowNodes(prompt, brand, model, settings, brandContext, settings.brandInject),
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
  const model = models[0];
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

function buildWorkflowNodes(prompt: string, brand: Brand | undefined, model: (typeof models)[number], settings: GenerationSettings, brandContext = brand ? buildBrandContext(brand) : "", brandInjected = settings.brandInject) {
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
          body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 先用图片 skill 生成/锁定视频首帧，再把首帧提交给视频模型做图生视频；如果模型不接受首帧，必须在输出状态中明确降级。`,
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
  return nodes;
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

const app = express();
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
if (isProduction && !authToken) {
  throw new Error("Production auth is not configured. Set SPARKCANVAS_AUTH_TOKEN or explicitly enable SPARKCANVAS_DEMO_AUTH=true.");
}
app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
  credentials: false
}));
app.use(express.json({ limit: "20mb" }));
app.use("/generated", generatedFileMiddleware, express.static(generatedDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sparkcanvas-api", domain: "xmanx.com" });
});

app.post("/auth/login", (req, res) => {
  const parsed = z.object({ account: z.string(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid login payload" });
  const demoMatch = demoAuthEnabled && parsed.data.account === "shift" && parsed.data.password === "123456";
  const adminMatch = Boolean(adminAccount && adminPassword && parsed.data.account === adminAccount && parsed.data.password === adminPassword);
  if (!demoMatch && !adminMatch) {
    return res.status(401).json({ message: "Invalid demo account or password" });
  }
  res.json({ token: authToken, user: db.user });
});

app.use((req, res, next) => {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!authToken || token !== authToken) return res.status(401).json({ message: "Unauthorized" });
  next();
});

app.get("/me", (_req, res) => {
  res.json(db.user);
});

app.post("/me/credits/refill", async (_req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_CREDIT_REFILL !== "true") {
    return res.status(403).json({ message: "Demo credit refill is disabled in production" });
  }
  db.user.credits = Math.max(db.user.credits, 1260);
  await persistDb();
  res.json(db.user);
});

app.get("/workspace", async (_req, res) => {
  await repairInterruptedGenerations();
  await refreshPendingVideoOutputs();
  const workspace = applyGeneratedFileAuthToWorkspace();
  res.json({ user: db.user, brands: workspace.brands, assets: workspace.assets, templates, models, frames: workspace.frames, tasks: db.tasks, ai: aiStatus() });
});

app.get("/workspace/export", (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="sparkcanvas-workspace-${Date.now()}.json"`);
  res.json({
    exportedAt: now(),
    domain: "xmanx.com",
    workspace: { user: db.user, brands: db.brands, assets: db.assets, templates, models, frames: db.frames, tasks: db.tasks }
  });
});

app.get("/brands", (_req, res) => {
  res.json(db.brands);
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
  res.json(models);
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
    const model = models.find((item) => item.id === input.modelId);
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

  const model = models.find((item) => item.id === frame.modelId) ?? models[0];
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
    const rebuiltNodes = buildWorkflowNodes(frame.prompt, hasFrameBrand ? brand : undefined, model, frame.settings, frame.brandContext, frame.brandInjected);
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
    const model = models.find((item) => item.id === input.modelId);
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
  db.user.credits = Math.max(0, db.user.credits - frame.cost);
  db.tasks.unshift(task);
  await persistDb();
  void completeTask(taskId);
  res.status(202).json({ taskId, task, frame, credits: db.user.credits });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(409).json({ message: "Node not synced yet. Save canvas workflow before generation." });

  const input = z.object({
    prompt: z.string().min(1).optional(),
    modelId: z.string().optional(),
    settings: generationSettingsPatchSchema.optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const colors = neutralBrandColor(brand);
  const selectedModel = models.find((item) => item.id === input.modelId) ?? models.find((item) => item.id === frame.modelId) ?? models[0];
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
  let imageUrl = fallbackImageDataUrl("Skill unavailable");
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

  node.body = input.prompt?.trim() || node.body || frame.prompt;
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
  res.json({ frame, node, imageUrl, generated, message: generated ? "图片已由本地 skill 生成。" : generationNote });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-text", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
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

  node.body = generatedText;
  node.title = node.title || "Text";
  node.type = "process";
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame, node, text: generatedText, mode: textMode, model: input.model ?? serviceConfig("text").model });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-script", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
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
  res.json({ frame, node, script, model: input.model ?? serviceConfig("text").model });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-video", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
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
  let firstFrameNote = "";
  const durationSeconds = videoDurationSeconds(settings);
  const segmentPlan = videoSegmentPlan(durationSeconds, selectedVideoModel);
  const keyframeCount = videoKeyframeCount(durationSeconds);
  const generatedKeyframeRefs: ReferenceItem[] = [];
  let storyboardSheetRef: ReferenceItem | undefined;
  if (videoRefs.length) {
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
      firstFrameNote = `视频分镜板生成失败，继续生成单镜头首帧：${error instanceof Error ? error.message.slice(0, 140) : "image skill unavailable"}`;
    }
  }
  if (videoRefs.length) {
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
          firstFrameNote = `已先用图片 skill 和 ${videoRefs.length} 张参考素材生成视频首帧。`;
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
      firstFrameNote = `视频关键帧生成失败，继续使用视频模型自身能力：${error instanceof Error ? error.message.slice(0, 140) : "image skill unavailable"}`;
    }
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
  try {
    const segmentResults: VideoRunResult[] = [];
    const segmentFirstFrames = [firstFrameUrl, ...generatedKeyframeRefs.map((reference) => reference.imageUrl).filter(Boolean)];
    for (const segment of segmentPlan) {
      const segmentFirstFrame = segmentFirstFrames[segment.index] ?? firstFrameUrl;
      const segmentSettings = { ...settings, duration: `${segment.modelSeconds}s`, mode: effectiveVideoMode };
      const segmentPrompt = [
        executableVideoPrompt(sourcePrompt, contextBrand, segmentSettings, videoPromptRefs),
        `Segment ${segment.index + 1}/${segmentPlan.length}: generate a ${segment.modelSeconds}s source clip for final ${segment.targetSeconds}s${segment.trim ? "; final editor trims the beginning to target duration" : ""}.`,
        "Keep the same character, logo, store/product environment, voice tone, language and BGM bed across all segments."
      ].join("\n");
      const result = segmentPlan.length === 1
        ? await runVideoGeneration(segmentPrompt, selectedVideoModel, segmentSettings, { firstFrameUrl: segmentFirstFrame })
        : await createVideoGenerationJob(segmentPrompt, selectedVideoModel, segmentSettings, Number(process.env.WORKFLOW_VIDEO_CREATE_TIMEOUT_MS ?? "45000"), { firstFrameUrl: segmentFirstFrame });
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
        : sourceVideoUrls[0];
      if (composedUrl) videoUrl = composedUrl;
    }
    if (videoUrl) {
      generationLines = [
        videoId ? `视频ID: ${videoId}` : "视频ID: completed",
        `视频URL: ${videoUrl}`,
        usedFirstFrame ? "执行状态: 已由视频模型按首帧图生视频生成，并完成最终时长裁切/合成。" : "执行状态: 已由视频模型生成，并完成最终时长裁切/合成。"
      ];
    } else if (videoId) {
      generationLines = [
        `视频ID: ${videoId}`,
        sourceVideoUrls.length ? `源片URL: ${sourceVideoUrls.join(" / ")}` : "",
          videoNeedsCompose(durationSeconds, selectedVideoModel)
          ? "执行状态: 视频片段任务已创建；最终 MP4 需要等待片段 videoUrl 后进入合成/裁切。"
          : "执行状态: 视频任务已创建但仍在生成，可用 /v1/videos/{video_id} 查询。"
      ].filter(Boolean);
    }
  } catch (error) {
    generationLines = [`执行状态: 视频生成请求失败，${error instanceof Error ? error.message.slice(0, 180) : "unavailable"}`];
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
      description: usedFirstFrame ? "已作为 input_reference 提交给视频模型。" : "由图片 skill/画布输出生成，用于人工检查视频一致性。",
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
  res.json({ frame, node, videoPlan, model: input.model ?? serviceConfig("video").model, videoId, videoUrl });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-audio", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
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
  const audioPlan = [
    prompt,
    "",
    `音频类型: ${settings.mode ?? "配乐"}`,
    `模型: ${input.model ?? "cliproxyapi · gpt-5.4"}`,
    `时长: ${settings.duration ?? "15s"}`,
    `场景: ${settings.scene ?? "广告短视频"}`,
    `语言: ${contentLanguageLabel(contentLanguage)}`,
    `循环: ${settings.loop ? "开启" : "关闭"}`,
    `翻译: ${settings.translate ? "开启" : "关闭"}`,
    `CAL解析: ${JSON.stringify({ agents: resolved.agents, commands: resolved.commands, imageReferences: resolved.imageReferences.map((item) => item.description), textReferences: resolved.textReferences, lockedTexts: resolved.lockedTexts, tags: resolved.tags, params: resolved.params, outputs: resolved.outputs })}`,
    `品牌约束: ${brandLabel(contextBrand)}; ${brandTone(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
    "执行状态: 已保存音频生成配置，等待接入真实音频生成 skill。"
  ].join("\n");

  node.type = "audio";
  node.title = node.title || "Audio";
  node.body = audioPlan;
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame, node, audioPlan, model: input.model ?? "cliproxyapi · gpt-5.4" });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-compose", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
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
  const mergedUrl = segmentUrls.length >= segmentPlan.length ? await composeLocalVideos(segmentUrls, segmentPlan, `xmanx-${frame.id}-${node.id}-merged`) : "";
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
    `配音规则: 每段单独生成旁白/音效提示，但统一语言、音色、响度、BGM 音色和节奏；不要让用户听出两个不配套的视频。`,
    `语言: ${contentLanguageLabel(settings.contentLanguage ?? frame.settings.contentLanguage)}`,
    `品牌约束: ${brandLabel(brand)}; ${brandTone(brand)}; ${brandVisualStyle(brand)}`,
    refs.length ? `视觉引用: ${refs.map((reference) => `${reference.role}:${reference.title}`).join(" / ")}` : "视觉引用: 无",
    mergedUrl ? `执行状态: 已用 ffmpeg 完成裁切/合成 ${mergedUrl}` : segmentUrls.length >= segmentPlan.length ? "执行状态: 片段存在但本地未完成裁切/合成，请检查 ffmpeg 或远端视频下载状态。" : "执行状态: 已保存合成计划，等待视频片段全部生成。"
  ].filter(Boolean).join("\n");

  node.type = "compose";
  node.title = node.title || "视频合成剪辑";
  node.body = composePlan;
  node.refs = refs;
  const targetOutput = frame.outputs.find((output) => output.kind === "video");
  if (targetOutput) {
    if (mergedUrl) targetOutput.videoUrl = mergedUrl;
    targetOutput.copy = appendCopyNote(targetOutput.copy, mergedUrl
      ? `最终 MP4 已合成: ${mergedUrl}`
      : `视频合成计划已生成：${segmentPlan.length} 段，等待片段 videoUrl 后裁切/合成。`);
  }
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame, node, composePlan, mergedUrl, segments: segmentPlan.map((segment) => segment.targetSeconds), segmentPlan });
});

app.get("/tasks/:id", (req, res) => {
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ message: "Task not found" });
  const frame = db.frames.find((item) => item.id === task.frameId);
  res.json({ task, frame, credits: db.user.credits });
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

  db.user.credits = Math.max(0, db.user.credits - frame.cost);
  db.frames.unshift(frame);
  db.tasks.unshift(task);
  await persistDb();
  void completeTask(taskId);
  res.status(201).json({ taskId, task, frame, credits: db.user.credits });
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
await loadDb();
app.listen(port, () => {
  console.log(`SparkCanvas API listening on http://localhost:${port}`);
});
