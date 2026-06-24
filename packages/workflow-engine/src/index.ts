import { routeWorkGraphModel, workGraphResultKind, type WorkGraphRoutingDecision } from "@sparkcanvas/model-router";

export type WorkGraphEngineBrand = {
  id: string;
  name: string;
  positioning: string;
  rules: string[];
};

export type WorkGraphEngineSkill = Record<string, unknown>;

export type WorkGraphEngineNode = {
  id: string;
  title: string;
  type: string;
  body: string;
  x: number;
  y: number;
  materialIds: string[];
  status: string;
};

export type WorkGraphEnginePlanInput = {
  prompt: string;
  brand: WorkGraphEngineBrand;
  activeModelId: string;
  selectedIds: string[];
  skills: WorkGraphEngineSkill[];
  createdAt: string;
  idFactory: (prefix: string) => string;
  slug: (value: string) => string;
  normalizeSkill: (input: unknown, index?: number) => Record<string, unknown>;
  skillScore: (skill: unknown, prompt: string) => number;
  goalBase: Record<string, unknown>;
  workflowBase: Record<string, unknown>;
  existingSkills: unknown[];
  existingJobsCount: number;
};

export type WorkGraphEnginePlan = {
  plan: {
    id: string;
    source: "workgraph-workflow-engine";
    prompt: string;
    brandId: string;
    output: string;
    nodeIds: string[];
    selectedMaterialIds: string[];
    skillId: string;
    createdSkillId: string;
    routingDecision: WorkGraphRoutingDecision;
    createdAt: string;
  };
  goal: Record<string, unknown>;
  workflow: Record<string, unknown>;
  nodes: WorkGraphEngineNode[];
  skills: unknown[];
  routingDecision: WorkGraphRoutingDecision;
  memory: Record<string, unknown>;
  output: string;
};

export function workGraphOutputForPrompt(prompt: string) {
  if (/视频|video|mp4|短片|reel/i.test(prompt)) return "MP4";
  if (/pdf|文档|deck|slides|ppt/i.test(prompt)) return "PDF";
  if (/zip|archive|打包/i.test(prompt)) return "ZIP";
  return "PNG";
}

