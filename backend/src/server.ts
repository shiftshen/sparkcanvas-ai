import cors from "cors";
import express from "express";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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
  outputs: Array<{ id: string; title: string; kind: OutputKind; gradient: string; copy: string; imageUrl?: string; videoId?: string; videoUrl?: string }>;
  createdAt: string;
  updatedAt: string;
};

type OutputKind = "image" | "video" | "document";
type WorkflowOutputTarget = "jpg" | "png" | "poster" | "pdf" | "mp4" | "kit";
type WorkflowOrientation = "square" | "portrait" | "landscape";

type WorkflowNode = {
  id: string;
  type: "image" | "brand" | "prompt" | "model" | "output" | "reference" | "process" | "script" | "video" | "compose" | "audio";
  title: string;
  body: string;
  parentId?: string;
  preview?: string;
  refs?: ReferenceItem[];
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
  count: number;
  quality: "standard" | "hd" | "ultra";
  strength: number;
  duration: number;
  brandInject: boolean;
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
const generatedDir = path.join(frontendPublicDir, "generated");
const defaultAiBaseUrl = "https://api.yijiarj.cn/v1";
const defaultImageGenBaseUrl = defaultAiBaseUrl;

const templates = [
  { id: "tpl_amazon", title: "Amazon 主图", category: "电商", cost: 8, ratio: "1:1", intent: "white background product hero with logo-safe margin" },
  { id: "tpl_xhs", title: "小红书种草", category: "社媒", cost: 12, ratio: "3:4", intent: "lifestyle poster with product benefits and warm scene" },
  { id: "tpl_video", title: "15 秒带货视频", category: "视频", cost: 36, ratio: "9:16", intent: "short product video storyboard with model and brand ending card" },
  { id: "tpl_batch", title: "批量换背景", category: "效率", cost: 18, ratio: "multi", intent: "remove background and generate three campaign scenes" },
  { id: "tpl_brandkit", title: "品牌套装维护", category: "品牌", cost: 10, ratio: "kit", intent: "refresh brand system with logo lockup, color cards, campaign copy and reusable scenes" }
];

const models = [
  { id: "imgen-skill", provider: "otcbot", model: "nano_banana_2", name: "@imgen · image skill", type: "image", costMultiplier: 1, reasoningEffort: "high", description: "默认图片角色，统一走本地 scripts/generate_image.py；默认模型 nano_banana_2，网关和密钥由 IMAGE_GEN_* / auth.json 控制" },
  { id: "yijiarj-nano-banana-2", provider: "yijiarj", model: "nano_banana_2", name: "yijiarj · nano_banana_2", type: "image", costMultiplier: 1, reasoningEffort: "high", description: "默认图片模型，经本地 skill 调用 yijiarj Gemini native image API，支持多图参考" },
  { id: "cliproxyapi-gpt-5-4", provider: "cliproxyapi", model: "gpt-5.4", name: "cliproxyapi · gpt-5.4", type: "image", costMultiplier: 1, reasoningEffort: "high", description: "兼容图片模型，本地 image-generation-gpt skill，经 /v1/responses 调用 image_generation" },
  { id: "cliproxyapi-gpt-5", provider: "cliproxyapi", model: "gpt-5", name: "cliproxyapi · gpt-5", type: "image", costMultiplier: 1, reasoningEffort: "high", description: "兼容图片模型，本地 image-generation-gpt skill，经 /v1/responses 调用 image_generation" },
  { id: "yijiarj-grok-video-720p", provider: "yijiarj", model: "grok-imagine-1.0-video-super-720p", name: "yijiarj · grok video 720p", type: "video", costMultiplier: 4, reasoningEffort: "medium", description: "当前可用视频模型，经 yijiarj /v1/videos 创建并轮询任务" },
  { id: "yijiarj-veo-3-1-fast", provider: "yijiarj", model: "veo_3_1-fast", name: "yijiarj · veo_3_1-fast", type: "video", costMultiplier: 4, reasoningEffort: "medium", description: "候选视频模型，当前账号通道可能不可用" }
];

const assetRoleSchema = z.object({
  role: z.enum(["logo", "ip", "product", "model", "storefront", "environment", "menu", "equipment", "general"]),
  title: z.string().min(1),
  description: z.string().min(1),
  color: z.string().optional()
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
  active: z.boolean().optional()
});

const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "brand", "prompt", "model", "output", "reference", "process", "script", "video", "compose", "audio"]),
  title: z.string().min(1),
  body: z.string(),
  parentId: z.string().optional(),
  preview: z.string().optional(),
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
  videoId: z.string().optional(),
  videoUrl: z.string().optional()
});

