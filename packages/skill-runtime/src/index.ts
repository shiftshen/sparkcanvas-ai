export type WorkGraphSkillRuntimeMode = "node" | "workflow";

export type WorkGraphSkillRuntimeNode = {
  id: string;
  title: string;
  type: string;
  body: string;
};

export type WorkGraphSkillRuntimeSkill = {
  id: string;
  title: string;
  command: string;
  output?: string;
  skillMdPath?: string;
  runtime?: string;
};

export type WorkGraphSkillRuntimeAsset = {
  id: string;
  title?: string;
  kind?: string;
  type?: string;
  token?: string;
  tags?: string[];
  referencePath?: string;
};

export type WorkGraphSkillRuntimeModelPolicy = {
  selectedModelId: string;
  selectedCapability: string;
  route: string;
  reason: string;
  strategy?: string;
};

export type WorkGraphSkillRuntimeInput = {
  mode: WorkGraphSkillRuntimeMode;
  prompt: string;
  output: string;
  node: WorkGraphSkillRuntimeNode;
  workflowId: string;
  skill: WorkGraphSkillRuntimeSkill | null;
  modelPolicy: WorkGraphSkillRuntimeModelPolicy;
  brand: {
    id: string;
    name?: string;
    context: string;
  };
  assets: WorkGraphSkillRuntimeAsset[];
  materialIds: string[];
  nodeParams?: Record<string, unknown>;
  now?: () => string;
};

export type WorkGraphSkillRuntimeOutput = {
  executor: "workgraph-skill-runtime";
  status: "done";
  output: string;
  preview: string;
  logs: Array<{
    step: "prepare" | "skill" | "model" | "preview";
    message: string;
    payload: Record<string, unknown>;
  }>;
};

function assetLine(asset: WorkGraphSkillRuntimeAsset) {
  const title = asset.title || asset.id;
  const kind = asset.kind || asset.type || "asset";
  const tags = asset.tags?.length ? ` tags:${asset.tags.join(",")}` : "";
  const ref = asset.referencePath || asset.token || asset.id;
  return `- ${title} [${kind}] ${ref}${tags}`;
}

function videoPlan(input: WorkGraphSkillRuntimeInput) {
  const assets = input.assets.length ? input.assets.map(assetLine).join("\n") : "- no selected assets; use DAPOT brand defaults and request user upload if precision is required";
  const params = input.nodeParams ?? {};
  const ratio = typeof params.ratio === "string" ? params.ratio : "9:16";
  const duration = typeof params.duration === "string" ? params.duration : "8s";
  const quality = typeof params.quality === "string" ? params.quality : "preview";
  return [
    `# ${input.node.title} Preview`,
    "",
    `Goal: ${input.prompt}`,
    `Brand: ${input.brand.name || input.brand.id}`,
    `Node: ${input.node.type} / ${input.node.id}`,
    `Skill: ${input.skill?.title || "auto skill"} (${input.skill?.command || "draft"})`,
    `Model: ${input.modelPolicy.selectedModelId} (${input.modelPolicy.strategy || "auto"})`,
    `Module Parameters: ratio ${ratio}, duration ${duration}, quality ${quality}`,
    "",
    "## Brand Context",
    input.brand.context,
    "",
    "## Selected Assets",
    assets,
    "",
    "## TikTok Opening Video Plan",
    `1. Hook 0-3s (${ratio}): young Thai women entering DAPOT, clear logo, warm welcome.`,
    `2. Flavor world 3-${duration}: fast cuts of 299/399/499 buffet, sauce station, hot pot closeups.`,
    "3. Social proof: friends dining, clean table, photo-worthy red-black-gold scene.",
    "4. Offer: opening message, low text density, Discover Your World of Flavors.",
    `5. CTA: visit DAPOT under CHINDA HOTPOT, ${quality} review output, save/share for opening day.`,
    "",
    "## Thai-first Copy",
    "เปิดโลกแห่งรสชาติที่ DAPOT HOT POT | บุฟเฟต์ 299/399/499 | มาถ่ายรูปและกินหม้อไฟกับเพื่อนวันนี้",
    "",
    "## Image Prompts",
    "- clean Thai hot pot restaurant opening, DAPOT logo visible, young women friends, warm red black gold, appetizing steam, low text density",
    "- closeup hot pot buffet 299 399 499, sauce station, desserts and drinks, clean trustworthy lighting, social TikTok style",
    "",
    "## Execution Notes",
    `Route through ${input.modelPolicy.route}. Paid video generation is not called in first-stage preview mode.`
  ].join("\n");
}