export function workGraphPromptTokens(prompt: string) {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

export function workGraphPlanSkillTitle(prompt: string, output: string) {
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

export function buildWorkGraphPlannerNode(input: {
  id: string;
  title: string;
  type: string;
  body: string;
  x: number;
  y: number;
  materialIds?: string[];
  status?: string;
}): WorkGraphEngineNode {
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

function objectField(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  return (input as Record<string, unknown>)[key];
}

function objectString(input: unknown, key: string, fallback = "") {
  const value = objectField(input, key);
  return typeof value === "string" ? value : fallback;
}

function buildCandidateSkill(input: WorkGraphEnginePlanInput, output: string) {
  const isVideo = workGraphResultKind(output) === "video";
  const title = workGraphPlanSkillTitle(input.prompt, output);
  const command = `/${input.slug(title).slice(0, 40)}`;
  return input.normalizeSkill({
    id: input.idFactory("skill-candidate"),
    title,
    command,
    output,
    description: `Workflow Planner 自动创建的候选 Skill，用于执行目标：${input.prompt}`,
    icon: isVideo ? "video" : "image",
    keywords: [...workGraphPromptTokens(input.prompt).slice(0, 8), output.toLowerCase()],
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
    createdAt: input.createdAt
  });
}

export function planWorkGraphWorkflow(input: WorkGraphEnginePlanInput): WorkGraphEnginePlan {
  const output = workGraphOutputForPrompt(input.prompt);
  const matchedSkill = input.skills
    .map((skill) => ({ skill, score: input.skillScore(skill, input.prompt) }))
    .sort((left, right) => right.score - left.score)[0];
  const matchedExistingSkill = matchedSkill && matchedSkill.score > 0 ? matchedSkill.skill : null;
  const candidateSkill = matchedExistingSkill ? null : buildCandidateSkill(input, output);
  const usableSkill = matchedExistingSkill ?? candidateSkill;
  const skillId = usableSkill ? objectString(usableSkill, "id", "") : "";
  const skillCommand = usableSkill ? objectString(usableSkill, "command", "") : "";
  const skillTitle = usableSkill ? objectString(usableSkill, "title", "Reusable Skill") : "Create reusable skill";
  const nextSkills = candidateSkill
    ? [candidateSkill, ...input.existingSkills.filter((skill) => objectString(skill, "id", "") !== objectString(candidateSkill, "id", ""))]
    : input.existingSkills;
  const generateNodeType = workGraphResultKind(output) === "video"
    ? "video_generate"
    : workGraphResultKind(output) === "image"
      ? "image_generate"
      : workGraphResultKind(output) === "document" || workGraphResultKind(output) === "archive"
        ? "export"
        : "text_generate";
  const paidVideoLocked = workGraphResultKind(output) === "video";
  const videoGuardNote = paidVideoLocked
    ? "付费视频生成已锁定；WorkGraph 当前只生成本地预览计划，不请求 yijia。真实视频生成必须走显式生成入口。"
    : "";
  const outputNode = buildWorkGraphPlannerNode({
    id: "output",
    title: `Result Preview · ${output}`,
    type: "preview",
    body: paidVideoLocked
      ? `生成 ${output} 本地预览计划，保留 Result Object、版本和可回写素材库状态。${videoGuardNote}`
      : `生成 ${output}，保留 Result Object、预览地址、版本和可回写素材库状态。`,
    x: 1010,
    y: 198,
    materialIds: input.selectedIds
  });
  const routingDecision = routeWorkGraphModel({
    activeModelId: input.activeModelId,
    output,
    node: { id: outputNode.id, type: outputNode.type },
    now: () => input.createdAt,
    idFactory: () => input.idFactory("route")
  });
  const nodes = [
    buildWorkGraphPlannerNode({ id: "goal", title: "Goal Object", type: "goal", body: input.prompt, x: 70, y: 72 }),
    buildWorkGraphPlannerNode({
      id: "brand-context",
      title: `Brand Context · ${input.brand.name}`,
      type: "brand_context",
      body: `${input.brand.positioning}\n${input.brand.rules.slice(0, 3).join("\n")}`.trim(),
      x: 355,
      y: 52
    }),
    buildWorkGraphPlannerNode({
      id: "asset-retriever",
      title: "Asset Retriever",
      type: "asset_search",
      body: input.selectedIds.length
        ? `读取 ${input.selectedIds.length} 个 Asset Object：${input.selectedIds.slice(0, 4).join(", ")}`
        : "未选择素材；运行前需要上传或从品牌库选择 Asset Object。",
      x: 88,
      y: 252,
      materialIds: input.selectedIds,
      status: input.selectedIds.length ? "ready" : "queued"
    }),
    buildWorkGraphPlannerNode({
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
    buildWorkGraphPlannerNode({
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
    buildWorkGraphPlannerNode({
      id: "model-router",
      title: `Model Router · ${routingDecision.selectedModelId}`,
      type: "model_select",
      body: [routingDecision.reason, videoGuardNote].filter(Boolean).join("\n"),
      x: 690,
      y: 72
    }),
    buildWorkGraphPlannerNode({
      id: "prompt-builder",
      title: "Prompt Builder",
      type: "prompt_generate",
      body: "合并 Goal、Brand Context、Asset Object、Skill 约束和 ModelPolicy，生成可追溯 PromptRecord。",
      x: 690,
      y: 190,
      materialIds: input.selectedIds
    }),
    buildWorkGraphPlannerNode({
      id: "workflow-runner",
      title: "Workflow Runner",
      type: "skill_execute",
      body: paidVideoLocked
        ? `执行 ${skillCommand || "候选 skill"}，生成 ${output} 本地预览计划；不请求 ${routingDecision.route}。`
        : `执行 ${skillCommand || "候选 skill"}，通过 ${routingDecision.route} 生成 ${output}。`,
      x: 690,
      y: 270,
      materialIds: input.selectedIds
    }),
    buildWorkGraphPlannerNode({
      id: "result-generator",
      title: `Generate ${output}`,
      type: generateNodeType,
      body: paidVideoLocked
        ? `生成 ${output} 可预览方案、分镜、文案和画面提示词；第一阶段不请求付费视频接口。`
        : `生成 ${output} Result Object，并写入本地结果、输出和日志目录。`,
      x: 880,
      y: 270,
      materialIds: input.selectedIds
    }),
    outputNode,
    buildWorkGraphPlannerNode({
      id: "human-review",
      title: "Human Review",
      type: "human_review",
      body: "用户检查 ResultObject、PromptRecord、日志和素材引用；可接管节点或写反馈。",
      x: 1180,
      y: 250,
      materialIds: input.selectedIds
    }),
    buildWorkGraphPlannerNode({
      id: "review-memory",
      title: "Feedback Memory",
      type: "feedback",
      body: "记录接受/修改原因，生成 Feedback Object 与 Memory Object，反哺下一次规划。",
      x: 1010,
      y: 392
    }),
    buildWorkGraphPlannerNode({
      id: "archive",
      title: "Archive",
      type: "archive",
      body: "归档 Result、PromptRecord、ExecutionLog、Skill 版本和反馈记忆到 data 目录与 SQLite。",
      x: 1180,
      y: 392
    })
  ];
  const goal = {
    ...input.goalBase,
    rawInput: input.prompt,
    normalizedIntent: input.prompt,
    brandId: input.brand.id,
    activeBrandId: input.brand.id,
    activeModelId: input.activeModelId,
    outputTarget: output.toLowerCase(),
    successCriteria: [
      "workflow graph is persisted as Node Objects",
      "brand and asset references are explicit",
      "model routing decision is auditable",
      "result can be reviewed and saved as reusable material"
    ]
  };
  const workflow = {
    ...input.workflowBase,
    title: "Planned WorkGraph workflow",
    goalId: objectString(goal, "id", "active"),
    status: "ready",
    prompt: input.prompt,
    nodeIds: nodes.map((node) => node.id),
    edgeIds: nodes.slice(1).map((node, index) => `${nodes[index].id}->${node.id}`),
    selectedMaterialIds: input.selectedIds,
    skillIds: skillId ? [skillId] : [],
    modelIds: [routingDecision.selectedModelId],
    outputTarget: output,
    runCount: objectField(input.workflowBase, "runCount") ?? input.existingJobsCount,
    updatedAt: input.createdAt
  };
  const memory = {
    id: input.idFactory("mem-plan"),
    title: "Planned workflow graph",
    source: "planner",
    sourceType: "workflow",
    sourceId: objectString(workflow, "id", "workflow-active"),
    targetType: "workflow",
    targetId: objectString(workflow, "id", "workflow-active"),
    confidence: 0.72,
    reusable: true,
    body: `Planned ${nodes.length} nodes for ${output} via ${routingDecision.selectedModelId}.`,
    createdAt: input.createdAt
  };
  return {
    plan: {
      id: input.idFactory("plan"),
      source: "workgraph-workflow-engine",
      prompt: input.prompt,
      brandId: input.brand.id,
      output,
      nodeIds: nodes.map((node) => node.id),
      selectedMaterialIds: input.selectedIds,
      skillId,
      createdSkillId: candidateSkill ? objectString(candidateSkill, "id", "") : "",
      routingDecision,
      createdAt: input.createdAt
    },
    goal,
    workflow,
    nodes,
    skills: nextSkills,
    routingDecision,
    memory,
    output
  };
}