let db: Db = undefined as unknown as Db;
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

function assetTypeToReferenceRole(type: Asset["type"], title = ""): BrandAssetRole["role"] {
  if (type === "logo") return "logo";
  if (type === "product") return "product";
  if (type === "model" && /ip|navigator|mascot|角色|吉祥物|主理人/i.test(title)) return "ip";
  if (type === "model") return "model";
  if (type === "upload" && /store|storefront|店铺|门店|官网|直播间|电商页面/i.test(title)) return "storefront";
  if (type === "upload" && /environment|scene|background|环境|场景|背景|空间|氛围/i.test(title)) return "environment";
  if (type === "upload") return "general";
  return "general";
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
  const marketKey = normalizeKey(brand.market.split(/\s+/)[0] ?? "");
  return marketKey || normalizeKey(brand.name) || brand.id;
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

function settingsForFinalOutput(target: WorkflowOutputTarget, orientation: WorkflowOrientation, settings?: Partial<GenerationSettings>) {
  const ratio = target === "mp4" || target === "kit"
    ? orientation === "portrait" ? "9:16" : "16:9"
    : settings?.ratio ?? "1:1";
  return {
    ...settings,
    ratio,
    count: 1,
    quality: settings?.quality ?? "hd",
    strength: settings?.strength ?? 70,
    duration: target === "mp4" || target === "kit" ? Math.max(settings?.duration ?? 5, 5) : 0
  };
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
  const regex = /([\p{L}\p{N}_\-.]+)\s*:\s*([^，,\n|]+?)(?=\s*->|[，,\n|]|$)/gu;
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
  if (!pathKey) return true;
  const role = assetTypeToReferenceRole(asset.type, asset.title);
  const text = `${asset.title} ${asset.meta}`.toLowerCase();
  const [head, ...rest] = pathKey.split(".");
  if (head === "brand") return role === "logo";
  if (head === "background" || head === "scene") return role === "environment" || role === "storefront" || role === "general";
  if (head !== role && !(head === "store" && role === "storefront")) return false;
  return rest.length === 0 || rest.every((part) => text.includes(part.replace(/_/g, " ")));
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
      expandedPrompt = expandedPrompt.split(ref.raw).join(`参考品牌 ${brand.name} 的完整品牌素材、视觉风格和文案约束`);
      continue;
    }
    if (ref.type === "text") {
      const value = textValueForPath(brand, ref.path);
      if (!value) {
        warnings.push(`未找到文本资源 $${ref.fullKey}`);
        continue;
      }
      textReferences.push({ key: ref.fullKey, value, raw: ref.raw });
      expandedPrompt = expandedPrompt.split(ref.raw).join(`"${value}"`);
      continue;
    }

    const asset = db.assets.find((item) => item.brandId === brand.id && item.imageUrl && assetMatchesPath(item, ref.path));
    if (!asset?.imageUrl) {
      warnings.push(`未找到图片资源 $${ref.fullKey}`);
      continue;
    }
    imageReferences.push({
      id: `asset_${asset.id}`,
      role: assetTypeToReferenceRole(asset.type, asset.title),
      title: asset.title,
      description: `${ref.fullKey} · ${asset.meta}`,
      color: asset.color,
      imageUrl: asset.imageUrl
    });
    expandedPrompt = expandedPrompt.split(ref.raw).join(`参考图片 ${ref.fullKey}（${asset.title}）`);
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

  const beforeAssetCleanupCount = db.assets.length;
  db.assets = db.assets.filter((asset) => !asset.title.startsWith("新商品素材") && asset.meta !== "manual · ready for generation");
  if (db.assets.length !== beforeAssetCleanupCount) changed = true;

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

  const beforeFrameCount = db.frames.length;
  db.frames = db.frames.filter((frame) => (
    frame.prompt.trim().toLowerCase() !== "x man x"
    && !frame.prompt.startsWith("Amazon 主图")
    && !frame.prompt.startsWith("小红书种草")
    && !frame.prompt.includes("夏季连衣裙")
  ));
  if (db.frames.length !== beforeFrameCount) changed = true;
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

  for (const frame of db.frames) {
    const originalBrandId = frame.brandId;
    const brand = findBrand(frame.brandId);
    const model = models.find((item) => item.id === frame.modelId) ?? models[0];
    if (!frame.settings) {
      frame.settings = defaultSettings(frame.prompt);
      changed = true;
    }
    if (typeof frame.settings.brandInject !== "boolean") {
      frame.settings.brandInject = true;
      changed = true;
    }
    if (!originalBrandId || !db.brands.some((item) => item.id === originalBrandId) || frame.brandName !== brand.name) {
      frame.brandId = brand.id;
      frame.brandName = brand.name;
      frame.brandInjected = frame.settings.brandInject;
      frame.brandContext = frame.brandInjected ? buildBrandContext(brand) : "";
      frame.finalPrompt = buildFinalPrompt(frame.prompt, buildBrandContext(brand), frame.brandInjected, brand);
      changed = true;
    }
    if (frame.brandInjected && !frame.brandContext.startsWith("$copy.brand_name")) {
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
      frame.workflowNodes = mergeWorkflowNodes(buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || buildBrandContext(brand), frame.brandInjected), frame.workflowNodes);
      changed = true;
    }
    const referenceNodeTitles = frame.workflowNodes.filter((node) => node.type === "reference").map((node) => node.title);
    if (referenceNodeTitles.length > new Set(referenceNodeTitles).size) {
      frame.workflowNodes = buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || buildBrandContext(brand), frame.brandInjected);
      changed = true;
    }
    const beforeAutoReferenceCleanup = frame.workflowNodes.length;
    frame.workflowNodes = frame.workflowNodes.filter((node) => !node.id.startsWith("ref-") && node.id !== "model");
    if (frame.workflowNodes.length !== beforeAutoReferenceCleanup) changed = true;
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
      const fallback = buildWorkflowNodes(frame.prompt, brand, model, frame.settings, frame.brandContext || buildBrandContext(brand), frame.brandInjected).find((item) => item.id === node.id);
      return { ...node, x: node.x ?? fallback?.x ?? 120 + index * 245, y: node.y ?? fallback?.y ?? 220, w: node.w ?? fallback?.w ?? 240, h: node.h ?? fallback?.h ?? 220 };
    });
    const inputNode = frame.workflowNodes.find((node) => node.id === "input-image");
    if (inputNode) {
      const nextRefs = buildReferenceItems(brand);
      if (JSON.stringify(inputNode.refs ?? []) !== JSON.stringify(nextRefs)) {
        inputNode.refs = nextRefs;
        inputNode.body = nextRefs.map((asset) => `${asset.role}: ${asset.title}`).join(" / ");
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
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(db, null, 2));
}

