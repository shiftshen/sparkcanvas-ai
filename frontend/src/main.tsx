import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ChevronLeft,
  Box,
  Camera,
  Download,
  Expand,
  FolderKanban,
  Grid2X2,
  History,
  HelpCircle,
  Image,
  ImagePlus,
  Library,
  Layers3,
  List,
  Loader2,
  Lock,
  Maximize2,
  MousePointer2,
  Music2,
  Palette,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Route,
  Scissors,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Languages,
  Play,
  Upload,
  Volume2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import "./styles.css";

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
  updatedAt?: string;
};

type BrandAssetRole = {
  role: "logo" | "ip" | "product" | "model" | "storefront" | "environment" | "menu" | "equipment" | "general";
  title: string;
  description: string;
  color?: string;
};

type Template = {
  id: string;
  title: string;
  category: string;
  cost: number;
  ratio: string;
  intent: string;
};

type ModelOption = {
  id: string;
  name: string;
  type: "image" | "video";
  costMultiplier: number;
  description: string;
  model?: string;
  provider?: string;
  reasoningEffort?: string;
};

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

type MentionItem = ReferenceItem & {
  token: string;
  group: "agent" | "command" | "resource" | "copy" | "tag";
  kind: "agent" | "command" | "resource" | "copy" | "tag";
};

type AssetUploadOptions = {
  title?: string;
  meta?: string;
};

type GenerationSettings = {
  ratio: string;
  count: number;
  quality: "standard" | "hd" | "ultra";
  strength: number;
  duration: number;
  brandInject: boolean;
};

type Frame = {
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
  outputs: Array<{ id: string; title: string; kind: "image" | "video" | "document"; gradient: string; copy: string; imageUrl?: string; videoId?: string; videoUrl?: string }>;
  createdAt: string;
  updatedAt?: string;
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

type GenerationTask = {
  id: string;
  frameId: string;
  status: "queued" | "routing" | "generating" | "completed" | "failed";
  progress: number;
};

type WorkflowOutputTarget = "jpg" | "png" | "pdf" | "mp4" | "kit";
type WorkflowOrientation = "square" | "portrait" | "landscape";
type WorkflowPresetId = "feed-45" | "feed-square" | "story-cover" | "display-landscape" | "display-square" | "display-vertical" | "youtube-thumbnail" | "frame-landscape" | "frame-vertical" | "pdf-cover" | "video-feed-45" | "video-landscape" | "video-vertical" | "video-frame-landscape" | "video-frame-vertical";
type WorkflowControls = { outputTarget: WorkflowOutputTarget; orientation: WorkflowOrientation; preset: WorkflowPresetId };

type WorkflowPreset = {
  id: WorkflowPresetId;
  label: string;
  size: string;
  ratio: string;
  orientation: WorkflowOrientation;
  duration?: number;
  formats: WorkflowOutputTarget[];
  note: string;
};

type Workspace = {
  user: User;
  brands: Brand[];
  assets: Asset[];
  templates: Template[];
  models: ModelOption[];
  frames: Frame[];
  tasks: GenerationTask[];
  ai?: AiStatus;
};

type AiStatus = {
  imageGeneration: {
    configured: boolean;
    verified: boolean;
    baseUrl: string;
    baseUrlSource: string;
    model: string;
    keySource: string;
    provider: string;
    skill: string;
  };
  textGeneration?: { configured: boolean; baseUrl: string; model: string; provider: string };
  videoGeneration?: { configured: boolean; baseUrl: string; model: string; provider: string };
};
type AiDiagnostics = AiStatus & {
  runtime: {
    scriptExists: boolean;
    helpOk: boolean;
    message: string;
    canAttemptGeneration: boolean;
  };
};

type User = {
  id: string;
  name: string;
  email: string;
  plan: string;
  credits: number;
};

type FramePatch = Partial<Pick<Frame, "title" | "prompt" | "modelId" | "settings" | "brandContext" | "workflowNodes" | "outputs">> & { brandId?: string | null; brandInject?: boolean };
type PanelKey = "projects" | "assets" | "brand" | "templates" | "history" | "tutorial" | null;
type Locale = "zh" | "en" | "th";
type Viewport = { x: number; y: number; scale: number };
type PreviewTarget = { title: string; subtitle?: string; imageUrl?: string; color?: string; nodeId?: string };
type NodeGenerateResponse = { frame: Frame; node: WorkflowNode; imageUrl: string; generated?: boolean; message?: string };
type WorkflowGenerateResponse = { taskId: string; task: GenerationTask; frame: Frame; credits: number };
type TextGenerateResponse = { frame: Frame; node: WorkflowNode; text: string; model: string };
type ScriptGenerateResponse = { frame: Frame; node: WorkflowNode; script: string; model: string };
type VideoGenerateResponse = { frame: Frame; node: WorkflowNode; videoPlan: string; model: string; videoId?: string; videoUrl?: string };
type AudioGenerateResponse = { frame: Frame; node: WorkflowNode; audioPlan: string; model: string };
type TransformTextResponse = { text: string; action: "translate" | "optimize"; model: string };

const coreNodeIds = ["input-image", "brand", "prompt", "output"];
const nodeOrder = ["input-image", "brand", "prompt", "output"];
const localeOptions: Array<{ id: Locale; label: string }> = [
  { id: "zh", label: "中文" },
  { id: "en", label: "EN" },
  { id: "th", label: "ไทย" }
];
const defaultLocale = ((window.localStorage.getItem("sparkcanvas.locale") as Locale | null)
  || (navigator.language.toLowerCase().startsWith("th") ? "th" : navigator.language.toLowerCase().startsWith("en") ? "en" : "zh")) as Locale;
const i18n = {
  zh: {
    nav: { projects: "项目", templates: "模板", assets: "我的素材", history: "历史记录", tutorial: "教程", brand: "品牌" },
    drawer: { projects: "项目 / 画布", templates: "模板库", assets: "我的素材", history: "历史记录", tutorial: "教程", brand: "品牌管理" },
    topStatus: "在底部 CAL 输入框编写提示词，$ 图片资源会作为真实参考图传入 skill",
    generate: "生成",
    check: "检查",
    login: {
      badge: "CAL 1.0 · Prompt Asset Reference System",
      title: "像写代码一样用 AI 设计品牌内容",
      subtitle: "SparkCanvas 把品牌 Logo、IP、产品、模特和文案变成可引用变量，在可见即所得画布中生成图片、文本、脚本、视频和音频。",
      cta: "进入工作台",
      secondary: "查看 CAL 教材",
      prompt: "@imgen /生成海报 使用 $logo $ip $product，生成 5.1 活动教材和短视频 -> pdf 和 mp4",
      stats: ["@imgen 图片 Skill", "$ 真实素材引用", "可控工作流画布"],
      features: [
        ["品牌资产变量化", "$logo / $ip / $product 会作为真实参考图传入模型。"],
        ["可见即所得画布", "每个节点都能编辑、继续向后生成、替换历史版本。"],
        ["国际化工作流", "中文、英文、泰文界面和教材，适合跨境团队协作。"]
      ],
      syntaxTitle: "CAL 符号语言",
      syntax: [
        ["@", "智能体或兼容旧图片引用，例如 @imgen。"],
        ["$", "品牌资源变量，例如 $logo、$xmanx.ip、$copy.slogan。"],
        ["/", "执行命令，例如 /生成海报、/写视频脚本。"],
        ["%", "风格标签，例如 %高级感、%TikTok。"],
        ["->", "输出目标，例如 -> 海报、-> PDF、-> MP4。"]
      ]
    },
    tutorial: [
      ["1. 建品牌", "在品牌管理里上传 Logo、产品、IP、模特等参考图，补齐口号、定位、禁用词。"],
      ["2. 写 CAL", "像写代码一样输入：@imgen /生成海报 使用 $logo $product，显示 $copy.slogan -> 海报；也可以 -> pdf 和 mp4。"],
      ["3. 真引用", "$logo、$ip、$product 会作为真实图片传入 skill；$copy.slogan 会展开成文案。"],
      ["4. 加节点", "双击空白处或点击线路 +，继续添加图片、文本、脚本、视频、合成或音频节点。"],
      ["5. 可控迭代", "点击节点后在底部固定面板调整模型、比例、提示词、历史版本和素材替换。"]
    ]
  },
  en: {
    nav: { projects: "Projects", templates: "Templates", assets: "Assets", history: "History", tutorial: "Guide", brand: "Brand" },
    drawer: { projects: "Projects", templates: "Templates", assets: "Assets", history: "History", tutorial: "Guide", brand: "Brand Kit" },
    topStatus: "Write CAL prompts in the bottom composer. $ image resources are sent to the skill as real references.",
    generate: "Generate",
    check: "Check",
    login: {
      badge: "CAL 1.0 · Prompt Asset Reference System",
      title: "Design with AI like writing code",
      subtitle: "SparkCanvas turns logos, IP characters, products, models, and copy into reference variables on a WYSIWYG canvas for images, text, scripts, video, and audio.",
      cta: "Enter Studio",
      secondary: "Read CAL guide",
      prompt: "@imgen /generate-poster use $logo $ip $product, create a 5.1 campaign guide and short video -> pdf and mp4",
      stats: ["@imgen image skill", "$ real asset refs", "controllable workflow canvas"],
      features: [
        ["Brand assets as variables", "$logo / $ip / $product are passed to models as real image references."],
        ["WYSIWYG canvas", "Every node can be edited, extended, regenerated, and replaced with version history."],
        ["International workflow", "Chinese, English, and Thai UI/guide for cross-border teams."]
      ],
      syntaxTitle: "CAL Symbol Language",
      syntax: [
        ["@", "Agent or legacy visual reference, for example @imgen."],
        ["$", "Brand resource variable, for example $logo, $xmanx.ip, $copy.slogan."],
        ["/", "Command, for example /generate-poster or /write-video-script."],
        ["%", "Style tag, for example %premium or %TikTok."],
        ["->", "Output target, for example -> poster, -> PDF, or -> MP4."]
      ]
    },
    tutorial: [
      ["1. Build a brand", "Upload logo, product, IP, model references, then complete slogan, positioning, and forbidden terms."],
      ["2. Write CAL", "Type like code: @imgen /generate-poster use $logo $product, show $copy.slogan -> poster; or -> pdf and mp4."],
      ["3. Real references", "$logo, $ip, and $product are sent to the skill as images; $copy.slogan expands as text."],
      ["4. Add nodes", "Double-click the canvas or use line + controls to add image, text, script, video, compose, and audio nodes."],
      ["5. Iterate with control", "Select a node and tune model, ratio, prompt, versions, and asset replacement in the bottom panel."]
    ]
  },
  th: {
    nav: { projects: "โปรเจกต์", templates: "เทมเพลต", assets: "แอสเซ็ต", history: "ประวัติ", tutorial: "คู่มือ", brand: "แบรนด์" },
    drawer: { projects: "โปรเจกต์", templates: "เทมเพลต", assets: "แอสเซ็ต", history: "ประวัติ", tutorial: "คู่มือ", brand: "จัดการแบรนด์" },
    topStatus: "เขียนพรอมป์ CAL ด้านล่าง โดยรูปภาพ $ จะถูกส่งให้ skill เป็นภาพอ้างอิงจริง",
    generate: "สร้าง",
    check: "ตรวจสอบ",
    login: {
      badge: "CAL 1.0 · ระบบอ้างอิงทรัพยากรในพรอมป์",
      title: "ออกแบบด้วย AI ให้เหมือนเขียนโค้ด",
      subtitle: "SparkCanvas เปลี่ยนโลโก้ คาแรกเตอร์ สินค้า โมเดล และข้อความแบรนด์ให้เป็นตัวแปรบนแคนวาสแบบเห็นผลลัพธ์ทันที",
      cta: "เข้า Studio",
      secondary: "อ่านคู่มือ CAL",
      prompt: "@imgen /generate-poster use $logo $ip $product, create a 5.1 campaign guide and short video -> pdf and mp4",
      stats: ["@imgen image skill", "$ อ้างอิงแอสเซ็ตจริง", "workflow canvas ที่ควบคุมได้"],
      features: [
        ["แอสเซ็ตแบรนด์เป็นตัวแปร", "$logo / $ip / $product ถูกส่งเป็นภาพอ้างอิงจริงให้โมเดล"],
        ["แคนวาส WYSIWYG", "ทุกโหนดแก้ไข ต่อสาย สร้างใหม่ และแทนที่เวอร์ชันได้"],
        ["รองรับทีมต่างประเทศ", "มี UI และคู่มือภาษาจีน อังกฤษ และไทย"]
      ],
      syntaxTitle: "ภาษา CAL",
      syntax: [
        ["@", "Agent หรือ visual reference แบบเดิม เช่น @imgen"],
        ["$", "ตัวแปรทรัพยากรแบรนด์ เช่น $logo, $xmanx.ip, $copy.slogan"],
        ["/", "คำสั่ง เช่น /generate-poster หรือ /write-video-script"],
        ["%", "แท็กสไตล์ เช่น %premium หรือ %TikTok"],
        ["->", "เป้าหมายเอาต์พุต เช่น -> poster, -> PDF หรือ -> MP4"]
      ]
    },
    tutorial: [
      ["1. สร้างแบรนด์", "อัปโหลดโลโก้ สินค้า IP โมเดล และเติม slogan, positioning, forbidden terms"],
      ["2. เขียน CAL", "พิมพ์เหมือนโค้ด: @imgen /generate-poster use $logo $product, show $copy.slogan -> poster หรือ -> pdf and mp4"],
      ["3. อ้างอิงจริง", "$logo, $ip, $product ถูกส่งเป็นรูปจริงให้ skill; $copy.slogan ถูกขยายเป็นข้อความ"],
      ["4. เพิ่มโหนด", "ดับเบิลคลิกบนแคนวาสหรือกด + บนเส้นเพื่อเพิ่ม image/text/script/video/compose/audio"],
      ["5. คุมการทำซ้ำ", "เลือกโหนดแล้วปรับ model, ratio, prompt, versions และ asset replacement ที่แผงล่าง"]
    ]
  }
} satisfies Record<Locale, {
  nav: Record<Exclude<PanelKey, null>, string>;
  drawer: Record<Exclude<PanelKey, null>, string>;
  topStatus: string;
  generate: string;
  check: string;
  login: {
    badge: string;
    title: string;
    subtitle: string;
    cta: string;
    secondary: string;
    prompt: string;
    stats: string[];
    features: Array<[string, string]>;
    syntaxTitle: string;
    syntax: Array<[string, string]>;
  };
  tutorial: Array<[string, string]>;
}>;
const requiredBrandSlots = [
  { role: "logo", token: "$logo", title: "Logo", hint: "透明底标志、标准组合或主视觉标识", assetType: "logo" },
  { role: "ip", token: "$ip", title: "IP", hint: "品牌角色、吉祥物或虚拟主理人", assetType: "model" },
  { role: "product", token: "$product", title: "产品", hint: "核心 SKU、包装或商品实拍参考", assetType: "product" },
  { role: "model", token: "$model", title: "模特", hint: "固定真人、数字人或穿搭模特", assetType: "model" },
  { role: "storefront", token: "$storefront", title: "店铺", hint: "官网、门店、直播间或电商页面", assetType: "upload" },
  { role: "environment", token: "$environment", title: "环境", hint: "使用场景、背景空间或品牌氛围", assetType: "upload" }
] as const satisfies ReadonlyArray<{ role: BrandAssetRole["role"]; token: string; title: string; hint: string; assetType: Asset["type"] }>;
const defaultSettings: GenerationSettings = { ratio: "1:1", count: 1, quality: "hd", strength: 72, duration: 0, brandInject: false };
const workflowPresets: WorkflowPreset[] = [
  { id: "feed-45", label: "Meta Feed 4:5", size: "1080x1350", ratio: "4:5", orientation: "portrait", formats: ["jpg", "png"], note: "Facebook/Instagram 信息流竖图" },
  { id: "feed-square", label: "社媒方图", size: "1080x1080", ratio: "1:1", orientation: "square", formats: ["jpg", "png"], note: "Facebook/Instagram 方图" },
  { id: "story-cover", label: "Story/Reels/TikTok", size: "1080x1920", ratio: "9:16", orientation: "portrait", formats: ["jpg", "png"], note: "竖屏封面、Story、Reels、TikTok 首帧" },
  { id: "display-landscape", label: "Google Display 横图", size: "1200x628", ratio: "16:9", orientation: "landscape", formats: ["jpg", "png"], note: "Google Display / Performance Max 横版素材，按横图交付裁切" },
  { id: "display-square", label: "Google Display 方图", size: "1200x1200", ratio: "1:1", orientation: "square", formats: ["jpg", "png"], note: "Google Display / Performance Max 方图素材" },
  { id: "display-vertical", label: "Google Display 竖图", size: "900x1600", ratio: "9:16", orientation: "portrait", formats: ["jpg", "png"], note: "Google Display 竖版素材" },
  { id: "youtube-thumbnail", label: "YouTube 缩略图", size: "1280x720", ratio: "16:9", orientation: "landscape", formats: ["jpg", "png"], note: "YouTube 视频封面/横屏首帧" },
  { id: "frame-landscape", label: "视频首尾帧 横屏", size: "1920x1080", ratio: "16:9", orientation: "landscape", formats: ["jpg", "png"], note: "Facebook/YouTube 视频首帧或尾帧" },
  { id: "frame-vertical", label: "视频首尾帧 竖屏", size: "1080x1920", ratio: "9:16", orientation: "portrait", formats: ["jpg", "png"], note: "Reels/Story/TikTok 视频首帧或尾帧" },
  { id: "pdf-cover", label: "PDF 封面", size: "A4 2480x3508", ratio: "3:4", orientation: "portrait", formats: ["pdf"], note: "PDF 教材/手册封面视觉" },
  { id: "video-feed-45", label: "Feed Video 4:5", size: "1080x1350", ratio: "4:5", orientation: "portrait", duration: 15, formats: ["mp4", "kit"], note: "Meta 信息流视频" },
  { id: "video-landscape", label: "Video 横屏", size: "1920x1080", ratio: "16:9", orientation: "landscape", duration: 15, formats: ["mp4", "kit"], note: "Facebook/YouTube 横屏视频" },
  { id: "video-vertical", label: "Reels/Story 竖屏", size: "1080x1920", ratio: "9:16", orientation: "portrait", duration: 15, formats: ["mp4", "kit"], note: "Reels/Stories/TikTok 竖屏视频" },
  { id: "video-frame-landscape", label: "视频首尾帧 横屏", size: "1920x1080", ratio: "16:9", orientation: "landscape", duration: 5, formats: ["mp4", "kit"], note: "图生视频首帧/尾帧" },
  { id: "video-frame-vertical", label: "视频首尾帧 竖屏", size: "1080x1920", ratio: "9:16", orientation: "portrait", duration: 5, formats: ["mp4", "kit"], note: "图生视频首帧/尾帧" }
];

function defaultPresetForOutput(output: WorkflowOutputTarget): WorkflowPreset {
  return workflowPresets.find((preset) => preset.formats.includes(output)) ?? workflowPresets[0];
}
type GraphEdge = { from: WorkflowNode; to: WorkflowNode; id: string };

const api = {
  async get<T>(path: string): Promise<T> {
    const response = await fetch(`/api${path}`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await apiErrorMessage(response, `GET ${path} failed`));
    return response.json();
  },
  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, `POST ${path} failed`));
    return response.json();
  },
  async patch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`/api${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, `PATCH ${path} failed`));
    return response.json();
  },
  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`/api${path}`, { method: "DELETE", headers: authHeaders() });
    if (!response.ok) throw new Error(await apiErrorMessage(response, `DELETE ${path} failed`));
    return response.json();
  }
};

async function apiErrorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { message?: string };
    return payload.message ? `${fallback}: ${payload.message}` : fallback;
  } catch {
    return fallback;
  }
}

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem("sparkcanvas.token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function defaultWorkflowNodes(): WorkflowNode[] {
  return [
    { id: "input-image", type: "image", title: "Reference", body: "", preview: "#f97316", refs: [], x: 40, y: 210, w: 230, h: 238 },
    { id: "brand", type: "brand", title: "Brand", body: "", parentId: "input-image", preview: "#111827", x: 340, y: 210, w: 230, h: 238 },
    { id: "prompt", type: "prompt", title: "Prompt", body: "", parentId: "brand", preview: "#8b5cf6", x: 640, y: 210, w: 230, h: 238 },
    { id: "output", type: "output", title: "Output", body: "", parentId: "prompt", preview: "#22c55e", x: 960, y: 210, w: 260, h: 238 }
  ];
}

function normalizeWorkflowNodes(nodes: WorkflowNode[] = [], withDefaults = true): WorkflowNode[] {
  const sourceNodes = nodes.filter((node) => node.id !== "model");
  const defaults = withDefaults ? defaultWorkflowNodes() : [];
  const merged = defaults.map((node) => {
    const next = { ...node, ...(sourceNodes.find((item) => item.id === node.id) ?? {}) };
    return next.id === "output" && next.parentId === "model" ? { ...next, parentId: "prompt" } : next;
  });
  const extras = sourceNodes
    .filter((node) => !defaults.some((item) => item.id === node.id))
    .map((node, index) => ({
      ...node,
      x: typeof node.x === "number" ? node.x : 340 + index * 260,
      y: typeof node.y === "number" ? node.y : 520,
      w: typeof node.w === "number" ? node.w : 230,
      h: typeof node.h === "number" ? node.h : 238
    }));
  return [...merged, ...extras];
}

function shouldUseDefaultWorkflow(nodes: WorkflowNode[] = []) {
  return nodes.length > 0 && coreNodeIds.some((id) => nodes.some((node) => node.id === id));
}

function displayNodes(nodes: WorkflowNode[], withDefaults = true) {
  const normalized = normalizeWorkflowNodes(nodes, withDefaults);
  const positioned = new Map<string, WorkflowNode>();
  nodeOrder.forEach((id, index) => {
    const node = normalized.find((item) => item.id === id);
    if (node) {
      positioned.set(id, {
        ...node,
        parentId: node.parentId,
        x: typeof node.x === "number" ? node.x : 40 + index * 300,
        y: typeof node.y === "number" ? node.y : 210,
        w: typeof node.w === "number" ? node.w : id === "output" ? 260 : 230,
        h: typeof node.h === "number" ? node.h : 238
      });
    }
  });

  const extras = normalized.filter((node) => !coreNodeIds.includes(node.id));
  const byParent = new Map<string, WorkflowNode[]>();
  extras.forEach((node) => {
    const parentId = node.parentId || "prompt";
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), node]);
  });

  extras.forEach((node, fallbackIndex) => {
    const parent = positioned.get(node.parentId || "prompt") ?? positioned.get("prompt");
    const siblings = byParent.get(node.parentId || "prompt") ?? [node];
    const siblingIndex = siblings.findIndex((item) => item.id === node.id);
    const spread = (siblingIndex - (siblings.length - 1) / 2) * 270;
    positioned.set(node.id, {
      ...node,
      x: typeof node.x === "number" ? node.x : (parent?.x ?? 640) + 300,
      y: typeof node.y === "number" ? node.y : Math.max(90, (parent?.y ?? 210) + spread + (node.parentId ? 0 : 300 + fallbackIndex * 34)),
      w: typeof node.w === "number" ? node.w : node.type === "process" || node.type === "script" ? 360 : node.type === "compose" ? 300 : node.type === "output" || node.type === "video" ? 260 : 230,
      h: typeof node.h === "number" ? node.h : node.type === "process" || node.type === "script" || node.type === "compose" ? 260 : 238
    });
  });

  return Array.from(positioned.values()).sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0));
}

function graphEdges(nodes: WorkflowNode[]): GraphEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  for (let index = 0; index < nodeOrder.length - 1; index += 1) {
    const from = byId.get(nodeOrder[index]);
    const to = byId.get(nodeOrder[index + 1]);
    if (from && to) edges.push({ from, to, id: `${from.id}-${to.id}` });
  }
  nodes.forEach((node) => {
    if (coreNodeIds.includes(node.id)) return;
    if (!node.parentId) return;
    const from = byId.get(node.parentId);
    if (from) edges.push({ from, to: node, id: `${from.id}-${node.id}` });
  });
  return edges;
}

function outputForNode(frame: Frame | undefined, outputNodes: WorkflowNode[], nodeId: string) {
  if (!frame?.outputs.length) return undefined;
  const node = outputNodes.find((item) => item.id === nodeId);
  if (!node) return undefined;
  const nodeText = `${node.id} ${node.title}`.toLowerCase();
  const explicit = frame.outputs.find((output) => {
    const outputText = `${output.title} ${output.kind}`.toLowerCase();
    if (output.kind === "document") return nodeText.includes("pdf") || outputText.includes("pdf");
    if (output.kind === "video") return nodeText.includes("mp4") || nodeText.includes("video") || nodeText.includes("视频");
    return nodeText.includes("poster") || nodeText.includes("image") || nodeText.includes("海报") || nodeText.includes("图片");
  });
  const index = outputNodes.findIndex((item) => item.id === nodeId);
  return explicit ?? frame.outputs[index] ?? frame.outputs[0];
}

function buildBrandContext(brand?: Brand, assets: Asset[] = []) {
  if (!brand) return "";
  const assetLines = buildMentionItems(brand, assets)
    .filter((item) => item.kind === "resource" && item.imageUrl)
    .map((item) => `${item.token} ${item.title}${item.imageUrl ? " [image]" : ""}: ${item.description}`)
    .join("\n");
  return [
    `$copy.brand_name ${brand.name}`,
    `$copy.slogan ${brand.slogan}`,
    `$copy.domain ${brand.market}`,
    `$brand.logo_text ${brand.logoText}: 主色 ${brand.primaryColor}; 强调色 ${brand.accentColor}; ${brand.logoUsage}`,
    `$brand.ip ${brand.ipName}: ${brand.ipDescription}`,
    `$brand.style ${brand.visualStyle}`,
    `$brand.tone ${brand.tone}`,
    `$brand.scene ${(brand.sceneKeywords ?? []).join(", ")}`,
    `$brand.forbidden ${(brand.forbiddenWords ?? []).join(", ")}`,
    assetLines ? `$assets\n${assetLines}` : ""
  ].filter(Boolean).join("\n");
}

function mentionTokenForRole(role: string) {
  const map: Record<string, string> = {
    logo: "$logo",
    ip: "$ip",
    product: "$product",
    model: "$model",
    storefront: "$storefront",
    environment: "$environment",
    upload: "$asset",
    general: "$asset",
    generated_image: "$generated_image",
    generated_video: "$video"
  };
  return map[role] ?? "$asset";
}

function normalizeBrandKey(value = "") {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/\.(com|cn|net|ai|org)\b/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function currentBrandKey(brand?: Brand) {
  if (!brand) return "brand";
  return normalizeBrandKey(brand.market.split(/\s+/)[0] ?? "") || normalizeBrandKey(brand.name) || brand.id;
}

function brandReferenceKeys(brand: Brand) {
  return Array.from(new Set([
    currentBrandKey(brand),
    normalizeBrandKey(brand.name),
    normalizeBrandKey(brand.market.split(/\s+/)[0] ?? ""),
    normalizeBrandKey(brand.id.replace(/^brand_/, "")),
    brand.id
  ].filter(Boolean)));
}

function inferBrandForPrompt(prompt: string, brands: Brand[]) {
  const normalized = normalizeBrandKey(prompt.replace(/\$[\p{L}0-9_-]+(?:\.[\p{L}0-9_-]+)+/gu, " "));
  return [...brands].sort((a, b) => Number(b.active) - Number(a.active)).find((brand) => brandReferenceKeys(brand).some((key) => key && normalized.includes(key)));
}

function promptRequestsWholeBrand(prompt: string, brand?: Brand) {
  if (!brand) return false;
  const explicitPackage = brandReferenceKeys(brand).some((key) => new RegExp(`\\$${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "i").test(prompt));
  const withoutQualifiedRefs = normalizeBrandKey(prompt.replace(/\$[\p{L}0-9_-]+(?:\.[\p{L}0-9_-]+)+/gu, " "));
  const naturalMention = brandReferenceKeys(brand).some((key) => key && withoutQualifiedRefs.includes(key));
  return explicitPackage || naturalMention;
}

