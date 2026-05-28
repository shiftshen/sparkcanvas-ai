import React, { useMemo, useState } from "react";
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
};

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
    nodeType: "output"
  },
  {
    id: "compose",
    title: "素材合成",
    command: "/compose",
    output: "PNG",
    description: "把多张素材按主题合成统一画面。",
    icon: "compose",
    keywords: ["合成", "融合", "compose", "merge", "mix"],
    nodeType: "compose"
  },
  {
    id: "story",
    title: "图生视频规划",
    command: "/generate-video",
    output: "MP4",
    description: "把素材作为首帧/参考图，生成视频任务规划。",
    icon: "video",
    keywords: ["视频", "首帧", "分镜", "video", "mp4", "storyboard"],
    nodeType: "video"
  },
  {
    id: "kit",
    title: "素材归档",
    command: "/build-kit",
    output: "ZIP",
    description: "把当前素材、提示词和输出整理成项目包。",
    icon: "archive",
    keywords: ["文件", "归档", "zip", "kit", "素材包", "导出"],
    nodeType: "file"
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
  { id: "gpt-image", name: "GPT Image / cloud", kind: "image", cost: "高", speed: "中", quality: "高", status: "fallback" },
  { id: "imgen", name: "@imgen gpt-5.4", kind: "image", cost: "中", speed: "中", quality: "中高", status: "ready" },
  { id: "kling", name: "Kling / 可灵", kind: "video", cost: "高", speed: "慢", quality: "高", status: "fallback" },
  { id: "local-flux", name: "Local Flux", kind: "local", cost: "低", speed: "中", quality: "中高", status: "offline" }
];

const defaultPrompt = "@imgen /compose 使用 $xmanx.logo $xmanx.product，生成黑橙品牌首图 -> PNG";

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
      body: `${model.kind} · 成本 ${model.cost} · 速度 ${model.speed} · 质量 ${model.quality} · ${model.status}`,
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
  const [materials, setMaterials] = useState(seedMaterials);
  const [skills, setSkills] = useState(skillTemplates);
  const [activeBrandId, setActiveBrandId] = useState("dapot");
  const [activeModelId, setActiveModelId] = useState("imgen");
  const [selectedIds, setSelectedIds] = useState<string[]>(["mat-x-logo", "mat-product"]);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [activeMaterialId, setActiveMaterialId] = useState(seedMaterials[0].id);
  const [activeNodeId, setActiveNodeId] = useState("skill");
  const [skillSearch, setSkillSearch] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillCommand, setNewSkillCommand] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("");
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

  function toggleMaterial(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setActiveMaterialId(id);
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
    setMaterials((current) => [...incoming, ...current]);
    setSelectedIds((current) => [...incoming.map((item) => item.id), ...current]);
    setActiveMaterialId(incoming[0].id);
    const refs = incoming.map((item) => item.token).join(" ");
    setPrompt((current) => current.includes(refs) ? current : `${current.replace(/\s*->\s*\w+$/i, "")} ${refs} -> PNG`);
  }

  function applySkill(template: SkillTemplate) {
    const refs = selectedMaterials.map((item) => item.token).join(" ") || "$local.asset";
    setPrompt(`@imgen ${template.command} 使用 ${refs}，生成可预览素材结果 -> ${template.output}`);
  }

  function createSkillFromSearch() {
    const title = newSkillName.trim() || skillSearch.trim() || "自定义 Skill";
    const command = (newSkillCommand.trim() || title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")).replace(/^\/?/, "/");
    const skill: SkillTemplate = {
      id: `skill-${Date.now().toString(36)}`,
      title,
      command,
      output: /video|视频|mp4/i.test(`${title} ${command}`) ? "MP4" : "PNG",
      description: "由一句话搜索自动创建，可继续编辑命令、输出和提示词。",
      icon: /video|视频|mp4/i.test(`${title} ${command}`) ? "video" : "image",
      keywords: title.split(/\s+/).filter(Boolean),
      nodeType: /video|视频|mp4/i.test(`${title} ${command}`) ? "video" : "output"
    };
    setSkills((current) => [skill, ...current]);
    applySkill(skill);
    setSkillSearch("");
    setNewSkillName("");
    setNewSkillCommand("");
  }

  function updateActiveNodeBody(body: string) {
    if (!activeNode) return;
    if (activeNode.id === "skill") {
      setPrompt((current) => current.includes(activeNode.body) ? current.replace(activeNode.body, body) : `${current}\n${body}`);
      return;
    }
    setPrompt((current) => `${current}\n节点 ${activeNode.title}: ${body}`.trim());
  }

  function applyNaturalLanguageChange(change: string) {
    const lower = change.toLowerCase();
    if (!change.trim()) return;
    if (lower.includes("本地") || lower.includes("local")) setActiveModelId("local-flux");
    if (lower.includes("最贵") || lower.includes("最好") || lower.includes("高质量")) setActiveModelId("gpt-image");
    if (lower.includes("视频") || lower.includes("mp4")) applySkill(skills.find((item) => item.id === "story") ?? skills[0]);
    if (lower.includes("dapot")) setActiveBrandId("dapot");
    if (lower.includes("xmanx")) setActiveBrandId("xmanx");
    setPrompt((current) => `${current}\n修改要求: ${change}`);
  }

  function runWorkflow() {
    const job: Job = {
      id: `job-${Date.now().toString(36)}`,
      title: ast.commands[0] ? `/${ast.commands[0]}` : "素材工作流",
      status: "running",
      output: ast.outputs[0]?.toUpperCase() || "PNG",
      materials: selectedMaterials.map((item) => item.token)
    };
    setJobs((current) => [job, ...current]);
    window.setTimeout(() => {
      setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: "done" } : item));
    }, 900);
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
          <span><Library /> {materials.length} materials</span>
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
          <div className="pm-panel-head"><strong>品牌画布</strong><FolderOpen /></div>
          {brandMemories.map((brand) => (
            <button key={brand.id} className={`pm-skill ${activeBrandId === brand.id ? "selected" : ""}`} onClick={() => setActiveBrandId(brand.id)}>
              <Library />
              <span><strong>{brand.name}</strong><small>{brand.colors} · {brand.rules.length} rules</small></span>
            </button>
          ))}
        </section>

        <section className="pm-panel compact">
          <div className="pm-panel-head"><strong>模型画布</strong><Bot /></div>
          {modelOptions.map((model) => (
            <button key={model.id} className={`pm-skill ${activeModelId === model.id ? "selected" : ""}`} onClick={() => setActiveModelId(model.id)}>
              <Bot />
              <span><strong>{model.name}</strong><small>{model.kind} · {model.cost} · {model.status}</small></span>
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
                <button type="button" onClick={() => setPrompt(`${prompt}\n修改 ${activeNode.title}: ${activeNode.body}`)}><Pencil /> 写入提示词</button>
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
            </div>
            <button type="button" onClick={() => setSkillSearch(matchingSkill.title)}>
              <Search /> 查找相似 Skill
            </button>
            <button type="button" onClick={() => {
              setPrompt(`${prompt}\n进化要求: 将 ${matchingSkill.command} 沉淀为可复用 SKILL.md，保留输入素材、模型、失败重试和输出检查。`);
              runWorkflow();
            }}>
              <Wand2 /> 生成进化任务
            </button>
            <p className="pm-muted">后续接入 pi 后，这里会把高频流程保存成 SKILL.md、测试脚本和回归样例。</p>
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
      </aside>

      <footer className="pm-composer">
        <button type="button" className="pm-new"><Plus /> 新素材</button>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
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