async function repairInterruptedGenerations() {
  let changed = false;
  for (const frame of db.frames) {
    if (frame.status !== "generating") continue;
    const task = db.tasks.find((item) => item.id === frame.taskId);
    if (task && runningTimers.has(task.id)) continue;
    ensureFrameOutputPreviews(frame, "上次生成被中断，已自动补齐可见预览。");
    frame.status = "success";
    frame.progress = 100;
    frame.updatedAt = now();
    if (task && task.status !== "completed") {
      task.status = "completed";
      task.progress = frame.progress;
      task.updatedAt = now();
      task.completedAt = now();
    }
    changed = true;
  }
  for (const frame of db.frames) {
    if (frame.status !== "success" || !frame.outputs.some((output) => !output.imageUrl)) continue;
    ensureFrameOutputPreviews(frame, "历史工作流已补齐可见预览。");
    frame.updatedAt = now();
    changed = true;
  }
  if (changed) await persistDb();
}

function activeBrand() {
  return db.brands.find((brand) => brand.active) ?? db.brands[0];
}

function findBrand(brandId?: string) {
  return (brandId ? db.brands.find((brand) => brand.id === brandId) : undefined) ?? activeBrand();
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
  return {
    ratio: prompt.includes("视频") ? "9:16" : "1:1",
    count: 1,
    quality: "hd",
    strength: 70,
    duration: prompt.includes("视频") ? 15 : 0,
    brandInject: false,
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
    general: "$asset",
    upload: "$asset"
    };
    return map[role] ?? "$asset";
  };
  const roleLines = brand.assetRoles.map((asset) => `${mentionForRole(asset.role)} ${asset.title}；${asset.description}`).join("\n");
  const materialLines = db.assets
    .filter((asset) => asset.brandId === brand.id && !asset.type.startsWith("generated_") && asset.imageUrl)
    .slice(0, 12)
    .map((asset) => `${mentionForRole(assetTypeToReferenceRole(asset.type, asset.title))} ${asset.title} [image]；${asset.meta}`)
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