function normalizeRoleText(asset: Pick<Asset, "title" | "meta" | "type">) {
  return `${asset.title} ${asset.meta} ${asset.type}`.toLowerCase();
}

function assetRole(asset: Pick<Asset, "title" | "meta" | "type">): BrandAssetRole["role"] {
  const text = normalizeRoleText(asset);
  if (asset.type === "logo" || /@logo|\blogo\b|标志|品牌标识/.test(text)) return "logo";
  if (/^ip\b|@ip|\bip\b|navigator|角色|吉祥物|主理人/.test(text)) return "ip";
  if (asset.type === "product" || /@产品|product|sku|商品|产品|包装/.test(text)) return "product";
  if (asset.type === "model" || /@模特|model|模特|真人|数字人|穿搭/.test(text)) return "model";
  if (/@店铺|store|storefront|店铺|门店|官网|直播间|电商页面/.test(text)) return "storefront";
  if (/@环境|environment|scene|环境|场景|背景|空间|氛围/.test(text)) return "environment";
  return "general";
}

function buildMentionItems(brand?: Brand, assets: Asset[] = []): MentionItem[] {
  if (!brand) {
    const neutral = "#f97316";
    const agents: MentionItem[] = [{ id: "agent_imgen", token: "@imgen", group: "agent", kind: "agent", role: "imgen", title: "imgen", description: "图片生成 Skill：无品牌项目也可直接生成，只有显式 $ 引用才会传参考图", color: "#111827" }];
    const commands: MentionItem[] = ["/生成海报", "/生成主图", "/写文案", "/翻译", "/润色", "/写视频脚本", "/生成视频"].map((token) => ({
      id: `command_${token}`,
      token,
      group: "command" as const,
      kind: "command" as const,
      role: token.replace("/", ""),
      title: token.replace("/", ""),
      description: "CAL 命令，用于生成结构化工作流",
      color: neutral
    }));
    const tags: MentionItem[] = ["%高级感", "%新品上市", "%Facebook广告", "%TikTok视频", "%电商主图", "%真实摄影"].map((token) => ({
      id: `tag_${token}`,
      token,
      group: "tag" as const,
      kind: "tag" as const,
      role: "tag",
      title: token.replace("%", ""),
      description: "主题标签，用于风格、平台和模板推荐",
      color: neutral
    }));
    return [...agents, ...commands, ...tags];
  }
  const key = currentBrandKey(brand);
  const hasText = (value?: string) => Boolean(value?.trim());
  const agents: MentionItem[] = [
    ["@imgen", "imgen", "图片生成 Skill：通过本地脚本调用 otcbot / yijiarj 图片生成能力"]
  ].map(([token, role, description]) => ({
    id: `agent_${role}`,
    token,
    group: "agent" as const,
    kind: "agent" as const,
    role,
    title: token === "@imgen" ? "图片生成 Agent" : token.replace("@", ""),
    description,
    color: brand.primaryColor
  }));
  const commands: MentionItem[] = [
    ["/生成海报", "generate_poster", "调用图片模型生成品牌海报"],
    ["/生成主图", "generate_product_image", "生成电商主图或产品图"],
    ["/换模特", "change_model", "基于商品和模特参考生成换模特结果"],
    ["/换背景", "change_background", "保留主体并替换画面背景"],
    ["/写文案", "write_copy", "生成标题、副标题、促销文案"],
    ["/翻译", "translate", "用文本模型翻译为目标语言"],
    ["/润色", "polish", "优化提示词、文案或脚本"],
    ["/写视频脚本", "write_video_script", "生成分镜、镜头、运动和音效"],
    ["/生成视频", "generate_video", "调用视频模型创建视频任务"],
    ["/审核", "review", "检查品牌一致性和平台风险"]
  ].map(([token, role, description]) => ({
    id: `command_${role}`,
    token,
    group: "command" as const,
    kind: "command" as const,
    role,
    title: token.replace("/", ""),
    description,
    color: brand.accentColor
  }));
  const tags: MentionItem[] = ["%高级感", "%新品上市", "%Facebook广告", "%TikTok视频", "%电商主图", "%真实摄影", "%女性向", "%品牌维护"].map((token) => ({
    id: `tag_${token}`,
    token,
    group: "tag" as const,
    kind: "tag" as const,
    role: "tag",
    title: token.replace("%", ""),
    description: "主题标签，用于风格、平台和模板推荐",
    color: brand.accentColor
  }));
  const assetItems = assets
    .filter((asset) => asset.brandId === brand.id && !asset.type.startsWith("generated_") && asset.imageUrl)
    .flatMap((asset) => {
      const ref = assetToRef(asset);
      if (!hasText(ref.title) && !hasText(ref.description)) return [];
      const shortItem = {
        ...ref,
        id: `asset_${asset.id}`,
        token: mentionTokenForRole(ref.role),
        group: "resource" as const,
        kind: "resource" as const
      };
      const qualifiedItem = {
        ...ref,
        id: `asset_${asset.id}_qualified`,
        token: `$${key}.${ref.role}`,
        group: "resource" as const,
        kind: "resource" as const,
        description: `${ref.description} · 精确引用 ${brand.name}.${ref.role}`
      };
      return [shortItem, qualifiedItem];
    });
  const coveredRoles = new Set(assetItems.map((item) => item.role));
  const brandPackage: MentionItem[] = [
    {
      id: `brand_package_${brand.id}`,
      token: `$${key}`,
      group: "resource",
      kind: "resource",
      role: "brand_package",
      title: `${brand.name} 全品牌包`,
      description: "引用该品牌全部可用图片素材、视觉风格和文本约束",
      color: brand.primaryColor,
      imageUrl: assetItems.find((item) => item.imageUrl)?.imageUrl
    }
  ];
  const brandItems: MentionItem[] = [
    { id: "brand_name", token: "$copy.brand_name", group: "copy", kind: "copy", role: "brand_name", title: brand.name, description: `跨品牌: $${key}.copy.brand_name`, color: brand.primaryColor },
    { id: "brand_name_qualified", token: `$${key}.copy.brand_name`, group: "copy", kind: "copy", role: "brand_name", title: brand.name, description: "品牌名称", color: brand.primaryColor },
    { id: "brand_slogan", token: "$copy.slogan", group: "copy", kind: "copy", role: "slogan", title: brand.slogan, description: `跨品牌: $${key}.copy.slogan`, color: brand.accentColor },
    { id: "brand_slogan_qualified", token: `$${key}.copy.slogan`, group: "copy", kind: "copy", role: "slogan", title: brand.slogan, description: "品牌口号", color: brand.accentColor },
    { id: "brand_promotion", token: "$copy.promotion", group: "copy", kind: "copy", role: "promotion", title: "促销文案", description: brand.slogan, color: brand.accentColor },
    { id: "brand_cta", token: "$copy.cta", group: "copy", kind: "copy", role: "cta", title: "行动按钮", description: "立即了解", color: brand.primaryColor },
    { id: "brand_logo_text", token: "$brand.logo_text", group: "copy", kind: "copy", role: "logo_text", title: brand.logoText, description: `跨品牌: $${key}.brand.logo_text`, color: brand.primaryColor },
    { id: "brand_ip_text", token: "$brand.ip", group: "copy", kind: "copy", role: "ip_text", title: brand.ipName, description: brand.ipDescription, color: brand.accentColor },
    { id: "brand_visual", token: "$brand.style", group: "copy", kind: "copy", role: "style", title: "视觉风格", description: brand.visualStyle, color: brand.accentColor },
    { id: "brand_tone", token: "$brand.tone", group: "copy", kind: "copy", role: "tone", title: "语气", description: brand.tone, color: brand.primaryColor },
    { id: "brand_scene", token: "$brand.scene", group: "copy", kind: "copy", role: "scene", title: "场景关键词", description: (brand.sceneKeywords ?? []).join(", "), color: brand.accentColor }
  ].filter((item): item is MentionItem => Boolean(hasText(item.title) && hasText(item.description)) && !coveredRoles.has(item.role));
  return [...agents, ...commands, ...brandPackage, ...assetItems, ...brandItems, ...tags].filter((item, index, list) => list.findIndex((candidate) => candidate.token === item.token && candidate.title === item.title) === index);
}

function assetToRef(asset: Asset): ReferenceItem {
  const role = assetRole(asset);
  return { id: `asset_${asset.id}`, role, title: asset.title, description: asset.meta, color: asset.color, imageUrl: asset.imageUrl };
}

function findAssetForRole(role: BrandAssetRole["role"], assets: Asset[]) {
  return assets.find((asset) => asset.imageUrl && assetRole(asset) === role);
}

function brandCompleteness(brand: Brand, assets: Asset[]) {
  const requiredTextFields: Array<keyof Brand> = [
    "name",
    "logoText",
    "slogan",
    "market",
    "targetAudience",
    "brandStory",
    "ipName",
    "ipDescription",
    "logoUsage",
    "visualStyle",
    "tone"
  ];
  const textDone = requiredTextFields.filter((field) => {
    const value = brand[field];
    return typeof value === "string" && value.trim().length > 0;
  }).length;
  const assetDone = requiredBrandSlots.filter((slot) => findAssetForRole(slot.role, assets)).length;
  const total = requiredTextFields.length + requiredBrandSlots.length;
  const done = textDone + assetDone;
  return {
    done,
    total,
    score: Math.round((done / total) * 100),
    textDone,
    assetDone
  };
}

type StoryboardTable = {
  headers: string[];
  rows: Array<{ index: number; cells: Record<string, string>; ref?: ReferenceItem }>;
};

function tableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function parseStoryboardTable(body = "", refs: ReferenceItem[] = []): StoryboardTable {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (lines.length < 3) return { headers: [], rows: [] };
  const headers = tableCells(lines[0]);
  const separator = tableCells(lines[1]).every((cell) => /^:?-{2,}:?$/.test(cell));
  if (!separator || !headers.includes("镜号")) return { headers: [], rows: [] };
  const rows = lines.slice(2).map((line, index) => {
    const values = tableCells(line);
    const cells = Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ""]));
    const referenceText = [cells["参考图"], cells["参考"], cells["角色"], cells["画面描述"]].filter(Boolean).join(" ").toLowerCase();
    const ref = refs.find((item) => {
      const haystack = [item.title, item.role, item.description].join(" ").toLowerCase();
      return referenceText.includes(item.title.toLowerCase()) || haystack.split(/\s+|·|\/|,|，/).some((token) => token && referenceText.includes(token));
    }) ?? refs[index % Math.max(refs.length, 1)];
    return { index, cells, ref };
  });
  return { headers, rows };
}

function parseMentionSummary(body = "") {
  body = normalizeLegacyPromptRefs(body);
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => /^[@/$%]/.test(line));
  return lines.slice(0, 8).map((line) => {
    const [token = "$引用", ...rest] = line.split(/\s+/);
    const copy = rest.join(" ").replace(/\[image\]/g, "").trim();
    return { token, copy: copy.length > 70 ? `${copy.slice(0, 70)}...` : copy };
  });
}