function genericPlan(input: WorkGraphSkillRuntimeInput) {
  const params = input.nodeParams ?? {};
  const size = typeof params.size === "string" ? params.size : "";
  const format = typeof params.format === "string" ? params.format : "";
  const schema = typeof params.schema === "string" ? params.schema : "";
  const language = typeof params.language === "string" ? params.language : "";
  return [
    `# ${input.node.title} Preview`,
    "",
    `Goal: ${input.prompt}`,
    `Brand: ${input.brand.name || input.brand.id}`,
    `Skill: ${input.skill?.title || "auto skill"}`,
    `Model: ${input.modelPolicy.selectedModelId}`,
    [size ? `Size: ${size}` : "", format ? `Format: ${format}` : "", schema ? `Schema: ${schema}` : "", language ? `Language: ${language}` : ""].filter(Boolean).join(" | "),
    "",
    input.node.body,
    "",
    "## Output",
    input.output,
    "",
    "## Context",
    input.brand.context
  ].filter(Boolean).join("\n");
}

export function runWorkGraphSkill(input: WorkGraphSkillRuntimeInput): WorkGraphSkillRuntimeOutput {
  const outputKind = /mp4|video|tiktok|short/i.test(`${input.output} ${input.node.type} ${input.prompt}`) ? "video" : "generic";
  const preview = outputKind === "video" ? videoPlan(input) : genericPlan(input);
  return {
    executor: "workgraph-skill-runtime",
    status: "done",
    output: input.output,
    preview,
    logs: [
      {
        step: "prepare",
        message: `Prepared ${input.assets.length} AssetObject references and brand context ${input.brand.id}.`,
        payload: { materialIds: input.materialIds, brandId: input.brand.id, nodeParams: input.nodeParams ?? {} }
      },
      {
        step: "skill",
        message: `Resolved Skill ${input.skill?.id || "draft-skill"} for ${input.node.type}.`,
        payload: { skill: input.skill, node: input.node }
      },
      {
        step: "model",
        message: `Selected model ${input.modelPolicy.selectedModelId} with route ${input.modelPolicy.route}.`,
        payload: input.modelPolicy
      },
      {
        step: "preview",
        message: "Generated first-stage preview plan without calling paid video generation.",
        payload: { outputKind, previewLength: preview.length, nodeParams: input.nodeParams ?? {} }
      }
    ]
  };
}

// Skill auto-evolution decision (deliverable ④). Pure function so it can be
// unit-tested directly: a successful run past the promote threshold turns the
// skill into a reusable template; a failed run flags it for a repair task.
export type WorkGraphSkillEvolutionState = {
  status?: string;
  runCount?: number;
  successCount?: number;
  failureCount?: number;
  template?: boolean;
};

export type WorkGraphSkillEvolutionDecision = {
  status: string;
  template: boolean;
  promote: boolean;
  repair: boolean;
  reason: string;
};

export function evaluateWorkGraphSkillEvolution(input: {
  success: boolean;
  evolution: WorkGraphSkillEvolutionState;
  promoteThreshold?: number;
}): WorkGraphSkillEvolutionDecision {
  const threshold = Math.max(1, Math.floor(input.promoteThreshold ?? 2));
  const successCount = Number(input.evolution?.successCount ?? 0);
  const alreadyTemplate = Boolean(input.evolution?.template) || input.evolution?.status === "reusable-template";
  if (!input.success) {
    return { status: "needs_repair", template: alreadyTemplate, promote: false, repair: true, reason: "run failed; repair task created" };
  }
  if (!alreadyTemplate && successCount >= threshold) {
    return { status: "reusable-template", template: true, promote: true, repair: false, reason: `promoted to reusable template after ${successCount} successful runs` };
  }
  return {
    status: alreadyTemplate ? "reusable-template" : "active",
    template: alreadyTemplate,
    promote: false,
    repair: false,
    reason: alreadyTemplate ? "already a reusable template" : `active; ${Math.max(0, threshold - successCount)} more successful run(s) to promote`
  };
}