function optimizeWorkflowPrompt(input: string, brand: Brand | undefined, target: WorkflowOutputTarget, orientation: WorkflowOrientation) {
  const normalized = normalizeLegacyPromptRefs(input).trim();
  const withoutOutput = normalized.replace(/->\s*.+$/gmu, "").trim();
  const hasCal = /[@$/%]/u.test(withoutOutput);
  const command = commandForFinalOutput(target);
  const refs = availableCalRefs(brand);
  const outputTargets = outputTargetsForFinal(target);
  const orientationTag = target === "mp4" || target === "kit" ? tagForOrientation(orientation) : "";
  const brandHint = brand && !brandReferenceKeys(brand).some((key) => key && normalizeKey(withoutOutput).includes(key)) ? `为 ${brandKey(brand)}` : "";
  const targetHint = target === "mp4"
    ? "生成图生视频工作流，先生成可控首帧，再创建 MP4 视频任务"
    : target === "pdf"
      ? "生成 PDF 教材/文档工作流，先生成封面主视觉，再组织文档结构"
      : target === "kit"
        ? "生成完整投放套装工作流，包含主视觉、PDF 教材和 MP4 视频"
        : "生成最终投放海报/图片";
  const body = hasCal
    ? withoutOutput
    : ["@imgen", command, refs ? `使用 ${refs}` : "", brandHint, withoutOutput, targetHint, orientationTag].filter(Boolean).join(" ");
  const withCommand = body.includes("/") ? body : `@imgen ${command} ${body}`;
  const withAgent = withCommand.includes("@imgen") ? withCommand : `@imgen ${withCommand}`;
  const withOrientation = !orientationTag || /%(vertical|landscape|square)|%竖屏|%横屏|%方图/i.test(withAgent) ? withAgent : `${withAgent} ${orientationTag}`;
  return `${withOrientation.replace(/\s+/g, " ").trim()} -> ${outputTargets.join(", ")}`;
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
    resolved.tags.length ? `Style tags: ${resolved.tags.join(", ")}.` : "",
    Object.keys(resolved.params).length ? `Parameters: ${JSON.stringify(resolved.params)}.` : "",
    settings?.ratio ? `Aspect ratio: ${settings.ratio}.` : "",
    "Hard constraints: no CAL syntax, no @agents, no $variables, no /commands, no -> targets, no JSON, no code, no markdown tables, no brand context lists, no resource parsing text, no xmanx.logo-style labels. Produce only the final visual artwork."
  ].filter(Boolean).join("\n");
}

function executableVideoPrompt(sourcePrompt: string, brand: Brand | undefined, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean }) {
  const resolved = resolvePromptAssets(sourcePrompt, brand);
  const cleanIntent = stripCalForExecution(sourcePrompt, resolved);
  return [
    "Create a short commercial video from this CAL workflow.",
    `User intent: ${cleanIntent}`,
    brand ? `Brand: ${brand.name}; visual style ${brand.visualStyle}; tone ${brand.tone}; colors ${brand.primaryColor} and ${brand.accentColor}.` : "Brand: none unless explicitly referenced.",
    resolved.imageReferences.length ? `Visual references are represented in the canvas: ${resolved.imageReferences.map((item) => `${item.role} ${item.title}`).join("; ")}.` : "",
    resolved.lockedTexts.length ? `Only use these exact on-screen texts if needed: ${resolved.lockedTexts.map((item) => `"${item}"`).join(", ")}.` : "Avoid on-screen text unless necessary.",
    resolved.tags.length ? `Style tags: ${resolved.tags.join(", ")}.` : "",
    `Video mode: ${settings?.mode ?? "text-to-video"}; ratio ${settings?.ratio ?? "16:9"}; duration ${settings?.duration ?? "5s"}; audio ${settings?.sound === false ? "off" : "on"}.`,
    "Hard constraints: do not show CAL syntax, variables, tables, JSON, or UI screenshots. Generate the final advertisement motion."
  ].filter(Boolean).join("\n");
}

function localPublicPathFromUrl(imageUrl?: string) {
  if (!imageUrl?.startsWith("/")) return undefined;
  const candidate = path.join(frontendPublicDir, imageUrl.replace(/^\/+/, ""));
  return existsSync(candidate) ? candidate : undefined;
}

async function compactReferenceImage(sourcePath: string, outputName: string, index: number) {
  if (!/\.(png|jpe?g|webp)$/i.test(sourcePath)) return sourcePath;
  await mkdir(generatedDir, { recursive: true });
  const compactPath = path.join(generatedDir, `${outputName}-ref-${index + 1}-compact.jpg`);
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn("sips", ["-Z", "768", "-s", "format", "jpeg", sourcePath, "--out", compactPath], { stdio: "ignore" });
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
  return ok ? compactPath : sourcePath;
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
      model: kind === "text" ? "gpt-5.4" : "grok-imagine-1.0-video-super-720p"
    };
  }
  const prefix = kind === "text" ? "TEXT_GEN" : "VIDEO_GEN";
  const modelFallback = kind === "text" ? "gpt-5.4" : "grok-imagine-1.0-video-super-720p";
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