function normalizeLegacyPromptRefs(body: string) {
  return body
    .replace(/@LOGO\b/g, "$logo")
    .replace(/@logo\b/g, "$logo")
    .replace(/@IP\b/g, "$ip")
    .replace(/@ip\b/g, "$ip")
    .replace(/@产品/g, "$product")
    .replace(/@模特/g, "$model")
    .replace(/@店铺/g, "$storefront")
    .replace(/@环境/g, "$environment")
    .replace(/#slogen\b/g, "$copy.slogan")
    .replace(/#slogan\b/g, "$copy.slogan")
    .replace(/#brand_name\b/g, "$copy.brand_name")
    .replace(/@品牌/g, "$copy.brand_name")
    .replace(/@域名/g, "$copy.domain")
    .replace(/@视觉风格/g, "$brand.style")
    .replace(/@语气/g, "$brand.tone")
    .replace(/@场景/g, "$brand.scene")
    .replace(/@禁用项/g, "$brand.forbidden")
    .replace(/@((?!imgen\b)[\p{L}0-9_-]+\.[\p{L}0-9_-]+(?:\.[\p{L}0-9_-]+)*)/gu, "$$$1")
    .replace(/#([\p{L}0-9_-]+)\.([\p{L}0-9_-]+(?:\.[\p{L}0-9_-]+)*)/gu, (_match, brand, field) => {
      const normalized = field.toLowerCase() === "slogen" ? "slogan" : field.toLowerCase();
      return normalized.startsWith("copy.") || normalized.startsWith("brand.") ? `$${brand}.${normalized}` : `$${brand}.copy.${normalized}`;
    });
}

function insertReferenceToken(body: string, token: string) {
  const replaced = body.replace(/([@＠#＃$＄%％/])[^@＠#＃$＄%％/\s]*\s*$/u, token);
  const next = replaced === body ? `${body}${body.endsWith(" ") || !body ? "" : " "}${token}` : replaced;
  return `${next}${next.endsWith(" ") ? "" : " "}`;
}

function referenceTokenCandidates(raw: string) {
  const symbol = raw.startsWith("#") ? "#" : "@";
  const body = raw.slice(1).toLowerCase();
  const parts = body.split(".");
  const path = parts.length > 1 ? parts.slice(1).join(".") : body;
  const head = path.split(".")[0];
  const aliases: Record<string, string> = {
    slogen: "slogan",
    slogan: "slogan",
    brand: "brand_name",
    brandname: "brand_name",
    name: "brand_name",
    product_hero: "product",
    store: "storefront",
    scene: "environment",
    background: "environment"
  };
  const normalized = aliases[head] ?? head;
  return [`${symbol}${path}`, `${symbol}${normalized}`].map((item) => item.toLowerCase());
}

function buildPromptReferencePreview(prompt: string, items: MentionItem[]) {
  prompt = normalizeLegacyPromptRefs(prompt.replace(/＠/g, "@").replace(/＃/g, "#").replace(/＄/g, "$").replace(/％/g, "%"));
  const tokens = Array.from(prompt.matchAll(/([@/$%])([\p{L}0-9_-]+(?:\.[\p{L}0-9_-]+)*)/gu)).map((match) => match[0]);
  const images: MentionItem[] = [];
  const texts: MentionItem[] = [];
  for (const token of tokens) {
    const item = items.find((candidate) => candidate.token.toLowerCase() === token.toLowerCase());
    if (!item) continue;
    if (!["resource", "copy"].includes(item.kind)) continue;
    const target = item.imageUrl ? images : texts;
    if (!target.some((existing) => existing.id === item.id)) target.push(item);
  }
  return { images, texts, total: images.length + texts.length };
}

function activeReferenceQuery(prompt: string) {
  const normalized = prompt.replace(/＠/g, "@").replace(/＃/g, "#").replace(/＄/g, "$").replace(/％/g, "%");
  const match = normalized.match(/([@#/$%])([^@#/$%\s]*)$/u);
  if (!match) return null;
  return { symbol: match[1] as "@" | "#" | "/" | "$" | "%", query: match[2].toLowerCase() };
}

function filterMentionItems(items: MentionItem[], prompt: string) {
  const active = activeReferenceQuery(prompt);
  if (!active) return [];
  const pool = items.filter((item) => {
    if (active.symbol === "@") return item.kind === "agent";
    if (active.symbol === "#") return item.kind === "copy";
    if (active.symbol === "/") return item.kind === "command";
    if (active.symbol === "$") return item.kind === "resource" || item.kind === "copy";
    if (active.symbol === "%") return item.kind === "tag";
    return false;
  });
  if (!active.query) return pool;
  return pool.filter((item) => {
    if (active.query.includes(".")) return item.token.toLowerCase().includes(active.query);
    const haystack = `${item.token} ${item.title} ${item.description} ${item.role}`.toLowerCase();
    return haystack.includes(active.query);
  });
}

function mentionIconText(item: MentionItem, symbol: string) {
  if (item.imageUrl) return "";
  if (item.kind === "agent") return "AI";
  if (item.kind === "command") return "CMD";
  if (item.kind === "tag") return "TAG";
  if (item.kind === "copy") return symbol === "#" ? "TXT" : "TXT";
  return "IMG";
}

function displayMentionToken(item: MentionItem, symbol: string) {
  if (symbol === "#" && item.kind === "copy") {
    return item.token.replace(/^\$copy\./, "#").replace(/^\$brand\./, "#");
  }
  return item.token;
}

function promptTemplateForNode(type: WorkflowNode["type"], outputKind?: Frame["outputs"][number]["kind"]) {
  if (type === "video" || outputKind === "video") {
    return "@imgen /generate-video 使用 $product $logo，生成 16:9 横屏 5s 品牌短视频。镜头: 产品特写 -> 使用场景 -> 品牌收尾。风格 %premium -> mp4";
  }
  if (type === "script") {
    return "/write-video-script 使用 $product $ip，输出 5 镜头分镜表格：镜号 | 画面 | 运镜 | 时长 | 音效 | 字幕。风格 %真实摄影";
  }
  if (type === "process" || outputKind === "document") {
    return "/write-copy 使用 $copy.brand_name $copy.slogan，生成可编辑 Markdown：标题、卖点、三段正文、CTA。不要输出表格。";
  }
  if (type === "audio") {
    return "/write-audio 使用 $copy.slogan，生成 15s 广告配乐提示词：情绪、节奏、乐器、起承转合、结尾品牌记忆点。";
  }
  if (type === "compose") {
    return "/compose-video 选择多个视频片段，按 开场钩子 -> 产品证明 -> 优惠 CTA 合成，转场干净，输出 9:16 MP4。";
  }
  return "@imgen /generate-poster 使用 $logo $product $ip，生成 Meta Feed 4:5 商业海报。主体清晰、无乱码文字、保留 logo 安全边距。风格 %premium -> jpg";
}

function StoryboardBoard({ body, refs, compact = false }: { body: string; refs: ReferenceItem[]; compact?: boolean }) {
  const table = parseStoryboardTable(body, refs);
  if (!table.rows.length) return null;
  const visibleRows = compact ? table.rows.slice(0, 3) : table.rows;
  return (
    <div className={`rh-storyboard ${compact ? "compact" : ""}`}>
      {!compact && <div className="rh-storyboard-head"><strong>故事版</strong><small>{table.rows.length} 镜头 · 可接视频节点</small></div>}
      <div className="rh-storyboard-grid">
        {visibleRows.map((row) => (
          <article key={`${row.cells["镜号"]}_${row.index}`}>
            <div className="rh-story-thumb" style={row.ref?.imageUrl ? { backgroundImage: `url(${row.ref.imageUrl})` } : { background: row.ref?.color ?? "#1f2937" }}>
              {!row.ref?.imageUrl && <Image />}
              <b>{row.cells["镜号"] || row.index + 1}</b>
            </div>
            <div className="rh-story-copy">
              <strong>{row.cells["画面描述"] || "未命名镜头"}</strong>
              <p>{row.cells["分镜提示词"] || row.cells["角色动作"] || row.cells["角色描述"]}</p>
              <div>
                <span>{row.cells["时长"] || "3s"}</span>
                <span>{row.cells["景别"] || "镜头"}</span>
                <span>{row.cells["情绪"] || "情绪"}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function safeDownloadName(title = "sparkcanvas-asset") {
  return title.replace(/[\\/:*?"<>|#%&{}$!`'@+=]/g, "-").replace(/\s+/g, "-").slice(0, 80) || "sparkcanvas-asset";
}

function fileExtension(url = "", fallback = "png") {
  const cleanUrl = url.split("?")[0].toLowerCase();
  if (url.includes("image/jpeg") || cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "jpg";
  if (url.includes("image/webp") || cleanUrl.endsWith(".webp")) return "webp";
  if (url.includes("video/mp4") || cleanUrl.endsWith(".mp4") || cleanUrl.includes("/videos/")) return "mp4";
  if (url.includes("application/pdf") || cleanUrl.endsWith(".pdf")) return "pdf";
  return fallback;
}

function downloadFile(url: string | undefined, title: string, fallbackExt = "png") {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeDownloadName(title)}.${fileExtension(url, fallbackExt)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadImage(url: string | undefined, title: string) {
  downloadFile(url, title, "png");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiDiagnostics, setAiDiagnostics] = useState<AiDiagnostics | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [locale, setLocaleState] = useState<Locale>(defaultLocale in i18n ? defaultLocale : "zh");
  const [siteMode, setSiteMode] = useState(() => new URLSearchParams(window.location.search).get("site") === "1");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState<Viewport>({ x: 76, y: 64, scale: 0.72 });
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [assetSelection, setAssetSelection] = useState<string[]>([]);

  const activeBrand = brands.find((brand) => brand.active) ?? brands[0];
  const activeFrame = selectedFrameId ? frames.find((frame) => frame.id === selectedFrameId) : frames[0];
  const frameBrand = activeFrame?.brandId ? brands.find((brand) => brand.id === activeFrame.brandId) : undefined;
  const projectBrand = activeFrame ? frameBrand : activeBrand;
  const model = models.find((item) => item.id === activeFrame?.modelId) ?? models[0];
  const activeBrandAssets = projectBrand ? assets.filter((asset) => asset.brandId === projectBrand.id) : [];
  const t = i18n[locale];

  function setLocale(nextLocale: Locale) {
    setLocaleState(nextLocale);
    window.localStorage.setItem("sparkcanvas.locale", nextLocale);
  }

  function openSiteMode() {
    setSiteMode(true);
    window.history.replaceState(null, "", "/?site=1");
  }

  function enterWorkspace() {
    setSiteMode(false);
    window.history.replaceState(null, "", "/");
    if (!user) void login().catch((caught) => setError(caught instanceof Error ? caught.message : "登录失败"));
  }

  async function loadWorkspace() {
    const workspace = await api.get<Workspace>("/workspace");
    setUser(workspace.user);
    setBrands(workspace.brands);
    setAssets(workspace.assets);
    setTemplates(workspace.templates);
    setModels(workspace.models);
    setFrames(workspace.frames);
    setTasks(workspace.tasks);
    setAiStatus(workspace.ai ?? null);
    setSelectedFrameId((current) => current && workspace.frames.some((frame) => frame.id === current) ? current : workspace.frames[0]?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    if (!window.localStorage.getItem("sparkcanvas.token")) {
      setLoading(false);
      return;
    }
    void loadWorkspace().catch(() => {
      window.localStorage.removeItem("sparkcanvas.token");
      setUser(null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!frames.some((frame) => frame.status === "generating")) return;
    const timer = window.setInterval(() => void loadWorkspace(), 700);
    return () => window.clearInterval(timer);
  }, [frames]);

  async function login() {
    setLoading(true);
    setError("");
    const result = await api.post<{ token: string; user: User }>("/auth/login", { account: "shift", password: "123456" });
    window.localStorage.setItem("sparkcanvas.token", result.token);
    setUser(result.user);
    await loadWorkspace();
  }

  async function checkAiDiagnostics() {
    setError("");
    try {
      const result = await api.get<AiDiagnostics>("/ai/diagnostics");
      setAiDiagnostics(result);
      setAiStatus(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Skill 检查失败");
    }
  }

  async function updateFrame(frameId: string, patch: FramePatch) {
    const updated = await api.patch<Frame>(`/canvas/frames/${frameId}`, patch);
    setFrames((current) => current.map((frame) => frame.id === updated.id ? updated : frame));
    return updated;
  }

  function canvasImageNode(nodePrompt: string, frame?: Frame): WorkflowNode {
    const existingNodes = frame?.workflowNodes ?? [];
    const siblingCount = existingNodes.filter((node) => node.type === "image" || node.type === "reference" || node.type === "output").length;
    return {
      id: `node_img_${Date.now().toString(36)}`,
      type: "image",
      title: "Image",
      body: nodePrompt,
      preview: projectBrand?.accentColor ?? "#f97316",
      refs: [],
      x: 120 + (siblingCount % 4) * 280,
      y: 140 + Math.floor(siblingCount / 4) * 310,
      w: 250,
      h: 300
    };
  }

  async function generate(input = prompt, template?: Template, controls: WorkflowControls = { outputTarget: "jpg", orientation: "portrait", preset: "feed-45" }) {
    if (!input.trim() || !model) return;
    setError("");
    const naturalBrand = inferBrandForPrompt(input, brands);
    const selectedProjectBrand = activeFrame?.brandId ? frameBrand : undefined;
    const generationBrand = naturalBrand ?? selectedProjectBrand;
    const shouldInjectBrand = Boolean(generationBrand && (promptRequestsWholeBrand(input, generationBrand) || activeFrame?.settings?.brandInject));
    const settings = {
      ...(activeFrame?.settings ?? defaultSettings),
      brandInject: shouldInjectBrand
    };
    try {
      const result = await api.post<WorkflowGenerateResponse>("/generate", {
        prompt: input,
        mode: "magic",
        templateId: template?.id,
        modelId: model.id,
        brandId: generationBrand?.id ?? null,
        brandInject: shouldInjectBrand,
        outputTarget: controls.outputTarget,
        orientation: controls.orientation,
        settings
      });
      setFrames((current) => [result.frame, ...current.filter((frame) => frame.id !== result.frame.id)]);
      setTasks((current) => [result.task, ...current.filter((task) => task.id !== result.task.id)]);
      setSelectedFrameId(result.frame.id);
      setPrompt("");
      setUser((current) => current ? { ...current, credits: result.credits } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片生成失败");
      throw caught;
    }
  }

  async function createProject(options?: { title?: string; brandId?: string | null }) {
    const frame = await api.post<Frame>("/canvas/frames", {
      title: options?.title,
      brandId: options?.brandId === undefined ? activeBrand?.id ?? null : options.brandId
    });
    setFrames((current) => [frame, ...current]);
    setSelectedFrameId(frame.id);
    setEditingNodeId(null);
    setPanel(null);
    return frame;
  }

  async function saveBrand(brand: Brand) {
    const updated = await api.patch<Brand>(`/brands/${brand.id}`, brand);
    setBrands((current) => current.map((item) => item.id === updated.id ? updated : updated.active ? { ...item, active: false } : item));
  }

  async function createBrand() {
    const nextName = `新品牌 ${brands.length + 1}`;
    const created = await api.post<Brand>("/brands", {
      name: nextName,
      logoText: "NB",
      primaryColor: "#111827",
      accentColor: "#0ea5e9",
      tone: "clean commercial visuals",
      market: "new ecommerce brand",
      slogan: "new brand workspace",
      autoInject: true
    });
    const activated = await api.patch<Brand>(`/brands/${created.id}`, { active: true });
    setBrands((current) => [...current.map((item) => ({ ...item, active: false })), activated]);
    setPanel("brand");
  }

  async function createAsset(file: File, type: Asset["type"] = "upload", options: AssetUploadOptions = {}) {
    if (!activeBrand) return;
    const imageUrl = await readFileAsDataUrl(file);
    const asset = await api.post<Asset>("/assets", {
      title: options.title ?? file.name.replace(/\.[^.]+$/, ""),
      type,
      color: activeBrand.accentColor,
      meta: options.meta ?? "uploaded reference",
      imageUrl,
      brandId: activeBrand.id
    });
    setAssets((current) => [asset, ...current]);
  }

  async function deleteAsset(assetId: string) {
    await api.delete<{ ok: true; id: string }>(`/assets/${assetId}`);
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
  }

  async function updateAsset(assetId: string, patch: Partial<Pick<Asset, "title" | "type" | "meta" | "color">>) {
    const updated = await api.patch<Asset>(`/assets/${assetId}`, patch);
    setAssets((current) => current.map((asset) => asset.id === updated.id ? updated : asset));
  }

  async function saveGeneratedAsset(target: PreviewTarget) {
    if (!activeBrand || !target.imageUrl) return;
    const asset = await api.post<Asset>("/assets", {
      title: target.title || "Generated image",
      type: "generated_image",
      color: activeBrand.accentColor,
      meta: target.subtitle || "saved from canvas output",
      imageUrl: target.imageUrl,
      brandId: activeBrand.id
    });
    setAssets((current) => [asset, ...current]);
    setPanel("assets");
  }

  async function addSelectedAssetsToCanvas() {
    if (!activeFrame) return;
    const selectedAssets = assets.filter((asset) => assetSelection.includes(asset.id));
    const refs = selectedAssets.map(assetToRef);
    const nodes = normalizeWorkflowNodes(activeFrame.workflowNodes, shouldUseDefaultWorkflow(activeFrame.workflowNodes));
    if (!nodes.some((node) => node.id === "input-image")) {
      const nextNodes: WorkflowNode[] = [{
        id: `node_refs_${Date.now().toString(36)}`,
        type: "reference",
        title: "素材参考",
        body: refs.map((item) => `${item.role}: ${item.title}`).join(" / "),
        preview: activeBrand?.accentColor ?? "#f97316",
        refs,
        x: 120,
        y: 160,
        w: 250,
        h: 300
      }];
      await updateFrame(activeFrame.id, { workflowNodes: nextNodes });
      return;
    }
    const nextNodes = nodes.map((node) => {
      if (node.id !== "input-image") return node;
      const nextRefs = [...(node.refs ?? []), ...refs].filter((ref, index, list) => list.findIndex((item) => item.id === ref.id) === index);
      return { ...node, refs: nextRefs, body: nextRefs.map((item) => `${item.role}: ${item.title}`).join(" / ") };
    });
    await updateFrame(activeFrame.id, { workflowNodes: nextNodes });
  }

  async function generateNodeImage(nodeId: string, nodePrompt: string, modelId?: string, settings?: Partial<GenerationSettings>) {
    if (!activeFrame) return;
    setError("");
    try {
      const result = await api.post<NodeGenerateResponse>(`/canvas/frames/${activeFrame.id}/nodes/${nodeId}/generate`, { prompt: nodePrompt, modelId: modelId ?? model?.id, settings: settings ?? activeFrame.settings });
      setFrames((current) => current.map((frame) => frame.id === result.frame.id ? result.frame : frame));
      if (result.generated === false) setError(result.message ?? "图片生成已降级，请检查 IMAGE_GEN_KEY。");
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片节点生成失败");
      throw caught;
    }
  }

  async function generateNodeText(nodeId: string, nodePrompt: string, modelId: string, translate: boolean, mode = "story") {
    if (!activeFrame) return;
    setError("");
    try {
      const result = await api.post<TextGenerateResponse>(`/canvas/frames/${activeFrame.id}/nodes/${nodeId}/generate-text`, { prompt: nodePrompt, model: modelId, translate, mode });
      setFrames((current) => current.map((frame) => frame.id === result.frame.id ? result.frame : frame));
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文本节点生成失败");
      throw caught;
    }
  }

  async function generateNodeScript(nodeId: string, nodePrompt: string, modelId: string, translate: boolean) {
    if (!activeFrame) return;
    setError("");
    try {
      const result = await api.post<ScriptGenerateResponse>(`/canvas/frames/${activeFrame.id}/nodes/${nodeId}/generate-script`, { prompt: nodePrompt, model: modelId, translate });
      setFrames((current) => current.map((frame) => frame.id === result.frame.id ? result.frame : frame));
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "脚本节点生成失败");
      throw caught;
    }
  }

  async function generateNodeVideo(nodeId: string, nodePrompt: string, modelId: string, settings: { mode: string; ratio: string; duration: string; sound: boolean; translate: boolean }) {
    if (!activeFrame) return;
    setError("");
    try {
      const result = await api.post<VideoGenerateResponse>(`/canvas/frames/${activeFrame.id}/nodes/${nodeId}/generate-video`, { prompt: nodePrompt, model: modelId, settings });
      setFrames((current) => current.map((frame) => frame.id === result.frame.id ? result.frame : frame));
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "视频节点保存失败");
      throw caught;
    }
  }

  async function generateNodeAudio(nodeId: string, nodePrompt: string, modelId: string, settings: { mode: string; duration: string; scene: string; loop: boolean; translate: boolean }) {
    if (!activeFrame) return;
    setError("");
    try {
      const result = await api.post<AudioGenerateResponse>(`/canvas/frames/${activeFrame.id}/nodes/${nodeId}/generate-audio`, { prompt: nodePrompt, model: modelId, settings });
      setFrames((current) => current.map((frame) => frame.id === result.frame.id ? result.frame : frame));
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "音频节点保存失败");
      throw caught;
    }
  }

  if (loading) return <div className="rh-loading"><Loader2 className="spin" /> SparkCanvas</div>;
  if (siteMode || !user) return <LoginScreen locale={locale} setLocale={setLocale} error={error} onLogin={enterWorkspace} />;

  return (
    <div className="rh-app">
      <header className="rh-topbar">
        <button type="button" className="rh-logo" onClick={openSiteMode} title="SparkCanvas website">
          <span>SC</span><div><strong>SparkCanvas</strong><small>{activeBrand?.name ?? "XMANX"}</small></div>
        </button>
        <div className="rh-top-prompt rh-top-status">
          <Sparkles />
          <span>{t.topStatus}</span>
        </div>
        <div className="rh-top-meta">
          <span>{model?.name ?? "@imgen · image skill"}</span>
          <em className={aiStatus?.imageGeneration.configured ? "ready" : "missing"}>
            {aiStatus?.imageGeneration.configured ? `Skill · ${aiStatus.imageGeneration.model}` : "Skill key missing"}
          </em>
          <button type="button" onClick={() => void checkAiDiagnostics()} title={aiDiagnostics?.runtime.message ?? "检查本地图片生成 Skill"}>
            <RefreshCw />{t.check}
          </button>
          <select className="rh-lang-select" value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label="Language">
            {localeOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
          <strong>{user.credits}</strong>
        </div>
      </header>

      <aside className="rh-rail">
        <RailButton active={panel === "projects"} icon={<Plus />} label={t.nav.projects} onClick={() => setPanel(panel === "projects" ? null : "projects")} />
        <RailButton active={panel === "templates"} icon={<Layers3 />} label={t.nav.templates} onClick={() => setPanel(panel === "templates" ? null : "templates")} />
        <RailButton active={panel === "assets"} icon={<Image />} label={t.nav.assets} onClick={() => setPanel(panel === "assets" ? null : "assets")} />
        <RailButton active={panel === "history"} icon={<History />} label={t.nav.history} onClick={() => setPanel(panel === "history" ? null : "history")} />
        <RailButton active={panel === "tutorial"} icon={<HelpCircle />} label={t.nav.tutorial} onClick={() => setPanel(panel === "tutorial" ? null : "tutorial")} />
        <RailButton active={panel === "brand"} icon={<Palette />} label={t.nav.brand} onClick={() => setPanel(panel === "brand" ? null : "brand")} />
      </aside>

      {panel && (
        <>
          <button className="rh-dismiss" type="button" onClick={() => setPanel(null)} aria-label="Close drawer" />
          <SideDrawer
            panel={panel}
            locale={locale}
            frames={frames}
            selectedFrameId={activeFrame?.id}
            assets={activeBrandAssets}
            brands={brands}
            activeBrand={activeBrand}
            templates={templates}
            assetSelection={assetSelection}
            onSelectFrame={(id) => { setSelectedFrameId(id); setPanel(null); }}
            onCreateProject={(options) => void createProject(options)}
            onUpdateFrame={(frameId, patch) => void updateFrame(frameId, patch)}
            onCreateBrand={() => void createBrand()}
            onSelectBrand={(brandId) => {
              const selected = brands.find((brand) => brand.id === brandId);
              if (selected) void saveBrand({ ...selected, active: true });
            }}
            onSelectAsset={(id) => setAssetSelection((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
            onAddAssets={() => void addSelectedAssetsToCanvas()}
            onUpload={(file, type, options) => void createAsset(file, type, options)}
            onUpdateAsset={(id, patch) => void updateAsset(id, patch)}
            onDeleteAsset={(id) => void deleteAsset(id)}
            onSaveBrand={(brand) => void saveBrand(brand)}
            onUseTemplate={(template) => void generate(prompt, template)}
            onClose={() => setPanel(null)}
          />
        </>
      )}

      <Canvas
        frame={activeFrame}
        assets={assets}
        activeBrand={projectBrand}
        model={model}
        models={models}
        viewport={viewport}
        setViewport={setViewport}
        preview={preview}
        setPreview={setPreview}
        editingNodeId={editingNodeId}
        setEditingNodeId={setEditingNodeId}
        onUpdateFrame={(patch) => activeFrame ? updateFrame(activeFrame.id, patch) : undefined}
        onGenerateNode={(nodeId, nodePrompt, modelId, settings) => generateNodeImage(nodeId, nodePrompt, modelId, settings)}
        onGenerateTextNode={(nodeId, nodePrompt, modelId, translate, mode) => generateNodeText(nodeId, nodePrompt, modelId, translate, mode)}
        onGenerateScriptNode={(nodeId, nodePrompt, modelId, translate) => generateNodeScript(nodeId, nodePrompt, modelId, translate)}
        onGenerateVideoNode={(nodeId, nodePrompt, modelId, settings) => generateNodeVideo(nodeId, nodePrompt, modelId, settings)}
        onGenerateAudioNode={(nodeId, nodePrompt, modelId, settings) => generateNodeAudio(nodeId, nodePrompt, modelId, settings)}
      />

      {!editingNodeId && (
        <BottomComposer
          frame={activeFrame}
          prompt={prompt}
          setPrompt={setPrompt}
          activeBrand={projectBrand}
          brands={brands}
          model={model}
          models={models}
          assets={assets}
          aiStatus={aiStatus}
          aiDiagnostics={aiDiagnostics}
          onGenerate={(controls, promptOverride) => void generate(promptOverride ?? prompt, undefined, controls)}
          onCreateProject={() => void createProject({ brandId: projectBrand?.id ?? null })}
          onUpdateFrame={(patch) => activeFrame && void updateFrame(activeFrame.id, patch)}
        />
      )}

      {preview && <ImagePreview preview={preview} onClose={() => setPreview(null)} onSaveAsset={(target) => void saveGeneratedAsset(target)} />}
      {error && <div className="rh-error">{error}</div>}
    </div>
  );
}

function LoginScreen({ locale, setLocale, error, onLogin }: { locale: Locale; setLocale: (locale: Locale) => void; error: string; onLogin: () => void }) {
  const copy = i18n[locale].login;
  return (
    <main className="rh-login">
      <nav className="rh-site-nav">
        <div className="rh-site-brand">
          <img src="/site-assets/sparkcanvas-logo-skill.png" alt="SparkCanvas logo" />
          <strong>SparkCanvas</strong>
        </div>
        <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label="Language">
          {localeOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
      </nav>
      <section className="rh-site-hero">
        <div className="rh-site-copy">
          <span className="rh-site-badge">{copy.badge}</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
          <div className="rh-site-prompt"><code>{copy.prompt}</code></div>
          <div className="rh-site-actions">
            <button type="button" onClick={onLogin}><Lock />{copy.cta}</button>
            <a href="#cal-guide">{copy.secondary}</a>
          </div>
          {error && <small>{error}</small>}
        </div>
        <div className="rh-site-visual">
          <img src="/site-assets/sparkcanvas-hero-skill.png" alt="SparkCanvas AI canvas workflow" />
        </div>
      </section>
      <section className="rh-site-stats">
        {copy.stats.map((item) => <strong key={item}>{item}</strong>)}
      </section>
      <section className="rh-site-features">
        {copy.features.map(([title, body]) => (
          <article key={title}>
            <Sparkles />
            <strong>{title}</strong>
            <p>{body}</p>
          </article>
        ))}
      </section>
      <section id="cal-guide" className="rh-site-guide">
        <div>
          <span className="rh-site-badge">{copy.syntaxTitle}</span>
          <h2>{copy.syntaxTitle}</h2>
        </div>
        <div className="rh-site-syntax">
          {copy.syntax.map(([token, body]) => (
            <article key={token}>
              <code>{token}</code>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function RailButton({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button className={active ? "active" : ""} type="button" title={label} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function SideDrawer(props: {
  panel: Exclude<PanelKey, null>;
  locale: Locale;
  frames: Frame[];
  selectedFrameId?: string;
  assets: Asset[];
  brands: Brand[];
  activeBrand?: Brand;
  templates: Template[];
  assetSelection: string[];
  onSelectFrame: (id: string) => void;
  onCreateProject: (options?: { title?: string; brandId?: string | null }) => void;
  onUpdateFrame: (frameId: string, patch: Pick<FramePatch, "title" | "settings" | "brandId" | "brandInject">) => void;
  onCreateBrand: () => void;
  onSelectBrand: (id: string) => void;
  onSelectAsset: (id: string) => void;
  onAddAssets: () => void;
  onUpload: (file: File, type: Asset["type"], options?: AssetUploadOptions) => void;
  onUpdateAsset: (id: string, patch: Partial<Pick<Asset, "title" | "type" | "meta" | "color">>) => void;
  onDeleteAsset: (id: string) => void;
  onSaveBrand: (brand: Brand) => void;
  onUseTemplate: (template: Template) => void;
  onClose: () => void;
}) {
  const drawerTitle = i18n[props.locale].drawer;
  return (
    <aside className="rh-drawer">
      <div className="rh-drawer-head">
        <strong>{drawerTitle[props.panel]}</strong>
        <button type="button" onClick={props.onClose}><PanelLeftClose /></button>
      </div>
      {props.panel === "projects" && <ProjectPanel frames={props.frames} brands={props.brands} activeBrand={props.activeBrand} selectedFrameId={props.selectedFrameId} onSelect={props.onSelectFrame} onCreate={props.onCreateProject} onUpdateFrame={props.onUpdateFrame} />}
      {props.panel === "assets" && <AssetPanel assets={props.assets} selection={props.assetSelection} onSelect={props.onSelectAsset} onAddAssets={props.onAddAssets} onUpload={props.onUpload} onUpdate={props.onUpdateAsset} onDelete={props.onDeleteAsset} />}
      {props.panel === "brand" && props.activeBrand && <BrandPanel brands={props.brands} brand={props.activeBrand} assets={props.assets} onCreate={props.onCreateBrand} onSelect={props.onSelectBrand} onSave={props.onSaveBrand} onUpload={props.onUpload} />}
      {props.panel === "templates" && <TemplatePanel templates={props.templates} onUse={props.onUseTemplate} />}
      {props.panel === "history" && <HistoryPanel frames={props.frames} selectedFrameId={props.selectedFrameId} onSelect={props.onSelectFrame} />}
      {props.panel === "tutorial" && <TutorialPanel locale={props.locale} />}
    </aside>
  );
}

function ProjectPanel({
  frames,
  brands,
  activeBrand,
  selectedFrameId,
  onSelect,
  onCreate,
  onUpdateFrame
}: {
  frames: Frame[];
  brands: Brand[];
  activeBrand?: Brand;
  selectedFrameId?: string;
  onSelect: (id: string) => void;
  onCreate: (options?: { title?: string; brandId?: string | null }) => void;
  onUpdateFrame: (frameId: string, patch: Pick<FramePatch, "title" | "settings" | "brandId" | "brandInject">) => void;
}) {
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId);
  const [newTitle, setNewTitle] = useState("");
  const [newBrandId, setNewBrandId] = useState<string | null>(activeBrand?.id ?? null);
  const projectCount = frames.length + 1;
  const selectedBrandId = selectedFrame?.brandId || "";
  function createNamedProject() {
    onCreate({
      title: newTitle.trim() || `未命名画布 ${projectCount}`,
      brandId: newBrandId
    });
    setNewTitle("");
  }
  function updateProjectBrand(brandId: string) {
    if (!selectedFrame) return;
    const nextBrandId = brandId || null;
    onUpdateFrame(selectedFrame.id, {
      brandId: nextBrandId,
      settings: { ...selectedFrame.settings, brandInject: Boolean(nextBrandId && selectedFrame.settings.brandInject) },
      brandInject: Boolean(nextBrandId && selectedFrame.settings.brandInject)
    });
  }
  return (
    <div className="rh-panel-list">
      <section className="rh-project-create">
        <div className="rh-project-create-head"><Plus /><strong>新建项目 / 流程</strong></div>
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={`未命名画布 ${projectCount}`} />
        <select value={newBrandId ?? ""} onChange={(event) => setNewBrandId(event.target.value || null)}>
          <option value="">无品牌项目</option>
          {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
        </select>
        <button className="rh-create-project" type="button" onClick={createNamedProject}>创建空画布</button>
      </section>
      {selectedFrame && (
        <section className="rh-project-settings">
          <strong>当前项目</strong>
          <input value={selectedFrame.title} onChange={(event) => onUpdateFrame(selectedFrame.id, { title: event.target.value })} aria-label="项目名称" />
          <select value={selectedBrandId} onChange={(event) => updateProjectBrand(event.target.value)}>
            <option value="">无品牌</option>
            {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
          </select>
          <small>{selectedBrandId ? "项目属于该品牌；生成时可选择是否注入品牌上下文。" : "无品牌项目不会自动注入品牌；仍可用 $xmanx.logo 跨品牌引用。"}</small>
        </section>
      )}
      {frames.map((frame) => (
        <button className={frame.id === selectedFrameId ? "active" : ""} type="button" key={frame.id} onClick={() => onSelect(frame.id)}>
          <span>{frame.status === "generating" ? <Loader2 className="spin" /> : <FolderKanban />}</span>
          <div><strong>{frame.title}</strong><small>{frame.brandName || "无品牌"} · {frame.modelName} · {frame.progress}%</small></div>
        </button>
      ))}
    </div>
  );
}

function AssetPanel(props: {
  assets: Asset[];
  selection: string[];
  onSelect: (id: string) => void;
  onAddAssets: () => void;
  onUpload: (file: File, type: Asset["type"], options?: AssetUploadOptions) => void;
  onUpdate: (id: string, patch: Partial<Pick<Asset, "title" | "type" | "meta" | "color">>) => void;
  onDelete: (id: string) => void;
}) {
  const [uploadType, setUploadType] = useState<Asset["type"]>("upload");
  return (
    <div className="rh-assets">
      <div className="rh-upload-row">
        <select value={uploadType} onChange={(event) => setUploadType(event.target.value as Asset["type"])}>
          <option value="logo">Logo</option>
          <option value="product">Product</option>
          <option value="model">IP / Model</option>
          <option value="upload">Scene</option>
        </select>
        <label><Upload />上传<input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && props.onUpload(event.target.files[0], uploadType)} /></label>
      </div>
      <button className="rh-primary-wide" type="button" onClick={props.onAddAssets} disabled={props.selection.length === 0}>加入当前画布参考 ({props.selection.length})</button>
      <div className="rh-asset-grid">
        {props.assets.map((asset) => (
          <article className={props.selection.includes(asset.id) ? "selected" : ""} key={asset.id}>
            <button type="button" className="rh-asset-thumb" onClick={() => props.onSelect(asset.id)} style={asset.imageUrl ? { backgroundImage: `url(${asset.imageUrl})` } : { background: asset.color }}>
              {!asset.imageUrl && <Image />}
            </button>
            <input value={asset.title} onChange={(event) => props.onUpdate(asset.id, { title: event.target.value })} aria-label="素材名称" />
            <textarea value={asset.meta} onChange={(event) => props.onUpdate(asset.id, { meta: event.target.value })} aria-label="素材用途" />
            <select value={asset.type} onChange={(event) => props.onUpdate(asset.id, { type: event.target.value as Asset["type"] })} aria-label="素材类型">
              <option value="logo">Logo</option>
              <option value="product">Product</option>
              <option value="model">IP / Model</option>
              <option value="upload">Scene</option>
            </select>
            <div>
              {asset.imageUrl && <button type="button" onClick={() => downloadImage(asset.imageUrl, asset.title)}><Download /></button>}
              <button type="button" onClick={() => props.onDelete(asset.id)}><Trash2 /></button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BrandPanel({
  brands,
  brand,
  assets,
  onCreate,
  onSelect,
  onSave,
  onUpload
}: {
  brands: Brand[];
  brand: Brand;
  assets: Asset[];
  onCreate: () => void;
  onSelect: (id: string) => void;
  onSave: (brand: Brand) => void;
  onUpload: (file: File, type: Asset["type"], options?: AssetUploadOptions) => void;
}) {
  const [draft, setDraft] = useState(brand);
  useEffect(() => setDraft(brand), [brand]);
  const brandAssets = assets.filter((asset) => asset.brandId === brand.id);
  const complete = brandCompleteness(draft, brandAssets);
  return (
    <div className="rh-brand">
      <div className="rh-brand-switcher">
        <select value={brand.id} onChange={(event) => onSelect(event.target.value)}>
          {brands.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <button type="button" onClick={onCreate}><Plus />新建品牌</button>
      </div>
      <section className="rh-brand-score">
        <div>
          <strong>品牌采集完整度</strong>
          <small>{complete.textDone} 项文字 · {complete.assetDone} 项图片素材 · 后续工作流自动注入 $资源</small>
        </div>
        <b>{complete.score}%</b>
        <span><i style={{ width: `${complete.score}%` }} /></span>
      </section>
      <div className="rh-brand-card">
        <span style={{ background: draft.primaryColor }}>{draft.logoText}</span>
        <div><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><small>{draft.market}</small></div>
      </div>
      <section className="rh-brand-slots">
        <div className="rh-section-title">
          <strong>品牌素材采集</strong>
          <small>上传后可在提示词里直接输入 $logo、$ip、$product，也可跨品牌写 $xmanx.logo。</small>
        </div>
        <div className="rh-brand-slot-grid">
          {requiredBrandSlots.map((slot) => {
            const asset = findAssetForRole(slot.role, brandAssets);
            return (
              <article className={asset ? "ready" : ""} key={slot.role}>
                <button
                  type="button"
                  className="rh-brand-slot-thumb"
                  style={asset?.imageUrl ? { backgroundImage: `url(${asset.imageUrl})` } : { background: draft.primaryColor }}
                  title={asset ? asset.title : slot.hint}
                >
                  {!asset?.imageUrl && <ImagePlus />}
                </button>
                <div>
                  <strong>{slot.token} {slot.title}</strong>
                  <small>{asset ? asset.title : slot.hint}</small>
                </div>
                <label>
                  <Upload />{asset ? "替换" : "上传"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      onUpload(file, slot.assetType, {
                        title: `${draft.name} ${slot.title}`,
                        meta: `${slot.token} · ${slot.hint}`
                      });
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </article>
            );
          })}
        </div>
      </section>
      <label>品牌定位<textarea value={draft.slogan} onChange={(event) => setDraft({ ...draft, slogan: event.target.value })} /></label>
      <label>行业 / 市场<input value={draft.market} onChange={(event) => setDraft({ ...draft, market: event.target.value })} /></label>
      <label>目标用户<textarea value={draft.targetAudience} onChange={(event) => setDraft({ ...draft, targetAudience: event.target.value })} /></label>
      <label>品牌故事<textarea value={draft.brandStory} onChange={(event) => setDraft({ ...draft, brandStory: event.target.value })} /></label>
      <div className="rh-color-row">
        <label>IP 名称<input value={draft.ipName} onChange={(event) => setDraft({ ...draft, ipName: event.target.value })} /></label>
        <label>Logo 文本<input value={draft.logoText} onChange={(event) => setDraft({ ...draft, logoText: event.target.value.slice(0, 8) })} /></label>
      </div>
      <label>IP 设定<textarea value={draft.ipDescription} onChange={(event) => setDraft({ ...draft, ipDescription: event.target.value })} /></label>
      <label>Logo 使用规范<textarea value={draft.logoUsage} onChange={(event) => setDraft({ ...draft, logoUsage: event.target.value })} /></label>
      <label>视觉风格<textarea value={draft.visualStyle} onChange={(event) => setDraft({ ...draft, visualStyle: event.target.value })} /></label>
      <label>语气<textarea value={draft.tone} onChange={(event) => setDraft({ ...draft, tone: event.target.value })} /></label>
      <label>场景关键词<input value={(draft.sceneKeywords ?? []).join(", ")} onChange={(event) => setDraft({ ...draft, sceneKeywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
      <label>禁用词<input value={(draft.forbiddenWords ?? []).join(", ")} onChange={(event) => setDraft({ ...draft, forbiddenWords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></label>
      <div className="rh-color-row">
        <label>主色<input type="color" value={draft.primaryColor} onChange={(event) => setDraft({ ...draft, primaryColor: event.target.value })} /></label>
        <label>强调<input type="color" value={draft.accentColor} onChange={(event) => setDraft({ ...draft, accentColor: event.target.value })} /></label>
      </div>
      <button className="rh-primary-wide" type="button" onClick={() => onSave(draft)}><RefreshCw />保存品牌</button>
      <label className="rh-brand-upload"><Upload />上传补充素材<input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0], "upload", { meta: "$asset · supplemental brand reference" })} /></label>
      <div className="rh-brand-assets">
        {brandAssets.filter((asset) => asset.imageUrl).map((asset) => (
          <span key={asset.id} title={`${mentionTokenForRole(assetRole(asset))} ${asset.title}`} style={{ backgroundImage: `url(${asset.imageUrl})` }} />
        ))}
      </div>
    </div>
  );
}

function TemplatePanel({ templates, onUse }: { templates: Template[]; onUse: (template: Template) => void }) {
  return (
    <div className="rh-template-list">
      {templates.map((template) => (
        <button type="button" key={template.id} onClick={() => onUse(template)}>
          <Sparkles />
          <div><strong>{template.title}</strong><small>{template.category} · {template.ratio} · {template.cost} credits</small></div>
        </button>
      ))}
    </div>
  );
}

function HistoryPanel({ frames, selectedFrameId, onSelect }: { frames: Frame[]; selectedFrameId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="rh-panel-list">
      {frames.map((frame) => (
        <button className={frame.id === selectedFrameId ? "active" : ""} type="button" key={frame.id} onClick={() => onSelect(frame.id)}>
          <History />
          <div>
            <strong>{frame.title}</strong>
            <small>{frame.status} · {new Date(frame.updatedAt ?? frame.createdAt).toLocaleString()}</small>
          </div>
        </button>
      ))}
      {!frames.length && <small className="rh-empty">暂无历史记录</small>}
    </div>
  );
}

function TutorialPanel({ locale }: { locale: Locale }) {
  const lessons = i18n[locale].tutorial;
  return (
    <div className="rh-panel-list rh-tutorial-panel">
      {lessons.map(([title, copy]) => (
        <button type="button" key={title}>
          <HelpCircle />
          <div><strong>{title}</strong><small>{copy}</small></div>
        </button>
      ))}
      <section className="rh-cal-cheatsheet">
        {i18n[locale].login.syntax.map(([token, body]) => (
          <article key={token}>
            <code>{token}</code>
            <small>{body}</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function Canvas(props: {
  frame?: Frame;
  assets: Asset[];
  activeBrand?: Brand;
  model?: ModelOption;
  models: ModelOption[];
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  preview: PreviewTarget | null;
  setPreview: (preview: PreviewTarget | null) => void;
  editingNodeId: string | null;
  setEditingNodeId: (nodeId: string | null) => void;
  onUpdateFrame: (patch: Partial<Pick<Frame, "prompt" | "modelId" | "settings" | "brandId" | "brandContext" | "workflowNodes" | "outputs">>) => void | Promise<Frame | void>;
  onGenerateNode: (nodeId: string, nodePrompt: string, modelId?: string, settings?: Partial<GenerationSettings>) => NodeGenerateResponse | void | Promise<NodeGenerateResponse | void>;
  onGenerateTextNode: (nodeId: string, nodePrompt: string, modelId: string, translate: boolean, mode?: string) => TextGenerateResponse | void | Promise<TextGenerateResponse | void>;
  onGenerateScriptNode: (nodeId: string, nodePrompt: string, modelId: string, translate: boolean) => ScriptGenerateResponse | void | Promise<ScriptGenerateResponse | void>;
  onGenerateVideoNode: (nodeId: string, nodePrompt: string, modelId: string, settings: { mode: string; ratio: string; duration: string; sound: boolean; translate: boolean }) => VideoGenerateResponse | void | Promise<VideoGenerateResponse | void>;
  onGenerateAudioNode: (nodeId: string, nodePrompt: string, modelId: string, settings: { mode: string; duration: string; scene: string; loop: boolean; translate: boolean }) => AudioGenerateResponse | void | Promise<AudioGenerateResponse | void>;
}) {
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>(() => props.frame ? normalizeWorkflowNodes(props.frame.workflowNodes, shouldUseDefaultWorkflow(props.frame.workflowNodes)) : []);
  const [openEdge, setOpenEdge] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeGeneration, setNodeGeneration] = useState<{ nodeId: string; progress: number } | null>(null);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const dragRef = useRef<{ id: string; x: number; y: number; cx: number; cy: number } | null>(null);
  const edgeDragRef = useRef<{ id: string; offset: number; cy: number } | null>(null);
  const visibleNodes = useMemo(() => displayNodes(nodes, shouldUseDefaultWorkflow(nodes)), [nodes]);
  const activeSelectedNode = visibleNodes.find((node) => node.id === selectedNode || node.id === props.editingNodeId);

  const lastFrameIdRef = useRef<string | undefined>(props.frame?.id);
  useEffect(() => {
    const nextFrameId = props.frame?.id;
    if (nextFrameId !== lastFrameIdRef.current) {
      lastFrameIdRef.current = nextFrameId;
      setNodes(nextFrameId ? normalizeWorkflowNodes(props.frame?.workflowNodes, shouldUseDefaultWorkflow(props.frame?.workflowNodes ?? [])) : []);
      return;
    }
    if (props.editingNodeId) return;
    setNodes(nextFrameId ? normalizeWorkflowNodes(props.frame?.workflowNodes, shouldUseDefaultWorkflow(props.frame?.workflowNodes ?? [])) : []);
  }, [props.frame?.id, props.frame?.workflowNodes, props.editingNodeId]);

  function commit(nextNodes = nodes) {
    return props.onUpdateFrame({ workflowNodes: nextNodes });
  }

  function addCanvasNode(type: WorkflowNode["type"], x: number, y: number, refs?: ReferenceItem[]) {
    if (!props.frame) return undefined;
    const title = type === "reference" ? "Image" : type === "process" ? "Text" : type === "script" ? "Script" : type === "video" ? "Video" : type === "compose" ? "视频合成" : type === "audio" ? "Audio" : "Output";
    const node: WorkflowNode = {
      id: `node_${Date.now().toString(36)}`,
      type,
      title,
      body: refs?.[0] ? `参考图: ${refs[0].title}` : "",
      parentId: "prompt",
      preview: props.activeBrand?.accentColor ?? "#f97316",
      refs,
      x,
      y,
      w: type === "process" || type === "script" ? 360 : type === "compose" ? 300 : type === "output" || type === "video" ? 260 : 230,
      h: type === "process" || type === "script" ? 260 : type === "compose" ? 260 : 238
    };
    const next = [...normalizeWorkflowNodes(nodes, shouldUseDefaultWorkflow(nodes)), node];
    setNodes(next);
    setSelectedNode(node.id);
    props.setEditingNodeId(node.id);
    setCanvasMenu(null);
    commit(next);
    return node;
  }

  function updateNode(id: string, patch: Partial<WorkflowNode>, save = false) {
    setNodes((current) => {
      const next = current.map((node) => node.id === id ? { ...node, ...patch } : node);
      if (save) window.setTimeout(() => commit(next), 0);
      return next;
    });
  }

  function saveNode(nodeId: string, patch: Partial<WorkflowNode>) {
    const next = nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node);
    setNodes(next);
    commit(next);
  }

  function addNode(anchorId: string, type: WorkflowNode["type"]) {
    if (!props.frame) return;
    const anchor = visibleNodes.find((node) => node.id === anchorId);
    const title = type === "reference" ? "Image" : type === "process" ? "Text" : type === "script" ? "Script" : type === "video" ? "Video" : type === "compose" ? "视频合成" : type === "audio" ? "Audio" : "Output";
    const defaultBody = type === "compose" ? "空空如也，请连接视频节点后操作" : "";
    const node: WorkflowNode = {
      id: `node_${Date.now().toString(36)}`,
      type,
      title,
      body: defaultBody,
      parentId: anchorId,
      preview: props.activeBrand?.accentColor ?? "#f97316",
      refs: type === "reference" ? [] : undefined,
      x: (anchor?.x ?? 640) + 300,
      y: anchor?.y ?? 210,
      w: type === "process" || type === "script" ? 360 : type === "compose" ? 300 : type === "output" || type === "video" ? 260 : 230,
      h: type === "process" || type === "script" ? 260 : type === "compose" ? 260 : 238
    };
    const current = normalizeWorkflowNodes(nodes, shouldUseDefaultWorkflow(nodes));
    const next = [...current, node];
    setNodes(next);
    setSelectedNode(node.id);
    props.setEditingNodeId(node.id);
    setOpenEdge(null);
    commit(next);
  }

  function deleteNode(id: string) {
    if (coreNodeIds.includes(id)) return;
    const deleted = nodes.find((node) => node.id === id);
    const nextParentId = deleted?.parentId;
    const next = nodes
      .filter((node) => node.id !== id)
      .map((node) => node.parentId === id ? { ...node, parentId: nextParentId } : node);
    setNodes(next);
    if (selectedNode === id) setSelectedNode(null);
    if (props.editingNodeId === id) props.setEditingNodeId(null);
    commit(next);
  }

  function startNodeDrag(event: React.PointerEvent<HTMLElement>, id: string) {
    if ((event.target as HTMLElement).closest("button, input, textarea, select")) return;
    const node = nodes.find((item) => item.id === id);
    dragRef.current = { id, x: node?.x ?? 0, y: node?.y ?? 0, cx: event.clientX, cy: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNode(event: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    const rawX = dragRef.current.x + (event.clientX - dragRef.current.cx) / props.viewport.scale;
    const rawY = dragRef.current.y + (event.clientY - dragRef.current.cy) / props.viewport.scale;
    const nextX = gridSnap ? Math.round(rawX / 20) * 20 : Math.round(rawX);
    const nextY = gridSnap ? Math.round(rawY / 20) * 20 : Math.round(rawY);
    updateNode(dragRef.current.id, {
      x: nextX,
      y: nextY
    });
  }

  function endNodeDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    window.setTimeout(() => commit(), 0);
  }

  function startPan(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(".rh-node, .rh-edge-control, button, input, textarea, select")) return;
    setOpenEdge(null);
    setSelectedNode(null);
    props.setEditingNodeId(null);
    setCanvasMenu(null);
    panRef.current = { x: event.clientX, y: event.clientY, vx: props.viewport.x, vy: props.viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  async function uploadImageAt(file: File, x: number, y: number) {
    const imageUrl = await readFileAsDataUrl(file);
    const title = file.name.replace(/\.[^.]+$/, "") || "上传图片";
    addCanvasNode("reference", x, y, [{
      id: `upload_canvas_${Date.now().toString(36)}`,
      role: "uploaded",
      title,
      description: "canvas upload",
      color: props.activeBrand?.accentColor ?? "#f97316",
      imageUrl
    }]);
  }

  function openCanvasMenuAt(clientX: number, clientY: number) {
    setCanvasMenu({
      x: clientX,
      y: clientY,
      worldX: Math.round((clientX - props.viewport.x) / props.viewport.scale),
      worldY: Math.round((clientY - props.viewport.y) / props.viewport.scale)
    });
  }

  function movePan(event: React.PointerEvent<HTMLElement>) {
    if (!panRef.current) return;
    props.setViewport((current) => ({ ...current, x: panRef.current!.vx + event.clientX - panRef.current!.x, y: panRef.current!.vy + event.clientY - panRef.current!.y }));
  }

  function startEdgeDrag(event: React.PointerEvent<HTMLElement>, id: string) {
    event.stopPropagation();
    const node = nodes.find((item) => item.id === id);
    edgeDragRef.current = { id, offset: node?.edgeOffsetY ?? 0, cy: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveEdge(event: React.PointerEvent<HTMLElement>) {
    if (!edgeDragRef.current) return;
    const nextOffset = edgeDragRef.current.offset + (event.clientY - edgeDragRef.current.cy) / props.viewport.scale;
    updateNode(edgeDragRef.current.id, { edgeOffsetY: Math.max(-86, Math.min(86, Math.round(nextOffset))) });
  }

  function endEdgeDrag() {
    if (!edgeDragRef.current) return;
    edgeDragRef.current = null;
    window.setTimeout(() => commit(), 0);
  }

  function organizeCanvas() {
    const normalized = normalizeWorkflowNodes(nodes, shouldUseDefaultWorkflow(nodes));
    const next = normalized.map((node, index) => {
      const depth = node.id === "input-image" ? 0 : node.id === "brand" ? 1 : node.id === "prompt" ? 2 : node.id === "output" ? 3 : Math.max(1, normalized.findIndex((item) => item.id === node.parentId) + 1);
      const siblings = normalized.filter((item) => (item.parentId ?? "") === (node.parentId ?? "") && !coreNodeIds.includes(item.id));
      const siblingIndex = siblings.findIndex((item) => item.id === node.id);
      const row = coreNodeIds.includes(node.id) ? 0 : Math.max(0, siblingIndex);
      return {
        ...node,
        x: 88 + depth * 310,
        y: coreNodeIds.includes(node.id) ? 190 + index * 36 : 160 + row * 286,
        edgeOffsetY: 0
      };
    });
    setNodes(next);
    commit(next);
  }

  const edges = graphEdges(visibleNodes);
  const outputNodes = visibleNodes.filter((node) => node.type === "output");
  const refs = nodes.find((node) => node.id === "input-image")?.refs ?? [];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        organizeCanvas();
      }
      if (event.key === "Escape") {
        setOpenEdge(null);
        setSelectedNode(null);
        props.setEditingNodeId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, props.setEditingNodeId]);

  function handleWheel(event: React.WheelEvent<HTMLElement>) {
    if (Math.abs(event.deltaY) < 2) return;
    const direction = event.deltaY > 0 ? -1 : 1;
    props.setViewport((current) => ({ ...current, scale: Math.min(1.6, Math.max(0.32, current.scale + direction * 0.06)) }));
  }

  return (
    <main
      className={`rh-canvas ${activeSelectedNode ? "selecting" : ""} ${gridSnap ? "snap" : ""}`}
      onWheel={handleWheel}
      onPointerDown={startPan}
      onPointerMove={(event) => { moveEdge(event); movePan(event); }}
      onPointerUp={() => { panRef.current = null; endEdgeDrag(); }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest(".rh-node, .rh-edge-control, button, input, textarea, select")) return;
        event.preventDefault();
        openCanvasMenuAt(event.clientX, event.clientY);
      }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest(".rh-node, .rh-edge-control, button, input, textarea, select")) return;
        event.preventDefault();
        openCanvasMenuAt(event.clientX, event.clientY);
      }}
    >
      <div className="rh-grid" />
      <div className="rh-canvas-hint"><MousePointer2 />拖动画布 · 滚轮缩放 · 点击节点编辑</div>
      {activeSelectedNode && (
        <div className="rh-selection-pill">
          <Wand2 />
          <div><strong>元素选择模式</strong><small>{activeSelectedNode.type === "reference" || activeSelectedNode.type === "image" || activeSelectedNode.type === "output" ? "点击图片预览，底部编辑生成参数" : "底部固定面板可编辑当前节点"}</small></div>
          <button type="button" onClick={() => props.setEditingNodeId(activeSelectedNode.id)}><Route />返回节点</button>
          <button type="button" onClick={() => { setSelectedNode(null); props.setEditingNodeId(null); }}><X />退出</button>
        </div>
      )}
      <section className="rh-world" style={{ transform: `translate(${props.viewport.x}px, ${props.viewport.y}px) scale(${props.viewport.scale})` }}>
        {props.frame && (
          <div className="rh-project-title">
            <strong>{props.frame.settings?.brandInject ? `${props.frame.brandName || props.activeBrand?.name || "Brand"} Canvas` : props.frame.title}</strong>
            <small>{props.frame.status === "generating" ? `Generating ${props.frame.progress}%` : `${props.frame.settings?.brandInject ? "品牌启用" : "品牌关闭"} · Ready`}</small>
          </div>
        )}
        {props.frame && visibleNodes.length === 0 && (
          <div className="rh-canvas-empty">
            <Sparkles />
            <strong>空画布</strong>
            <small>从底部输入一句话生成工作流，或先放入图片、文本、视频节点。无品牌项目不会自动注入 XMANX。</small>
            <div>
              <button type="button" onClick={() => addCanvasNode("reference", 140, 210)}><ImagePlus />图片</button>
              <button type="button" onClick={() => addCanvasNode("process", 140, 210)}><List />文本</button>
              <button type="button" onClick={() => addCanvasNode("video", 140, 210)}><Play />视频</button>
            </div>
          </div>
        )}
        <svg className="rh-lines" viewBox="0 0 2200 900">
          {edges.map((edge) => {
            const x1 = (edge.from.x ?? 0) + (edge.from.w ?? 230);
            const y1 = (edge.from.y ?? 0) + 118;
            const x2 = edge.to.x ?? 0;
            const y2 = (edge.to.y ?? 0) + 118 + (edge.to.edgeOffsetY ?? 0);
            const active = edge.to.id === (nodeGeneration?.nodeId ?? selectedNode);
            return <path className={active ? "active" : ""} key={edge.id} d={`M ${x1} ${y1} C ${x1 + 100} ${y1}, ${x2 - 100} ${y2}, ${x2} ${y2}`} />;
          })}
        </svg>
        {edges.map((edge) => {
          const x1 = (edge.from.x ?? 0) + (edge.from.w ?? 230);
          const y1 = (edge.from.y ?? 0) + 118;
          const x2 = edge.to.x ?? 0;
          const y2 = (edge.to.y ?? 0) + 118 + (edge.to.edgeOffsetY ?? 0);
          return (
            <button
              type="button"
              className="rh-edge-handle"
              key={`${edge.id}-handle`}
              title="拖动调整连线"
              style={{ left: (x1 + x2) / 2 - 9, top: (y1 + y2) / 2 - 9 }}
              onPointerDown={(event) => startEdgeDrag(event, edge.to.id)}
            />
          );
        })}
        {visibleNodes.filter((node) => selectedNode === node.id || openEdge === `${node.id}-add`).map((node) => {
          const id = `${node.id}-add`;
          return (
            <div className={`rh-edge-control ${openEdge === id ? "open" : ""}`} style={{ left: (node.x ?? 0) + (node.w ?? 230) + 22, top: (node.y ?? 0) + 103 }} key={id}>
              <button type="button" onClick={() => setOpenEdge(openEdge === id ? null : id)}><Plus /></button>
              <div className="rh-add-menu">
                <strong>添加节点</strong>
                <button type="button" onClick={() => addNode(node.id, "process")}><List />文本</button>
                <button type="button" onClick={() => addNode(node.id, "reference")}><ImagePlus />图片</button>
                <button type="button" onClick={() => addNode(node.id, "video")}><Play />视频</button>
                <button type="button" onClick={() => addNode(node.id, "compose")}><Scissors />视频合成 <small>Beta</small></button>
                <button type="button" onClick={() => addNode(node.id, "audio")}><Music2 />音频/配乐</button>
                <button type="button" onClick={() => addNode(node.id, "script")}><Sparkles />脚本 <small>Beta</small></button>
                <strong>添加资源</strong>
                <button type="button" onClick={() => addNode(node.id, "reference")}><Upload />上传</button>
                <button type="button" onClick={() => addNode(node.id, "reference")}><Library />从图库选择</button>
              </div>
            </div>
          );
        })}
        {visibleNodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node.type === "model" ? { ...node, body: props.model?.name ?? "@imgen · image skill" } : node}
            output={node.type === "output" ? outputForNode(props.frame, outputNodes, node.id) : undefined}
            refs={node.id === "input-image" ? refs : node.refs ?? []}
            selected={selectedNode === node.id || props.editingNodeId === node.id}
            generationProgress={nodeGeneration?.nodeId === node.id ? nodeGeneration.progress : undefined}
            onSelect={() => { setSelectedNode(node.id); props.setEditingNodeId(node.id); }}
            onPointerDown={startNodeDrag}
            onPointerMove={moveNode}
            onPointerUp={endNodeDrag}
            onUpdate={(patch) => updateNode(node.id, patch, true)}
            onDelete={() => deleteNode(node.id)}
            onPreview={(target) => props.setPreview({ ...target, nodeId: node.id })}
            onEdit={() => { setSelectedNode(node.id); props.setEditingNodeId(node.id); }}
          />
        ))}
        {props.frame?.status === "generating" && <div className="rh-progress"><Loader2 className="spin" /><span>{props.frame.progress}%</span><i><b style={{ width: `${props.frame.progress}%` }} /></i></div>}
      </section>
      <div className="rh-canvas-controls">
        <button type="button" title="整理画布，Option+Shift+F" onClick={organizeCanvas}><Grid2X2 /></button>
        <button type="button" className={minimapOpen ? "active" : ""} title="切换小地图" onClick={() => setMinimapOpen((value) => !value)}><MousePointer2 /></button>
        <button type="button" className={gridSnap ? "active" : ""} title="网格吸附" onClick={() => setGridSnap((value) => !value)}><Route /></button>
        <button type="button" title="缩小" onClick={() => props.setViewport((current) => ({ ...current, scale: Math.max(0.32, current.scale - 0.08) }))}><ZoomOut /></button>
        <strong>{Math.round(props.viewport.scale * 100)}%</strong>
        <button type="button" title="放大" onClick={() => props.setViewport((current) => ({ ...current, scale: Math.min(1.6, current.scale + 0.08) }))}><ZoomIn /></button>
        <button type="button" title="适配" onClick={() => props.setViewport({ x: 76, y: 64, scale: window.innerWidth < 800 ? 0.42 : 0.72 })}><Maximize2 /></button>
      </div>
      {canvasMenu && (
        <div className="rh-canvas-menu" style={{ left: canvasMenu.x, top: canvasMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <strong>添加节点</strong>
          <button type="button" onClick={() => addCanvasNode("process", canvasMenu.worldX, canvasMenu.worldY)}><List />添加文本节点</button>
          <button type="button" onClick={() => addCanvasNode("reference", canvasMenu.worldX, canvasMenu.worldY)}><ImagePlus />添加图片节点</button>
          <button type="button" onClick={() => addCanvasNode("video", canvasMenu.worldX, canvasMenu.worldY)}><Play />添加视频节点</button>
          <button type="button" onClick={() => addCanvasNode("compose", canvasMenu.worldX, canvasMenu.worldY)}><Scissors />视频合成 <small>Beta</small></button>
          <button type="button" onClick={() => addCanvasNode("audio", canvasMenu.worldX, canvasMenu.worldY)}><Music2 />添加音频/配乐</button>
          <button type="button" onClick={() => addCanvasNode("script", canvasMenu.worldX, canvasMenu.worldY)}><Sparkles />添加脚本 <small>Beta</small></button>
          <strong>添加资源</strong>
          <label><Upload />上传图片<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImageAt(file, canvasMenu.worldX, canvasMenu.worldY); event.currentTarget.value = ""; }} /></label>
          <button type="button" onClick={() => addCanvasNode("reference", canvasMenu.worldX, canvasMenu.worldY)}><Library />从图库选择</button>
          <button type="button" onClick={() => setCanvasMenu(null)}><X />关闭</button>
        </div>
      )}
      {minimapOpen && (
        <div className="rh-minimap">
          {visibleNodes.map((node) => (
            <span key={node.id} className={node.id === activeSelectedNode?.id ? "active" : ""} style={{ left: `${((node.x ?? 0) / 2200) * 100}%`, top: `${((node.y ?? 0) / 900) * 100}%` }} />
          ))}
        </div>
      )}
      {props.editingNodeId && (
        <div className="rh-editor-layer" onWheel={(event) => event.stopPropagation()}>
          <NodeEditor
            node={nodes.find((node) => node.id === props.editingNodeId) ?? null}
            assets={props.assets}
            activeBrand={props.activeBrand}
            models={props.models}
            frameSettings={props.frame?.settings ?? defaultSettings}
            framePrompt={props.frame?.prompt ?? ""}
            output={nodes.find((node) => node.id === props.editingNodeId)?.type === "output" && props.editingNodeId ? outputForNode(props.frame, outputNodes, props.editingNodeId) : undefined}
            onClose={() => props.setEditingNodeId(null)}
            onSave={(patch) => props.editingNodeId && saveNode(props.editingNodeId, patch)}
            onGenerate={(nodePrompt, modelId, settings) => {
              if (!props.editingNodeId) return;
              const nodeId = props.editingNodeId;
              const nextNodes = nodes.map((item) => item.id === nodeId ? { ...item, body: nodePrompt || item.body } : item);
              setNodes(nextNodes);
              return Promise.resolve(commit(nextNodes))
                .then(() => props.onGenerateNode(nodeId, nodePrompt, modelId, settings))
                .then((result) => {
                  if (result?.frame.workflowNodes) setNodes(normalizeWorkflowNodes(result.frame.workflowNodes, shouldUseDefaultWorkflow(result.frame.workflowNodes)));
                  return result;
                });
            }}
            onGenerationProgress={(progress) => props.editingNodeId && setNodeGeneration(progress === null ? null : { nodeId: props.editingNodeId, progress })}
            onGenerateText={(nodePrompt, modelId, translate, mode) => {
              if (!props.editingNodeId) return;
              return props.onGenerateTextNode(props.editingNodeId, nodePrompt, modelId, translate, mode);
            }}
            onGenerateScript={(nodePrompt, modelId, translate) => {
              if (!props.editingNodeId) return;
              return props.onGenerateScriptNode(props.editingNodeId, nodePrompt, modelId, translate);
            }}
            onGenerateVideo={(nodePrompt, modelId, settings) => {
              if (!props.editingNodeId) return;
              return props.onGenerateVideoNode(props.editingNodeId, nodePrompt, modelId, settings);
            }}
            onGenerateAudio={(nodePrompt, modelId, settings) => {
              if (!props.editingNodeId) return;
              return props.onGenerateAudioNode(props.editingNodeId, nodePrompt, modelId, settings);
            }}
            onPreview={(target) => props.setPreview({ ...target, nodeId: props.editingNodeId ?? undefined })}
          />
        </div>
      )}
    </main>
  );
}

function NodeCard(props: {
  node: WorkflowNode;
  refs: ReferenceItem[];
  output?: Frame["outputs"][number];
  selected: boolean;
  generationProgress?: number;
  onSelect: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>, id: string) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onUpdate: (patch: Partial<WorkflowNode>) => void;
  onDelete: () => void;
  onPreview: (target: PreviewTarget) => void;
  onEdit: () => void;
}) {
  const firstRef = props.refs.find((ref) => ref.imageUrl);
  const imageUrl = firstRef?.imageUrl ?? props.output?.imageUrl;
  const title = firstRef?.title ?? props.output?.title ?? props.node.title;
  return (
    <article
      className={`rh-node ${props.node.type} ${props.selected ? "selected" : ""}`}
      style={{ left: props.node.x ?? 0, top: props.node.y ?? 0, width: props.node.w ?? 230, minHeight: props.node.h ?? 238 }}
      onPointerDown={(event) => props.onPointerDown(event, props.node.id)}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onClick={props.onSelect}
    >
      <div className="rh-node-head">
        <input value={props.node.title} onChange={(event) => props.onUpdate({ title: event.target.value })} />
        {!coreNodeIds.includes(props.node.id) && <button type="button" onClick={(event) => { event.stopPropagation(); props.onDelete(); }}><Trash2 /></button>}
      </div>
      {(props.node.type === "image" || props.node.type === "reference" || props.node.type === "output") ? (
        <div
          className="rh-image-tile"
          onClick={(event) => {
            event.stopPropagation();
            props.onEdit();
          }}
          style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : { background: `linear-gradient(135deg, ${props.node.preview ?? "#f97316"}, #10131a)` }}
        >
          {!imageUrl && <Image />}
          <span>{props.node.type === "output" ? "Preview output" : props.refs.length ? `${props.refs.length} refs` : "Add image"}</span>
          {typeof props.generationProgress === "number" && <div className="rh-node-generating"><b>生成中 {props.generationProgress}%</b><i><em style={{ width: `${props.generationProgress}%` }} /></i></div>}
          <div className="rh-image-node-actions" onClick={(event) => event.stopPropagation()}>
            <button type="button" title="编辑/生成" onClick={props.onEdit}><Wand2 /></button>
            <button type="button" title="预览" onClick={() => imageUrl && props.onPreview({ title, subtitle: props.node.body, imageUrl, color: props.node.preview, nodeId: props.node.id })} disabled={!imageUrl}><Expand /></button>
            <button type="button" title="下载" onClick={() => downloadImage(imageUrl, title)} disabled={!imageUrl}><Download /></button>
          </div>
        </div>
      ) : props.node.type === "model" ? (
        <div className="rh-node-body compact"><Settings2 /><strong>{props.node.body || "@imgen · image skill"}</strong></div>
      ) : props.node.type === "process" ? (
        <button type="button" className={`rh-text-tile ${props.node.body ? "filled" : ""}`} onClick={(event) => { event.stopPropagation(); props.onEdit(); }}>
          {props.node.body ? (
            <div className="rh-text-preview-lines">
              {props.node.body.split("\n").filter(Boolean).slice(0, 8).map((line, index) => (
                <span key={`${props.node.id}_line_${index}`}>{line.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "").replace(/^[-*>]\s*/, "")}</span>
              ))}
            </div>
          ) : (
            <>
              <List />
              <span>写内容、反推提示词、生成故事或品牌文案</span>
              <small>点击打开完整编辑器</small>
            </>
          )}
        </button>
      ) : props.node.type === "script" ? (
        <button type="button" className="rh-script-tile" onClick={(event) => { event.stopPropagation(); props.onEdit(); }}>
          <List />
          <span>{props.node.body || "添加剧情、角色参考、视频参考，生成分镜脚本"}</span>
        </button>
      ) : props.node.type === "video" ? (
        <button type="button" className="rh-video-tile" onClick={(event) => { event.stopPropagation(); props.onEdit(); }}>
          <Play />
          <span>{props.node.body || "添加视频提示词"}</span>
          <small>16:9 · 720P · 5s</small>
        </button>
      ) : props.node.type === "compose" ? (
        <button type="button" className="rh-compose-tile" onClick={(event) => { event.stopPropagation(); props.onEdit(); }}>
          <Scissors />
          <span>{props.node.body || "空空如也，请连接视频节点后操作"}</span>
        </button>
      ) : props.node.type === "audio" ? (
        <button type="button" className="rh-audio-tile" onClick={(event) => { event.stopPropagation(); props.onEdit(); }}>
          <Music2 />
          <span>{props.node.body || "添加音频提示词或连接视频节点"}</span>
        </button>
      ) : props.node.type === "brand" || props.node.type === "prompt" ? (
        <button type="button" className="rh-context-tile" onClick={(event) => { event.stopPropagation(); props.onEdit(); }}>
          <Layers3 />
          <strong>{props.node.type === "brand" ? "品牌上下文" : "最终提示词"}</strong>
          <div>
            {parseMentionSummary(props.node.body).map((item) => (
              <span key={`${item.token}_${item.copy}`}><b>{item.token}</b>{item.copy}</span>
            ))}
            {!parseMentionSummary(props.node.body).length && <span><b>CAL</b>{props.node.body || "点击编辑上下文"}</span>}
          </div>
        </button>
      ) : (
        <textarea value={props.node.body} onChange={(event) => props.onUpdate({ body: event.target.value })} placeholder="Prompt or brand context..." />
      )}
      <small>{props.node.type}</small>
    </article>
  );
}

function MentionPopover({ items, compact = false, onPick }: { items: MentionItem[]; compact?: boolean; onPick: (item: MentionItem) => void }) {
  const visibleItems = items.slice(0, compact ? 8 : 14);
  const titleMap: Record<MentionItem["kind"], string> = {
    agent: "@ 智能体",
    command: "/ 命令",
    resource: "$ 图片/资源",
    copy: "$ 文案/品牌字段",
    tag: "% 标签"
  };
  return (
    <div className={`rh-node-mentions ${compact ? "compact" : ""}`}>
      <strong>CAL 自动补全</strong>
      {Object.entries(titleMap).map(([kind, title]) => {
        const groupItems = visibleItems.filter((item) => item.kind === kind);
        if (!groupItems.length) return null;
        return (
          <React.Fragment key={kind}>
            <small>{title}</small>
            {groupItems.map((item) => (
              <button
                type="button"
                key={`${item.group}_${item.id}_${item.token}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
                title={item.kind === "resource" ? `${item.token} · 生成时作为真实参考图传入 skill` : `${item.token} · ${item.description}`}
              >
                {item.imageUrl ? <span style={{ backgroundImage: `url(${item.imageUrl})` }} /> : <i style={{ background: item.color }}>{mentionIconText(item, item.kind === "copy" ? "#" : item.token[0] ?? "$")}</i>}
                <b>{item.token}</b>
                <small>{item.title}</small>
              </button>
            ))}
          </React.Fragment>
        );
      })}
      {!items.length && <small>没有匹配项。输入 @ / $ / % 可继续筛选。</small>}
    </div>
  );
}

function NodeEditor({
  node,
  assets,
  activeBrand,
  models,
  frameSettings,
  framePrompt,
  output,
  onClose,
  onSave,
  onGenerate,
  onGenerateText,
  onGenerateScript,
  onGenerateVideo,
  onGenerateAudio,
  onGenerationProgress,
  onPreview
}: {
  node: WorkflowNode | null;
  assets: Asset[];
  activeBrand?: Brand;
  models: ModelOption[];
  frameSettings: GenerationSettings;
  framePrompt: string;
  output?: Frame["outputs"][number];
  onClose: () => void;
  onSave: (patch: Partial<WorkflowNode>) => void;
  onGenerate: (prompt: string, modelId?: string, settings?: Partial<GenerationSettings>) => NodeGenerateResponse | void | Promise<NodeGenerateResponse | void>;
  onGenerateText: (prompt: string, modelId: string, translate: boolean, mode?: string) => TextGenerateResponse | void | Promise<TextGenerateResponse | void>;
  onGenerateScript: (prompt: string, modelId: string, translate: boolean) => ScriptGenerateResponse | void | Promise<ScriptGenerateResponse | void>;
  onGenerateVideo: (prompt: string, modelId: string, settings: { mode: string; ratio: string; duration: string; sound: boolean; translate: boolean }) => VideoGenerateResponse | void | Promise<VideoGenerateResponse | void>;
  onGenerateAudio: (prompt: string, modelId: string, settings: { mode: string; duration: string; scene: string; loop: boolean; translate: boolean }) => AudioGenerateResponse | void | Promise<AudioGenerateResponse | void>;
  onGenerationProgress: (progress: number | null) => void;
  onPreview: (target: PreviewTarget) => void;
}) {
  const [draft, setDraft] = useState<WorkflowNode | null>(node);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState("");
  const imageModels = models.filter((item) => item.type === "image");
  const [imageModelId, setImageModelId] = useState(imageModels[0]?.id ?? "imgen-skill");
  const [imageRatio, setImageRatio] = useState(frameSettings.ratio);
  const [imageQuality, setImageQuality] = useState<GenerationSettings["quality"]>(frameSettings.quality);
  const [imageCount, setImageCount] = useState(frameSettings.count);
  const [imageStrength, setImageStrength] = useState(frameSettings.strength);
  const [textModel, setTextModel] = useState("gpt-5.4");
  const [translateText, setTranslateText] = useState(false);
  const [scriptModel, setScriptModel] = useState("gpt-5.4");
  const [translateScript, setTranslateScript] = useState(false);
  const [videoMode, setVideoMode] = useState("文生视频");
  const [videoModel, setVideoModel] = useState("grok-imagine-1.0-video-super-720p");
  const [videoRatio, setVideoRatio] = useState("16:9 · 720P · 5s");
  const [videoSound, setVideoSound] = useState(true);
  const [translateVideo, setTranslateVideo] = useState(false);
  const [audioMode, setAudioMode] = useState("配乐");
  const [audioModel, setAudioModel] = useState("gpt-5.4");
  const [audioDuration, setAudioDuration] = useState("15s");
  const [audioScene, setAudioScene] = useState("广告短视频");
  const [audioLoop, setAudioLoop] = useState(false);
  const [translateAudio, setTranslateAudio] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const lastNodeIdRef = useRef<string | null>(node?.id ?? null);

  useEffect(() => {
    if ((node?.id ?? null) === lastNodeIdRef.current) return;
    lastNodeIdRef.current = node?.id ?? null;
    setDraft(node);
    setGenerationMessage("");
    setGenerationProgress(0);
  }, [node]);
  if (!draft) return null;

  const imageRefs = (draft.refs ?? []).filter((reference) => reference.imageUrl);
  const firstRef = imageRefs[0];
  const imageUrl = firstRef?.imageUrl ?? output?.imageUrl;
  const imageChoices = [
    ...(output?.imageUrl ? [{ id: `output_${output.id}`, title: output.title, imageUrl: output.imageUrl }] : []),
    ...imageRefs
  ].filter((item, index, list) => item.imageUrl && list.findIndex((candidate) => candidate.imageUrl === item.imageUrl) === index);
  const isVideoOutput = draft.type === "output" && output?.kind === "video";
  const isDocumentOutput = draft.type === "output" && output?.kind === "document";
  const canGenerateImage = draft.type === "image" || draft.type === "reference" || (draft.type === "output" && !isVideoOutput && !isDocumentOutput);
  const promptPlaceholder = promptTemplateForNode(draft.type, output?.kind);
  const mentionItems = buildMentionItems(activeBrand, assets);
  const activeDraftQuery = activeReferenceQuery(draft.body);
  const filteredDraftMentionItems = filterMentionItems(mentionItems, draft.body);

  function appendMention(item: MentionItem) {
    setDraft((current) => {
      if (!current) return current;
      const nextBody = insertMentionToken(current.body, item.token);
      const nextRefs = item.imageUrl
        ? [item, ...(current.refs ?? []).filter((reference) => reference.imageUrl !== item.imageUrl)].slice(0, 12)
        : current.refs;
      const nextDraft = { ...current, body: nextBody, refs: nextRefs };
      window.setTimeout(() => onSave({ body: nextDraft.body, refs: nextDraft.refs }), 0);
      return nextDraft;
    });
  }

  function insertMentionToken(body: string, token: string) {
    return insertReferenceToken(body, token);
  }

  function formatTextDraft(marker: "h1" | "h2" | "h3" | "bold" | "italic" | "bullet" | "number" | "quote" | "divider") {
    const currentDraft = draft;
    if (!currentDraft) return;
    const body = currentDraft.body || "";
    const nextBody = (() => {
      if (marker === "divider") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}---\n`;
      if (marker === "h1") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}# 标题\n`;
      if (marker === "h2") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}## 小标题\n`;
      if (marker === "h3") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}### 段落标题\n`;
      if (marker === "bullet") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}- 要点\n`;
      if (marker === "number") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}1. 步骤\n`;
      if (marker === "quote") return `${body}${body.endsWith("\n") || !body ? "" : "\n"}> 引用或旁白\n`;
      if (marker === "bold") return `${body}${body.endsWith(" ") || !body ? "" : " "}**重点**`;
      return `${body}${body.endsWith(" ") || !body ? "" : " "}*强调*`;
    })();
    const nextDraft = { ...currentDraft, body: nextBody };
    setDraft(nextDraft);
    onSave({ body: nextBody });
  }

  async function handleGenerate() {
    const currentDraft = draft;
    if (!currentDraft) return;
    setGenerating(true);
    setGenerationMessage("已提交到本地图片生成 Skill...");
    setGenerationProgress(8);
    onGenerationProgress(8);
    const timer = window.setInterval(() => {
      setGenerationProgress((current) => {
        const next = Math.min(92, current + (current < 40 ? 7 : current < 75 ? 4 : 2));
        onGenerationProgress(next);
        return next;
      });
    }, 900);
    onSave({ title: currentDraft.title, body: currentDraft.body, preview: currentDraft.preview, refs: currentDraft.refs });
    let completed = false;
    try {
      const result = await Promise.resolve(onGenerate(currentDraft.body || currentDraft.title, imageModelId, {
        ...frameSettings,
        ratio: imageRatio,
        quality: imageQuality,
        count: imageCount,
        strength: imageStrength
      }));
      if (result?.node) {
        setDraft(result.node);
        onSave({ title: result.node.title, body: result.node.body, preview: result.node.preview, refs: result.node.refs });
      }
      setGenerationMessage(result?.generated === false ? (result.message ?? "已使用降级图片替换，请检查 Skill 配置。") : "生成完成，已替换当前节点图片。");
      completed = true;
      setGenerationProgress(100);
      onGenerationProgress(100);
      window.setTimeout(() => onGenerationProgress(null), 450);
    } catch (error) {
      setGenerationMessage(error instanceof Error ? `生成失败：${error.message}` : "生成失败：未知错误");
      throw error;
    } finally {
      window.clearInterval(timer);
      setGenerating(false);
      if (!completed) onGenerationProgress(null);
      window.setTimeout(() => setGenerationProgress(0), 450);
    }
  }

  async function handleUploadReference(file: File) {
    const currentDraft = draft;
    if (!currentDraft) return;
    const imageUrl = await readFileAsDataUrl(file);
    const nextRef: ReferenceItem = {
      id: `upload_${currentDraft.id}_${Date.now().toString(36)}`,
      role: currentDraft.type === "reference" ? "reference" : "uploaded",
      title: file.name.replace(/\.[^.]+$/, "") || currentDraft.title,
      description: currentDraft.body || "uploaded reference image",
      color: currentDraft.preview ?? "#f97316",
      imageUrl
    };
    const nextDraft = {
      ...currentDraft,
      title: currentDraft.title || nextRef.title,
      body: currentDraft.body || `参考图: ${nextRef.title}`,
      refs: [nextRef, ...(currentDraft.refs ?? []).filter((reference) => reference.id !== nextRef.id)]
    };
    setDraft(nextDraft);
    onSave({ title: nextDraft.title, body: nextDraft.body, refs: nextDraft.refs, preview: nextDraft.preview });
  }

  function handleUseAsset(assetId: string) {
    const currentDraft = draft;
    const asset = assets.find((item) => item.id === assetId);
    if (!currentDraft || !asset?.imageUrl) return;
    const nextRef: ReferenceItem = {
      id: `asset_${asset.id}_${Date.now().toString(36)}`,
      role: assetToRef(asset).role,
      title: asset.title,
      description: asset.meta,
      color: asset.color,
      imageUrl: asset.imageUrl
    };
    const nextDraft = {
      ...currentDraft,
      refs: [nextRef, ...(currentDraft.refs ?? []).filter((reference) => reference.imageUrl !== nextRef.imageUrl)]
    };
    setSelectedAssetId(assetId);
    setDraft(nextDraft);
    onSave({ refs: nextDraft.refs });
  }

  function handleUseVersion(imageUrl: string) {
    const currentDraft = draft;
    const choice = imageChoices.find((item) => item.imageUrl === imageUrl);
    if (!currentDraft || !choice?.imageUrl) return;
    const nextRef: ReferenceItem = {
      id: `version_${currentDraft.id}_${Date.now().toString(36)}`,
      role: "version",
      title: choice.title,
      description: currentDraft.body || "selected previous version",
      color: currentDraft.preview ?? "#f97316",
      imageUrl: choice.imageUrl
    };
    const nextDraft = {
      ...currentDraft,
      refs: [nextRef, ...(currentDraft.refs ?? []).filter((reference) => reference.imageUrl !== choice.imageUrl)]
    };
    setDraft(nextDraft);
    onSave({ refs: nextDraft.refs });
  }

  async function handleTransformDraft(action: "translate" | "optimize") {
    const currentDraft = draft;
    if (!currentDraft || !currentDraft.body.trim()) return;
    setGenerating(true);
    setGenerationMessage(action === "translate" ? "正在调用文本模型翻译..." : "正在调用文本模型优化 CAL...");
    try {
      const result = await api.post<TransformTextResponse>("/ai/transform-text", {
        text: currentDraft.body,
        action,
        brandId: activeBrand?.id,
        model: textModel,
        outputTarget: draft.type === "video" || isVideoOutput ? "mp4" : isDocumentOutput ? "pdf" : "jpg",
        orientation: videoRatio.startsWith("9:16") ? "portrait" : videoRatio.startsWith("1:1") ? "square" : "landscape",
        nodeType: isVideoOutput ? "video" : isDocumentOutput ? "process" : draft.type
      });
      const nextDraft = { ...currentDraft, body: result.text };
      setDraft(nextDraft);
      onSave({ body: nextDraft.body });
      setGenerationMessage(action === "translate" ? "翻译完成，已保留 CAL 引用。" : "优化完成，已更新为 CAL 提示词。");
    } finally {
      setGenerating(false);
    }
  }

  if (canGenerateImage) {
    const imagePromptReady = Boolean((draft.body || draft.title).trim());
    return (
      <aside className="rh-node-editor rh-image-editor" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-image-editor-toolbar">
          <button type="button" title="风格"><Box /><span>风格</span></button>
          <button type="button" title="优化 CAL" onClick={() => void handleTransformDraft("optimize")}><Sparkles /><span>优化</span></button>
          <button type="button" title="聚焦"><Camera /><span>聚焦</span></button>
          <button type="button" className="active" title="列表"><Layers3 /><b>1</b></button>
          <button type="button" className="ghost" title="放大预览" onClick={() => imageUrl && onPreview({ title: draft.title, subtitle: draft.body, imageUrl, color: draft.preview, nodeId: draft.id })} disabled={!imageUrl}><Expand /></button>
          <button type="button" className="ghost" title="关闭" onClick={onClose}><X /></button>
        </div>
        <input className="rh-image-node-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => onSave({ title: draft.title })} />
        <textarea
          className="rh-image-prompt"
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onBlur={() => onSave({ body: draft.body })}
          placeholder={promptPlaceholder}
        />
        {activeDraftQuery && (
          <MentionPopover items={filteredDraftMentionItems} onPick={appendMention} />
        )}
        <button
          type="button"
          className={`rh-editor-image ${generating ? "generating" : ""}`}
          onClick={() => imageUrl ? onPreview({ title: draft.title, subtitle: draft.body, imageUrl, color: draft.preview, nodeId: draft.id }) : void handleGenerate()}
          style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : { background: `linear-gradient(135deg, ${draft.preview ?? "#f97316"}, #10131a)` }}
        >
          {!imageUrl && <Image />}
          <span>{imageUrl ? "当前图片" : "空图片节点"}</span>
          {generating && <div className="rh-generation-focus"><strong>生成中 {generationProgress}%...</strong><small>取消</small><i><b style={{ width: `${generationProgress}%` }} /></i></div>}
        </button>
        {generationMessage && (
          <small className={`rh-generation-message ${/失败|降级|unavailable|HTTP|missing/i.test(generationMessage) ? "warning" : ""}`}>
            {generationMessage}
          </small>
        )}
        <div className="rh-image-editor-footer">
          <select value={imageModelId} onChange={(event) => setImageModelId(event.target.value)}>
            {imageModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={imageRatio} onChange={(event) => setImageRatio(event.target.value)}>
            <option>1:1</option><option>3:4</option><option>4:5</option><option>9:16</option><option>16:9</option>
          </select>
          <button type="button"><Camera />摄像机</button>
          <span />
          <button type="button" title="调用文本模型翻译" onClick={() => void handleTransformDraft("translate")}><Languages /></button>
          <select value={imageQuality} onChange={(event) => setImageQuality(event.target.value as GenerationSettings["quality"])} title="质量">
            <option value="standard">standard</option><option value="hd">hd</option><option value="ultra">ultra</option>
          </select>
          <select value={imageCount} onChange={(event) => setImageCount(Number(event.target.value))}>
            <option value={1}>1张</option><option value={2}>2张</option><option value={4}>4张</option><option value={6}>6张</option>
          </select>
          <select value={imageUrl ?? ""} onChange={(event) => handleUseVersion(event.target.value)} title="历史版本">
            {imageChoices.length ? imageChoices.map((item, index) => <option value={item.imageUrl} key={`${item.id}_${index}`}>{index === 0 ? "当前版本" : `历史 ${index}`} · {item.title}</option>) : <option value="">无历史</option>}
          </select>
          <select value={selectedAssetId} onChange={(event) => handleUseAsset(event.target.value)} title="从素材替换">
            <option value="">从素材替换</option>
            {assets.filter((asset) => asset.imageUrl).map((asset) => <option value={asset.id} key={asset.id}>{asset.title}</option>)}
          </select>
          <label className="rh-mini-range"><SlidersHorizontal /><input type="range" min={0} max={100} value={imageStrength} onChange={(event) => setImageStrength(Number(event.target.value))} /></label>
          <small>♦ 14</small>
          <button type="button" className="submit" title="生成图片" aria-label="生成图片" onClick={() => void handleGenerate()} disabled={generating || !imagePromptReady}>{generating ? <Loader2 className="spin" /> : <Send />}</button>
        </div>
        <div className="rh-editor-actions compact">
          <label className="rh-file-action"><Upload />{imageUrl ? "替换" : "上传图片"}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleUploadReference(file); event.currentTarget.value = ""; }} /></label>
          {imageUrl && <button type="button" onClick={() => downloadImage(imageUrl, draft.title)}><ArrowDownToLine />下载</button>}
          <button type="button" onClick={() => { onSave({ title: draft.title, body: draft.body, preview: draft.preview, refs: draft.refs }); onClose(); }}>保存</button>
        </div>
      </aside>
    );
  }

  if (draft.type === "brand" || draft.type === "prompt") {
    return (
      <aside className={`rh-node-editor rh-context-editor ${draft.type === "brand" ? "brand" : "prompt"}`} onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-node-editor-head">
          <div>
            <strong>{draft.type === "brand" ? "品牌上下文" : "最终提示词"}</strong>
            <small>{draft.type === "brand" ? "这里可微调本画布使用的品牌信息，不会直接覆盖品牌库。" : "这里可调整提交给模型的最终提示词。"}</small>
          </div>
          <button type="button" onClick={onClose}><X /></button>
        </div>
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => onSave({ title: draft.title })} />
        <textarea
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          placeholder={draft.type === "brand" ? "整理 Logo、IP、产品、模特、语气、禁用项等品牌上下文。" : promptPlaceholder}
        />
        {activeDraftQuery && <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />}
        <div className="rh-editor-actions">
          <button type="button" onClick={() => { onSave({ title: draft.title, body: draft.body }); onClose(); }}>保存</button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </aside>
    );
  }

  if (draft.type === "process") {
    async function handleTextGenerate() {
      const currentDraft = draft;
      if (!currentDraft) return;
      setGenerating(true);
      setGenerationProgress(2);
      onSave({ title: currentDraft.title, body: currentDraft.body });
      const timer = window.setInterval(() => setGenerationProgress((current) => Math.min(92, current + (current < 38 ? 8 : 4))), 700);
      try {
        const result = await Promise.resolve(onGenerateText(currentDraft.body || currentDraft.title, textModel, translateText));
        if (result?.node) {
          setDraft(result.node);
          onSave({ title: result.node.title, body: result.node.body, refs: result.node.refs });
        }
      } finally {
        window.clearInterval(timer);
        setGenerationProgress(0);
        setGenerating(false);
      }
    }

    return (
      <aside className="rh-node-editor rh-text-editor" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-text-editor-toolbar">
          <button type="button" title="一级标题" onClick={() => formatTextDraft("h1")}>H1</button>
          <button type="button" title="二级标题" onClick={() => formatTextDraft("h2")}>H2</button>
          <button type="button" title="三级标题" onClick={() => formatTextDraft("h3")}>H3</button>
          <button type="button" title="引用" onClick={() => formatTextDraft("quote")}><List /></button>
          <button type="button" title="加粗" onClick={() => formatTextDraft("bold")}><b>B</b></button>
          <button type="button" title="斜体" onClick={() => formatTextDraft("italic")}><i>I</i></button>
          <button type="button" title="项目符号" onClick={() => formatTextDraft("bullet")}><List /></button>
          <button type="button" title="编号列表" onClick={() => formatTextDraft("number")}>1.</button>
          <button type="button" title="分割线" onClick={() => formatTextDraft("divider")}>-</button>
          <button type="button" title="复制文本" onClick={() => void navigator.clipboard?.writeText(draft.body)}><Download /></button>
          <button type="button" title="关闭" onClick={onClose}><X /></button>
        </div>
        <input className="rh-text-node-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => onSave({ title: draft.title })} />
        <div className="rh-text-workspace">
          <textarea
            className="rh-text-prompt"
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            onBlur={() => onSave({ body: draft.body })}
            placeholder={promptPlaceholder}
          />
          {generating && (
            <div className="rh-text-generation-focus">
              <strong>生成中 {generationProgress}%...</strong>
              <i><b style={{ width: `${generationProgress}%` }} /></i>
            </div>
          )}
        </div>
        {activeDraftQuery && (
          <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />
        )}
        <div className="rh-text-editor-footer">
          <select value={textModel} onChange={(event) => setTextModel(event.target.value)}>
            <option>gpt-5.4</option>
            <option>deepseek-ai/DeepSeek-V4-Flash</option>
            <option>Lib Nano Pro</option>
          </select>
          <span />
          <button type="button" onClick={() => void handleTransformDraft("optimize")} title="优化 CAL"><Wand2 /></button>
          <button type="button" className={translateText ? "active" : ""} onClick={() => void handleTransformDraft("translate")} title="调用文本模型翻译"><Languages /></button>
          <small>♦ 6</small>
          <button type="button" className="submit" title="生成文本" aria-label="生成文本" onClick={() => void handleTextGenerate()} disabled={generating || !draft.body.trim()}>{generating ? <Loader2 className="spin" /> : <Send />}</button>
        </div>
      </aside>
    );
  }

  if (draft.type === "compose") {
    return (
      <aside className="rh-node-editor rh-utility-editor" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-node-editor-head">
          <div>
            <strong>视频合成</strong>
            <small>选择多个视频后由 AI 合成，当前先保存配置</small>
          </div>
          <button type="button" onClick={onClose}><X /></button>
        </div>
        <textarea
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onBlur={() => onSave({ title: draft.title, body: draft.body })}
          placeholder={promptPlaceholder}
        />
        {activeDraftQuery && <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />}
        <div className="rh-editor-actions">
          <button type="button" onClick={() => { onSave({ title: draft.title, body: draft.body }); onClose(); }}>保存</button>
        </div>
      </aside>
    );
  }

  if (draft.type === "audio") {
    async function handleAudioGenerate() {
      const currentDraft = draft;
      if (!currentDraft) return;
      setGenerating(true);
      onSave({ title: currentDraft.title, body: currentDraft.body });
      try {
        const result = await Promise.resolve(onGenerateAudio(currentDraft.body || currentDraft.title, audioModel, {
          mode: audioMode,
          duration: audioDuration,
          scene: audioScene,
          loop: audioLoop,
          translate: translateAudio
        }));
        if (result?.node) {
          setDraft(result.node);
          onSave({ title: result.node.title, body: result.node.body });
        }
      } finally {
        setGenerating(false);
      }
    }

    return (
      <aside className="rh-node-editor rh-audio-editor" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-audio-editor-tabs">
          {["配乐", "音效", "旁白", "混音"].map((mode) => (
            <button type="button" key={mode} className={audioMode === mode ? "active" : ""} onClick={() => setAudioMode(mode)}>{mode}</button>
          ))}
          <button type="button" className="ghost" title="关闭" onClick={onClose}><X /></button>
        </div>
        <div className="rh-audio-editor-toolbar">
          <button type="button"><Music2 />情绪</button>
          <button type="button"><Volume2 />节奏</button>
          <button type="button"><Layers3 />引用</button>
        </div>
        <input className="rh-audio-node-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => onSave({ title: draft.title })} />
        <textarea
          className="rh-audio-prompt"
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onBlur={() => onSave({ body: draft.body })}
          placeholder={promptPlaceholder}
        />
        {activeDraftQuery && (
          <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />
        )}
        <div className="rh-audio-preview">
          <Music2 />
          <span>{draft.body ? "音频生成配置已就绪" : "空音频节点"}</span>
          <small>{audioMode} · {audioDuration} · {audioScene}</small>
        </div>
        <div className="rh-audio-editor-footer">
          <select value={audioModel} onChange={(event) => setAudioModel(event.target.value)}>
            <option>gpt-5.4</option>
            <option>deepseek-ai/DeepSeek-V4-Flash</option>
          </select>
          <select value={audioDuration} onChange={(event) => setAudioDuration(event.target.value)}>
            <option>5s</option><option>10s</option><option>15s</option><option>30s</option><option>60s</option>
          </select>
          <select value={audioScene} onChange={(event) => setAudioScene(event.target.value)}>
            <option>广告短视频</option><option>产品展示</option><option>品牌片</option><option>直播间</option><option>故事版</option>
          </select>
          <span />
          <button type="button" className={audioLoop ? "active" : ""} onClick={() => setAudioLoop((value) => !value)} title="循环"><RefreshCw /></button>
          <button type="button" onClick={() => void handleTransformDraft("optimize")} title="优化 CAL"><Wand2 /></button>
          <button type="button" className={translateAudio ? "active" : ""} onClick={() => void handleTransformDraft("translate")} title="调用文本模型翻译"><Languages /></button>
          <small>♦ 18</small>
          <button type="button" className="submit" title="生成音频配置" aria-label="生成音频配置" onClick={() => void handleAudioGenerate()} disabled={generating || !draft.body.trim()}>{generating ? <Loader2 className="spin" /> : <Send />}</button>
        </div>
      </aside>
    );
  }

  if (draft.type === "script") {
    const storyboardRefs = draft.refs?.length ? draft.refs : assets.filter((asset) => asset.imageUrl).slice(0, 4).map(assetToRef);
    const scriptStoryboard = parseStoryboardTable(draft.body, storyboardRefs);
    async function handleScriptGenerate() {
      const currentDraft = draft;
      if (!currentDraft) return;
      setGenerating(true);
      onSave({ title: currentDraft.title, body: currentDraft.body });
      try {
        const result = await Promise.resolve(onGenerateScript(currentDraft.body || currentDraft.title, scriptModel, translateScript));
        if (result?.node) {
          setDraft(result.node);
          onSave({ title: result.node.title, body: result.node.body });
        }
      } finally {
        setGenerating(false);
      }
    }

    return (
      <aside className="rh-node-editor rh-script-editor" onPointerDown={(event) => event.stopPropagation()}>
        {scriptStoryboard.rows.length > 0 && <StoryboardBoard body={draft.body} refs={storyboardRefs} compact />}
        <textarea
          className="rh-script-prompt"
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onBlur={() => onSave({ title: draft.title, body: draft.body })}
          placeholder={promptPlaceholder}
        />
        {activeDraftQuery && <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />}
        <div className="rh-script-editor-footer">
          <select value={scriptModel} onChange={(event) => setScriptModel(event.target.value)}>
            <option>gpt-5.4</option>
            <option>deepseek-ai/DeepSeek-V4-Flash</option>
          </select>
          <span />
          <button type="button" onClick={() => void handleTransformDraft("optimize")} title="优化 CAL"><Wand2 /></button>
          <button type="button" className={translateScript ? "active" : ""} onClick={() => void handleTransformDraft("translate")} title="调用文本模型翻译"><Languages /></button>
          <small>♦ 6</small>
          <button type="button" className="submit" title="生成脚本" aria-label="生成脚本" onClick={() => void handleScriptGenerate()} disabled={generating || !draft.body.trim()}>{generating ? <Loader2 className="spin" /> : <Send />}</button>
        </div>
        <button type="button" className="rh-script-close" onClick={onClose}><X /></button>
      </aside>
    );
  }

  if (draft.type === "video" || isVideoOutput) {
    async function handleVideoGenerate() {
      const currentDraft = draft;
      if (!currentDraft) return;
      setGenerating(true);
      onSave({ title: currentDraft.title, body: currentDraft.body });
      try {
        const prompt = isVideoOutput ? `${framePrompt}\n\n${currentDraft.body || currentDraft.title}`.trim() : currentDraft.body || currentDraft.title;
        const result = await Promise.resolve(onGenerateVideo(prompt, videoModel, {
          mode: videoMode,
          ratio: videoRatio,
          duration: "5s",
          sound: videoSound,
          translate: translateVideo
        }));
        if (result?.node) {
          setDraft(result.node);
          onSave({ title: result.node.title, body: result.node.body });
        }
      } finally {
        setGenerating(false);
      }
    }

    return (
      <aside className="rh-node-editor rh-video-editor" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-video-editor-tabs">
          {["文生视频", "全能参考", "图生视频", "首尾帧", "图片参考"].map((mode) => (
            <button type="button" key={mode} className={videoMode === mode ? "active" : ""} onClick={() => setVideoMode(mode)}>{mode}</button>
          ))}
          <button type="button" className="ghost" title="关闭" onClick={onClose}><X /></button>
        </div>
        <div className="rh-video-editor-toolbar">
          <button type="button"><Sparkles />标记</button>
          <button type="button"><Camera />运镜</button>
          <button type="button"><Layers3 />角色库</button>
          <button type="button" className="active"><Layers3 /><b>1</b></button>
        </div>
        <input className="rh-video-node-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => onSave({ title: draft.title })} />
        <textarea
          className="rh-video-prompt"
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onBlur={() => onSave({ body: draft.body })}
          placeholder={promptPlaceholder}
        />
        {activeDraftQuery && (
          <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />
        )}
        <div className="rh-video-preview">
          {output?.imageUrl ? <img src={output.imageUrl} alt={draft.title} /> : <Play />}
          <span>{output?.videoUrl ? "MP4 文件已生成，可下载" : output?.videoId ? `视频任务已创建: ${output.videoId}` : draft.body ? "视频生成配置已就绪，尚未得到 MP4 文件" : "空视频节点"}</span>
        </div>
        <div className="rh-video-editor-footer">
          <select value={videoModel} onChange={(event) => setVideoModel(event.target.value)}>
            <option>grok-imagine-1.0-video-super-720p</option>
            <option>veo_3_1-fast</option>
          </select>
          <select value={videoRatio} onChange={(event) => setVideoRatio(event.target.value)}>
            <option>16:9 · 720P · 5s</option>
            <option>9:16 · 720P · 5s</option>
            <option>1:1 · 720P · 5s</option>
          </select>
          <button type="button" className={videoSound ? "active" : ""} onClick={() => setVideoSound((value) => !value)} title="音效"><Volume2 /></button>
          <span />
          <button type="button" onClick={() => void handleTransformDraft("optimize")} title="优化 CAL"><Wand2 /></button>
          <button type="button" className={translateVideo ? "active" : ""} onClick={() => void handleTransformDraft("translate")} title="调用文本模型翻译"><Languages /></button>
          <button type="button" title="参数"><SlidersHorizontal /></button>
          <button type="button">1个</button>
          <small>♦ 135</small>
          {output?.videoUrl && <button type="button" onClick={() => downloadFile(output.videoUrl, draft.title, "mp4")}><ArrowDownToLine />下载MP4</button>}
          <button type="button" className="submit" title={isVideoOutput ? "创建或刷新视频任务" : "生成视频配置"} aria-label="生成视频配置" onClick={() => void handleVideoGenerate()} disabled={generating || !(draft.body || framePrompt).trim()}>{generating ? <Loader2 className="spin" /> : <Send />}</button>
        </div>
      </aside>
    );
  }

  if (isDocumentOutput) {
    return (
      <aside className="rh-node-editor rh-context-editor prompt" onPointerDown={(event) => event.stopPropagation()}>
        <div className="rh-node-editor-head">
          <div>
            <strong>{draft.title}</strong>
            <small>PDF 当前是封面/结构预览，尚未导出真实 PDF 文件。</small>
          </div>
          <button type="button" onClick={onClose}><X /></button>
        </div>
        {output?.imageUrl && <button type="button" className="rh-editor-image compact-preview" onClick={() => onPreview({ title: draft.title, subtitle: output.copy, imageUrl: output.imageUrl, color: draft.preview, nodeId: draft.id })} style={{ backgroundImage: `url(${output.imageUrl})` }}><span>PDF 封面预览</span></button>}
        <textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} onBlur={() => onSave({ body: draft.body })} placeholder={promptPlaceholder} />
        <div className="rh-editor-actions">
          <button type="button" onClick={() => { onSave({ title: draft.title, body: draft.body }); onClose(); }}>保存结构</button>
          <button type="button" disabled>PDF 导出待接入</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rh-node-editor" onPointerDown={(event) => event.stopPropagation()}>
      <div className="rh-node-editor-head">
        <div>
          <strong>编辑节点</strong>
          <small>{draft.type} · {draft.id}</small>
        </div>
        <button type="button" onClick={onClose}><X /></button>
      </div>
      <label>
        节点名称
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => onSave({ title: draft.title })} />
      </label>
      <label>
        生成 / 处理提示词
        <textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} onBlur={() => onSave({ body: draft.body })} placeholder={promptPlaceholder} />
        {activeDraftQuery && <MentionPopover items={filteredDraftMentionItems} compact onPick={appendMention} />}
      </label>
      <div className="rh-editor-actions">
        <button type="button" onClick={() => { onSave({ title: draft.title, body: draft.body, preview: draft.preview, refs: draft.refs }); onClose(); }}>保存</button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </aside>
  );
}

function BottomComposer(props: {
  frame?: Frame;
  prompt: string;
  setPrompt: (prompt: string) => void;
  activeBrand?: Brand;
  brands: Brand[];
  model?: ModelOption;
  models: ModelOption[];
  assets: Asset[];
  aiStatus: AiStatus | null;
  aiDiagnostics: AiDiagnostics | null;
  onGenerate: (controls: WorkflowControls, promptOverride?: string) => void;
  onCreateProject: () => void;
  onUpdateFrame: (patch: Partial<Pick<Frame, "settings" | "modelId">> & { brandId?: string | null; brandInject?: boolean }) => void;
}) {
  const settings = props.frame?.settings ?? defaultSettings;
  const [outputTarget, setOutputTarget] = useState<WorkflowOutputTarget>("jpg");
  const [orientation, setOrientation] = useState<WorkflowOrientation>("portrait");
  const [presetId, setPresetId] = useState<WorkflowPresetId>("feed-45");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const composerExample = "为 xmanx 生成 5.1 活动投放画面";
  const workflowMode = /(^|\s)@[\p{L}0-9_-]+|(^|\s)\/[\p{L}0-9_-]+|->/u.test(props.prompt);
  useEffect(() => {
    if (!props.frame?.outputs?.length) return;
    const kinds = props.frame.outputs.map((output) => output.kind);
    const nextTarget: WorkflowOutputTarget = kinds.includes("video") && kinds.includes("document")
      ? "kit"
      : kinds.includes("video")
        ? "mp4"
        : kinds.includes("document")
          ? "pdf"
          : props.frame.outputs[0]?.title?.toLowerCase().includes("png")
            ? "png"
            : "jpg";
    setOutputTarget(nextTarget);
    if (props.frame.settings?.ratio === "9:16") setOrientation("portrait");
    else setOrientation("landscape");
    const matchingPreset = workflowPresets.find((preset) => preset.formats.includes(nextTarget) && preset.ratio === props.frame?.settings?.ratio) ?? defaultPresetForOutput(nextTarget);
    setPresetId(matchingPreset.id);
  }, [props.frame?.id]);
  function updateSetting<K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) {
    props.onUpdateFrame({ settings: { ...settings, [key]: value } });
  }
  function settingsForResult(nextOutput: WorkflowOutputTarget, nextPreset: WorkflowPreset) {
    return {
      ...settings,
      ratio: nextPreset.ratio,
      count: 1,
      duration: nextOutput === "mp4" || nextOutput === "kit" ? Math.max(settings.duration || nextPreset.duration || 5, 1) : 0
    };
  }
  function updateOutputTarget(nextOutput: WorkflowOutputTarget) {
    setOutputTarget(nextOutput);
    const nextPreset = defaultPresetForOutput(nextOutput);
    setPresetId(nextPreset.id);
    setOrientation(nextPreset.orientation);
    props.onUpdateFrame({ settings: settingsForResult(nextOutput, nextPreset) });
  }
  function updatePreset(nextPresetId: WorkflowPresetId) {
    const nextPreset = workflowPresets.find((preset) => preset.id === nextPresetId) ?? defaultPresetForOutput(outputTarget);
    setPresetId(nextPreset.id);
    setOrientation(nextPreset.orientation);
    props.onUpdateFrame({ settings: settingsForResult(outputTarget, nextPreset) });
  }
  const presetOptions = workflowPresets.filter((preset) => preset.formats.includes(outputTarget));
  const currentPreset = workflowPresets.find((preset) => preset.id === presetId) ?? defaultPresetForOutput(outputTarget);
  function applyPresetToCal(text: string) {
    const clean = text.replace(/\s+用途:[^-\n]+(?=\s->|$)/, "").replace(/\s+尺寸:[^-\n]+(?=\s->|$)/, "");
    const marker = `用途: ${currentPreset.label} 尺寸: ${currentPreset.size}`;
    return clean.includes("->") ? clean.replace(/\s*->\s*/, ` ${marker} -> `) : `${clean} ${marker}`;
  }
  const mentionItems = buildMentionItems(props.activeBrand, props.assets);
  const referencePreview = buildPromptReferencePreview(props.prompt, mentionItems);
  const filteredMentionItems = filterMentionItems(mentionItems, props.prompt).slice(0, 10);
  const activeQuery = activeReferenceQuery(props.prompt);
  function insertMention(item: MentionItem) {
    props.setPrompt(insertReferenceToken(props.prompt, item.token));
  }
  function updateProjectBrand(brandId: string) {
    const hasBrand = Boolean(brandId);
    props.onUpdateFrame({
      brandId: hasBrand ? brandId : null,
      settings: { ...settings, brandInject: hasBrand },
      brandInject: hasBrand
    });
  }
  async function optimizeCurrentPrompt() {
    if (!props.prompt.trim()) return "";
    setOptimizing(true);
    try {
      const result = await api.post<{ text: string }>("/ai/transform-text", {
        text: props.prompt,
        action: "optimize",
        brandId: props.frame?.brandId || props.activeBrand?.id,
        model: props.model?.model ?? props.model?.id,
        outputTarget,
        orientation
      });
      const optimized = applyPresetToCal(result.text);
      props.setPrompt(optimized);
      return optimized;
    } finally {
      setOptimizing(false);
    }
  }
  async function generateWithOptimization() {
    if (!props.prompt.trim()) return;
    const shouldOptimize = !workflowMode || !/->/.test(props.prompt);
    const nextPrompt = shouldOptimize ? await optimizeCurrentPrompt() : props.prompt;
    props.onGenerate({ outputTarget, orientation, preset: currentPreset.id }, nextPrompt || props.prompt);
  }
  return (
    <div className={`rh-composer ${workflowMode ? "workflow" : ""}`}>
      <button type="button" className="rh-add" onClick={props.onCreateProject} title="新建项目画布"><Plus /><span>New</span></button>
      <textarea value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} placeholder={composerExample} aria-label="生成当前画布提示词" />
      {referencePreview.total > 0 && (
        <div className="rh-composer-refs">
          <strong>{referencePreview.images.length} 图 / {referencePreview.texts.length} 文本</strong>
          {[...referencePreview.images, ...referencePreview.texts].slice(0, 6).map((item) => (
            <span key={`preview_${item.id}`} className={item.imageUrl ? "image" : ""}>{item.token}</span>
          ))}
        </div>
      )}
      {activeQuery && (
        <div className="rh-mention-popover">
          <strong>{activeQuery.symbol === "@" ? "@ 智能体" : activeQuery.symbol === "#" ? "# 文本引用兼容" : activeQuery.symbol === "/" ? "/ 命令" : activeQuery.symbol === "$" ? "$ 资源/文案" : "% 标签"}</strong>
          <em>{activeQuery.symbol === "$" || activeQuery.symbol === "#" || activeQuery.symbol === "@" ? "图片资源会作为真实参考图传入 skill，文本资源会展开；旧 @/# 会自动转 CAL" : "按 CAL 语言规则生成结构化执行参数"}</em>
          {filteredMentionItems.map((item) => (
            <button type="button" key={`${item.group}_${item.id}_${item.token}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(item)}>
              <span style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: item.color }}>{mentionIconText(item, activeQuery.symbol)}</span>
              <b>{displayMentionToken(item, activeQuery.symbol)}</b>
              <small>{item.title}</small>
            </button>
          ))}
          {!filteredMentionItems.length && <small>没有匹配项。继续输入或先在品牌面板补齐素材。</small>}
        </div>
      )}
      <div className="rh-composer-row">
        {workflowMode && <span className="rh-workflow-pill"><Route />CAL</span>}
        <select value={props.model?.id ?? "imgen-skill"} onChange={(event) => props.onUpdateFrame({ modelId: event.target.value })}>
          {props.models.filter((item) => item.type === "image").map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <select className="rh-brand-select" value={props.frame?.brandId ?? ""} onChange={(event) => updateProjectBrand(event.target.value)} title="项目品牌">
          <option value="">无品牌</option>
          {props.brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
        </select>
        <select value={outputTarget} onChange={(event) => updateOutputTarget(event.target.value as WorkflowOutputTarget)} title="输出文件格式">
          <option value="jpg">JPG</option>
          <option value="png">PNG</option>
          <option value="pdf">PDF</option>
          <option value="mp4">MP4</option>
          <option value="kit">套装</option>
        </select>
        <select className="rh-preset-select" value={currentPreset.id} onChange={(event) => updatePreset(event.target.value as WorkflowPresetId)} title="用途和尺寸">
          {presetOptions.map((preset) => <option value={preset.id} key={preset.id}>{preset.label} · {preset.size}</option>)}
        </select>
        <button type="button" className="rh-optimize" onClick={() => void optimizeCurrentPrompt()} disabled={optimizing || !props.prompt.trim()} title="把自然语言优化为 CAL 工作流"><Wand2 />{optimizing ? "优化中" : "优化"}</button>
        <button type="button" className="rh-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)} title="高级参数"><SlidersHorizontal /></button>
        <button type="button" className="rh-send" onClick={() => void generateWithOptimization()} title={`生成当前画布，结果进入输出节点：${referencePreview.images.length} 张参考图 / ${referencePreview.texts.length} 个文本字段`}><Send /></button>
      </div>
      {advancedOpen && (
        <div className="rh-composer-advanced">
          <span>{currentPreset.note} · {currentPreset.size} · {currentPreset.ratio}</span>
          <select value={settings.quality} onChange={(event) => updateSetting("quality", event.target.value as GenerationSettings["quality"])}><option value="standard">standard</option><option value="hd">hd</option><option value="ultra">ultra</option></select>
          {(outputTarget === "jpg" || outputTarget === "png") && <select value={settings.count} onChange={(event) => updateSetting("count", Number(event.target.value))}><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option><option value={6}>6x</option></select>}
          {(outputTarget === "jpg" || outputTarget === "png") && <label className="rh-composer-slider">参考强度<input type="range" min={0} max={100} value={settings.strength} onChange={(event) => updateSetting("strength", Number(event.target.value))} /></label>}
          {(outputTarget === "mp4" || outputTarget === "kit") && <label className="rh-composer-number">时长<input type="number" min={1} max={60} value={settings.duration || 5} onChange={(event) => updateSetting("duration", Number(event.target.value))} /></label>}
        </div>
      )}
      <div className="rh-composer-status">
        <span>
          {props.frame?.status === "generating"
            ? `生成中 ${props.frame.progress}% · 完成后显示在输出图节点`
            : props.frame?.outputs?.some((output) => output.imageUrl)
              ? "已生成 · 图片显示在画布输出图节点"
            : props.aiDiagnostics?.runtime.helpOk
              ? props.aiDiagnostics.runtime.canAttemptGeneration ? "Skill ready · runtime ok" : "Skill runtime ok · key missing"
            : props.aiStatus?.imageGeneration.configured
              ? `Skill ready · ${props.aiStatus.imageGeneration.keySource}`
              : "Skill key missing"}
        </span>
        <i><b style={{ width: `${props.frame?.progress ?? 0}%` }} /></i>
      </div>
    </div>
  );
}

function ImagePreview({ preview, onClose, onSaveAsset }: { preview: PreviewTarget; onClose: () => void; onSaveAsset: (preview: PreviewTarget) => void }) {
  return (
    <div className="rh-preview-backdrop" onClick={onClose}>
      <section className="rh-preview" onClick={(event) => event.stopPropagation()}>
        <div className="rh-preview-head">
          <div><strong>{preview.title}</strong><small>{preview.subtitle}</small></div>
          <button type="button" title="关闭预览" aria-label="关闭预览" onClick={onClose}><X /></button>
        </div>
        <div className="rh-preview-image" style={preview.imageUrl ? { backgroundImage: `url(${preview.imageUrl})` } : { background: preview.color ?? "#111827" }}>{!preview.imageUrl && <Image />}</div>
        <div className="rh-preview-actions">
          <button type="button" disabled><ChevronLeft />前插</button>
          <button type="button" disabled><Plus />后插</button>
          <button type="button" onClick={() => downloadImage(preview.imageUrl, preview.title)} disabled={!preview.imageUrl}><ArrowDownToLine />下载</button>
          <button type="button" onClick={() => { onSaveAsset(preview); onClose(); }} disabled={!preview.imageUrl}><Upload />保存到素材</button>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