async function runVideoGeneration(prompt: string, modelName?: string, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean }) {
  const config = serviceConfig("video");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const createPayload = {
    model,
    prompt,
    aspect_ratio: settings?.ratio?.split("·")[0]?.trim() || "16:9",
    duration: Number.parseInt(settings?.duration || "5", 10) || 5,
    with_audio: settings?.sound !== false,
    mode: settings?.mode,
    translate: Boolean(settings?.translate)
  };
  const created = await postJson(`${config.baseUrl}/videos`, config.apiKey, createPayload);
  const immediateUrl = videoUrlFromResponse(created);
  if (immediateUrl) return { videoId: videoIdFromResponse(created), videoUrl: immediateUrl, raw: created };
  const videoId = videoIdFromResponse(created);
  if (!videoId) throw new Error(`视频模型未返回 video id: ${JSON.stringify(created).slice(0, 600)}`);

  let last: unknown = created;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 2000 : 5000));
    last = await getJson(`${config.baseUrl}/videos/${videoId}`, config.apiKey);
    const url = videoUrlFromResponse(last);
    if (url) return { videoId, videoUrl: url, raw: last };
    const status = videoStatusFromResponse(last);
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`视频生成失败: ${JSON.stringify(last).slice(0, 600)}`);
    }
  }
  return { videoId, videoUrl: "", raw: last };
}

async function createVideoGenerationJob(prompt: string, modelName?: string, settings?: { mode?: string; ratio?: string; duration?: string; sound?: boolean; translate?: boolean }, timeoutMs = Number(process.env.WORKFLOW_VIDEO_CREATE_TIMEOUT_MS ?? "45000")) {
  const config = serviceConfig("video");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const created = await postJson(`${config.baseUrl}/videos`, config.apiKey, {
    model,
    prompt,
    aspect_ratio: settings?.ratio?.split("·")[0]?.trim() || "16:9",
    duration: Number.parseInt(settings?.duration || "5", 10) || 5,
    with_audio: settings?.sound !== false,
    mode: settings?.mode ?? "文生视频",
    translate: Boolean(settings?.translate)
  }, timeoutMs);
  return {
    videoId: videoIdFromResponse(created),
    videoUrl: videoUrlFromResponse(created),
    raw: created
  };
}

async function createVideoProbe(prompt: string, modelName?: string) {
  const config = serviceConfig("video");
  if (!config.apiKey) return undefined;
  const model = modelName || config.model;
  const created = await postJson(`${config.baseUrl}/videos`, config.apiKey, {
    model,
    prompt,
    aspect_ratio: "16:9",
    duration: 5,
    with_audio: true,
    mode: "文生视频",
    translate: false
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
  const usableReferences = references.filter((reference) => reference.imageUrl).slice(0, 4);
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
      if (code === 0) return resolve(`/generated/${filename}`);
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
  const model = models.find((item) => item.id === frame.modelId) ?? models[0];
  const visualDraftNode = frame.workflowNodes.find((node) => node.id === "visual-draft");
  let sharedVisualUrl = visualDraftNode?.refs?.find((item) => item.imageUrl && ["visual", "generated", "document-preview", "video-preview"].includes(item.role))?.imageUrl;
  let sharedVisualNote = "";

  if (visualDraftNode && !sharedVisualUrl) {
    try {
      const generated = await runImageGenerationSkill(
        executableImagePrompt(frame.prompt, brand, "master campaign visual for poster/PDF cover/video first frame", frame.settings),
        refs,
        `xmanx-${frame.id}-visual`,
        model.model,
        frame.settings,
        Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "180000")
      );
      sharedVisualUrl = generated ?? fallbackImage;
      if (!generated) sharedVisualNote = "主视觉使用降级预览：未配置有效图片生成 Key。";
    } catch (error) {
      sharedVisualUrl = fallbackImage;
      sharedVisualNote = `主视觉使用降级预览：${error instanceof Error ? error.message.slice(0, 120) : "image skill unavailable"}`;
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
    if (output.imageUrl) {
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
          Number(process.env.WORKFLOW_IMAGE_TIMEOUT_MS ?? "180000"),
          imageFormatFromText(output.title)
        );
        output.imageUrl = generated ?? sharedVisualUrl ?? fallbackImage;
        if (!generated) output.copy = appendCopyNote(output.copy, "图片生成未返回结果，已使用主视觉/降级预览。");
      } catch (error) {
        output.imageUrl = sharedVisualUrl ?? fallbackImage;
        output.copy = appendCopyNote(output.copy, `图片生成降级：${error instanceof Error ? error.message.slice(0, 120) : "image skill unavailable"}`);
      }
      const ref = generatedReference(`generated_${outputNode?.id ?? output.id}_${Date.now().toString(36)}_${index}`, output, outputNode?.preview ?? neutralBrandColor(brand).accent);
      upsertNodeReference(outputNode, ref);
      if (visualDraftNode && !visualDraftNode.refs?.some((item) => item.imageUrl === output.imageUrl)) upsertNodeReference(visualDraftNode, ref);
      continue;
    }

    output.imageUrl = sharedVisualUrl ?? fallbackImage;
    if (output.kind === "video") {
      try {
        const video = await createVideoGenerationJob(
          executableVideoPrompt(frame.prompt, brand, { ratio: frame.settings.ratio, duration: `${frame.settings.duration || 5}s`, sound: true }),
          serviceConfig("video").model,
          { mode: "文生视频", ratio: `${frame.settings.ratio} · 720P · ${frame.settings.duration || 5}s`, duration: `${frame.settings.duration || 5}s`, sound: true, translate: false }
        );
        if (video?.videoId) output.videoId = video.videoId;
        if (video?.videoUrl) output.videoUrl = video.videoUrl;
        output.copy = appendCopyNote(output.copy, video?.videoUrl
          ? `MP4 已真实生成: ${video.videoUrl}`
          : video?.videoId
            ? `MP4 视频任务已真实创建: ${video.videoId}`
            : "视频 API 未配置，已保留首帧/脚本预览。");
      } catch (error) {
        output.copy = appendCopyNote(output.copy, `MP4 视频任务创建失败：${error instanceof Error ? error.message.slice(0, 140) : "video unavailable"}`);
      }
    } else {
      output.copy = appendCopyNote(output.copy, "已生成 PDF 工作流预览；当前版本先输出封面/结构，后续接入真实导出文件。");
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
  const priority = ["logo", "ip", "model", "product", "storefront", "environment", "general"];
  const assetRefs: ReferenceItem[] = db.assets
    .filter((asset) => asset.brandId === brand.id && !asset.type.startsWith("generated_") && asset.imageUrl)
    .map((asset) => ({
      id: `asset_${asset.id}`,
      role: assetTypeToReferenceRole(asset.type, asset.title),
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
  if (outputTargets.some((target) => ["pdf", "mp4"].includes(target))) {
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
      const scriptNodeId = `script-${target}-${index}`;
      const videoNodeId = `video-${target}-${index}`;
      nodes.push({
        id: scriptNodeId,
        type: "script",
        title: "视频脚本",
        body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 根据视觉草图生成分镜表格、镜头运动、音效和字幕约束，目标输出 ${labelForOutputTarget(target)}。`,
        parentId: parentForVisual,
        preview: "#7c3aed",
        refs: referenceItems,
        x: nextX,
        y: 400,
        w: 360,
        h: 260
      });
      nodes.push({
        id: videoNodeId,
        type: "video",
        title: `${labelForOutputTarget(target)} 生成`,
        body: `CAL: ${calWorkflowLine(prompt, brand, target)}\n执行: 文生视频或图生视频。引用视觉草图和视频脚本，生成 ${labelForOutputTarget(target)}。`,
        parentId: scriptNodeId,
        preview: "#111827",
        refs: referenceItems,
        x: nextX + 420,
        y: 400,
        w: 260,
        h: 260
      });
      nodes.push({
        id: `output-${target}`,
        type: "output",
        title: `${labelForOutputTarget(target)} 输出`,
        body: `最终交付 ${labelForOutputTarget(target)}。来源: ${videoNodeId}。`,
        parentId: videoNodeId,
        preview: "#0f172a",
        x: nextX + 730,
        y: 400,
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
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20mb" }));
app.use("/generated", express.static(generatedDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sparkcanvas-api", domain: "xmanx.com" });
});

app.post("/auth/login", (req, res) => {
  const parsed = z.object({ account: z.string(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid login payload" });
  if (parsed.data.account !== "shift" || parsed.data.password !== "123456") {
    return res.status(401).json({ message: "Invalid demo account or password" });
  }
  res.json({ token: DEMO_TOKEN, user: db.user });
});

app.use((req, res, next) => {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== DEMO_TOKEN) return res.status(401).json({ message: "Unauthorized" });
  next();
});

app.get("/me", (_req, res) => {
  res.json(db.user);
});

app.get("/workspace", async (_req, res) => {
  await repairInterruptedGenerations();
  res.json({ user: db.user, brands: db.brands, assets: db.assets, templates, models, frames: db.frames, tasks: db.tasks, ai: aiStatus() });
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
  if (brand.active) db.brands.forEach((item) => { if (item.id !== brand.id) item.active = false; });
  await persistDb();
  res.json(brand);
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
  const asset = createAsset(input.title, input.type, input.brandId ?? activeBrand().id, input.color, input.meta, input.imageUrl);
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
  Object.assign(asset, input);
  await persistDb();
  res.json(asset);
});

app.delete("/assets/:id", async (req, res) => {
  const index = db.assets.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: "Asset not found" });
  const [asset] = db.assets.splice(index, 1);
  for (const frame of db.frames) {
    frame.workflowNodes = frame.workflowNodes.map((node) => {
      if (!node.refs?.length) return node;
      return { ...node, refs: node.refs.filter((reference) => reference.id !== `asset_${asset.id}`) };
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
    brandId: z.string().optional(),
    model: z.string().optional(),
    outputTarget: z.enum(["jpg", "png", "poster", "pdf", "mp4", "kit"]).default("jpg"),
    orientation: z.enum(["square", "portrait", "landscape"]).default("landscape")
  }).parse(req.body);
  const brand = findBrand(input.brandId);
  const resolved = resolvePromptAssets(input.text, brand);
  if (input.action === "optimize") {
    const text = optimizeWorkflowPrompt(input.text, brand, input.outputTarget, input.orientation);
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
        `当前品牌: ${brand.name}`,
        `品牌风格: ${brand.visualStyle}`,
        `资源解析: ${JSON.stringify({ imageReferences: resolved.imageReferences.map((item) => item.description), textReferences: resolved.textReferences, lockedTexts: resolved.lockedTexts, tags: resolved.tags, params: resolved.params })}`,
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
    brandId: z.string().optional(),
    brandInject: z.boolean().optional()
  }).parse(req.body);
  const brand = findBrand(input.brandId);
  const resolved = resolvePromptAssets(input.prompt, brand);
  res.json({
    ...resolved,
    brandId: brand.id,
    brandKey: brandKey(brand),
    finalPrompt: buildFinalPrompt(input.prompt, buildBrandContext(brand), input.brandInject ?? true, brand)
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
    settings: z.object({
      ratio: z.string().optional(),
      count: z.number().min(1).max(6).optional(),
      quality: z.enum(["standard", "hd", "ultra"]).optional(),
      strength: z.number().min(0).max(100).optional(),
      duration: z.number().min(0).max(60).optional(),
      brandInject: z.boolean().optional()
    }).optional()
  }).parse(req.body);

  const manualWorkflowNodes = input.workflowNodes;
  const manualOutputs = input.outputs;
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
      if (!frame.brandInjected && (node.id === "input-image" || node.id === "brand" || node.id === "prompt")) return node;
      return { ...node, title: current.title, body: current.body, preview: current.preview ?? node.preview, x: current.x ?? node.x, y: current.y ?? node.y, w: current.w ?? node.w, h: current.h ?? node.h };
    });
  }

  await persistDb();
  res.json(frame);
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(409).json({ message: "Node not synced yet. Save canvas workflow before generation." });

  const input = z.object({
    prompt: z.string().min(1).optional(),
    modelId: z.string().optional(),
    settings: z.object({
      ratio: z.string().optional(),
      count: z.number().min(1).max(6).optional(),
      quality: z.enum(["standard", "hd", "ultra"]).optional(),
      strength: z.number().min(0).max(100).optional(),
      duration: z.number().min(0).max(60).optional(),
      brandInject: z.boolean().optional()
    }).optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const colors = neutralBrandColor(brand);
  const selectedModel = models.find((item) => item.id === input.modelId) ?? models.find((item) => item.id === frame.modelId) ?? models[0];
  if (input.settings) {
    frame.settings = { ...defaultSettings(frame.prompt, frame.settings), ...input.settings };
  }
  const refs = [
    ...resolvePromptAssets(input.prompt?.trim() || node.body || frame.prompt, brand).imageReferences,
    ...(node.parentId ? (frame.workflowNodes.find((item) => item.id === node.parentId)?.refs ?? []) : []),
    ...(node.refs ?? [])
  ].filter((reference, index, list) => list.findIndex((item) => item.id === reference.id) === index);
  const shouldInjectBrand = Boolean(input.settings?.brandInject);
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
    `参数: ${frame.settings.ratio} · ${frame.settings.quality} · strength ${frame.settings.strength}`,
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
    mode: z.enum(["story", "table"]).optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const source = input.prompt.trim();
  const resolved = resolvePromptAssets(source, brand);
  const translated = input.translate
    ? `English prompt: ${resolved.prompt}. Keep CAL resource intent${brand ? ` and ${brand.name} visual language` : ""}.`
    : resolved.prompt;
  const fallbackText = [
    translated,
    "",
    `品牌约束: ${brandLabel(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
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
        `品牌语气: ${brandTone(contextBrand)}`
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
  res.json({ frame, node, text: generatedText, model: input.model ?? serviceConfig("text").model });
});

app.post("/canvas/frames/:id/nodes/:nodeId/generate-script", async (req, res) => {
  const frame = db.frames.find((item) => item.id === req.params.id);
  if (!frame) return res.status(404).json({ message: "Frame not found" });
  const node = frame.workflowNodes.find((item) => item.id === req.params.nodeId);
  if (!node) return res.status(404).json({ message: "Node not found" });

  const input = z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    translate: z.boolean().optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
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
      translate: z.boolean().optional()
    }).optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const settings = input.settings ?? {};
  const prompt = executableVideoPrompt(input.prompt.trim(), contextBrand, settings);
  let generationLines: string[] = [];
  try {
    const result = await runVideoGeneration(
      prompt,
      input.model || serviceConfig("video").model,
      settings
    );
    if (result?.videoUrl) {
      generationLines = [`视频ID: ${result.videoId || "completed"}`, `视频URL: ${result.videoUrl}`, "执行状态: 已由 yijiarj 视频模型真实生成。"];
    } else if (result?.videoId) {
      generationLines = [`视频ID: ${result.videoId}`, "执行状态: 视频任务已创建但仍在生成，可用 /v1/videos/{video_id} 查询。"];
    }
  } catch (error) {
    generationLines = [`执行状态: 视频生成请求失败，${error instanceof Error ? error.message.slice(0, 180) : "unavailable"}`];
  }
  const videoPlan = [
    prompt,
    "",
    `视频类型: ${settings.mode ?? "文生视频"}`,
    `模型: ${input.model ?? serviceConfig("video").model}`,
    `规格: ${settings.ratio ?? "16:9 · 720P · 5s"}`,
    `声音: ${settings.sound === false ? "关闭" : "开启"}`,
    `翻译: ${settings.translate ? "开启" : "关闭"}`,
    `品牌约束: ${brandLabel(contextBrand)}; ${brandVisualStyle(contextBrand)}`,
    ...(generationLines.length ? generationLines : ["执行状态: 已保存视频生成配置，未配置视频 API Key。"])
  ].join("\n");

  node.type = "video";
  node.title = node.title || "Video";
  node.body = videoPlan;
  frame.updatedAt = now();
  await persistDb();
  res.json({ frame, node, videoPlan, model: input.model ?? serviceConfig("video").model });
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
      translate: z.boolean().optional()
    }).optional()
  }).parse(req.body);

  const brand = frameBrand(frame);
  const contextBrand = frameContextBrand(frame);
  const settings = input.settings ?? {};
  const resolved = resolvePromptAssets(input.prompt.trim(), brand);
  const prompt = resolved.prompt;
  const audioPlan = [
    prompt,
    "",
    `音频类型: ${settings.mode ?? "配乐"}`,
    `模型: ${input.model ?? "cliproxyapi · gpt-5.4"}`,
    `时长: ${settings.duration ?? "15s"}`,
    `场景: ${settings.scene ?? "广告短视频"}`,
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
    settings: z.object({
      ratio: z.string().optional(),
      count: z.number().min(1).max(6).optional(),
      quality: z.enum(["standard", "hd", "ultra"]).optional(),
      strength: z.number().min(0).max(100).optional(),
      duration: z.number().min(0).max(60).optional(),
      brandInject: z.boolean().optional()
    }).optional(),
    x: z.number().optional(),
    y: z.number().optional()
  }).parse(req.body);

  const template = templates.find((item) => item.id === input.templateId);
  const inferredBrand = input.brandId === null ? undefined : input.brandId ? db.brands.find((item) => item.id === input.brandId) : inferBrandFromPrompt(input.prompt);
  const effectiveOutputTarget = input.outputTarget ?? finalOutputFromPrompt(input.prompt);
  const effectiveOrientation = input.orientation ?? "landscape";
  const optimizedPrompt = optimizeWorkflowPrompt(input.prompt, inferredBrand, effectiveOutputTarget, effectiveOrientation);
  const prompt = template ? `${template.title}：${optimizedPrompt || template.intent}` : optimizedPrompt;
  const optimizedSettings = settingsForFinalOutput(effectiveOutputTarget, effectiveOrientation, input.settings);
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
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(500).json({ message });
};

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4100);
await loadDb();
app.listen(port, () => {
  console.log(`SparkCanvas API listening on http://localhost:${port}`);
});
