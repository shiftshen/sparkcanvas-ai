export const workGraphObjectTypes = [
  "goal",
  "asset",
  "brand",
  "skill",
  "model",
  "model_policy",
  "workflow",
  "node",
  "result",
  "feedback",
  "memory",
  "execution_log",
  "prompt"
] as const;

export type WorkGraphObjectType = typeof workGraphObjectTypes[number];

export const workGraphNodeTypes = [
  "goal",
  "brand_context",
  "asset_search",
  "asset_input",
  "skill_search",
  "skill_create",
  "skill_execute",
  "prompt_generate",
  "model_select",
  "text_generate",
  "image_generate",
  "video_generate",
  "preview",
  "human_review",
  "export",
  "feedback",
  "archive"
] as const;

export type WorkGraphNodeType = typeof workGraphNodeTypes[number];

export const workGraphModelProviders = [
  "ollama",
  "openai",
  "google",
  "anthropic",
  "local_sd",
  "local_flux",
  "local_video",
  "custom"
] as const;

export type WorkGraphModelProvider = typeof workGraphModelProviders[number];

export const workGraphModelStrategies = [
  "fast_draft",
  "low_cost",
  "balanced",
  "high_quality",
  "local_privacy",
  "final_output",
  "manual"
] as const;

export type WorkGraphModelStrategy = typeof workGraphModelStrategies[number];

export type GoalObject = {
  id: string;
  type: "goal";
  title: string;
  prompt: string;
  brandId?: string;
  workflowId?: string;
  status: "draft" | "planned" | "running" | "done" | "needs_review";
  createdAt: string;
  updatedAt: string;
};

export type AssetObject = {
  id: string;
  type: "asset";
  title: string;
  kind: "image" | "video" | "audio" | "pdf" | "svg" | "font" | "document" | "unknown";
  brandId?: string;
  path?: string;
  previewUrl?: string;
  tags: string[];
  version: string;
  usageHistory: string[];
  createdAt: string;
};

export type BrandObject = {
  id: string;
  type: "brand";
  name: string;
  context: string;
  forbiddenWords: string[];
  dislikedPatterns: string[];
  memoryIds: string[];
  updatedAt: string;
};

export type SkillObject = {
  id: string;
  type: "skill";
  title: string;
  command: string;
  status: "draft" | "candidate" | "active" | "archived";
  skillMdPath: string;
  version: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  updatedAt: string;
};

export type ModelObject = {
  id: string;
  type: "model";
  provider: WorkGraphModelProvider;
  model: string;
  capabilities: Array<"text" | "image" | "video" | "audio" | "local">;
  status: "ready" | "disabled" | "planned" | "error";
};

export type ModelPolicyObject = {
  id: string;
  type: "model_policy";
  nodeId?: string;
  strategy: WorkGraphModelStrategy;
  provider: WorkGraphModelProvider;
  modelId: string;
  fallbackModelIds: string[];
  updatedAt: string;
};

export type WorkflowNodeObject = {
  id: string;
  type: "node";
  nodeType: WorkGraphNodeType;
  title: string;
  prompt: string;
  disabled: boolean;
  modelPolicyId?: string;
  modelId?: string;
  skillId?: string;
  assetIds: string[];
  inputObjectIds: string[];
  outputObjectIds: string[];
  logIds: string[];
  retryCount: number;
  updatedAt: string;
};

export type WorkflowObject = {
  id: string;
  type: "workflow";
  goalId: string;
  nodeIds: string[];
  edgeIds: string[];
  status: "draft" | "planned" | "running" | "done" | "needs_review";
  updatedAt: string;
};

export type PromptRecordObject = {
  id: string;
  type: "prompt";
  goalId?: string;
  workflowId: string;
  nodeId: string;
  brandId?: string;
  skillId?: string;
  modelId?: string;
  assetIds: string[];
  sourcePrompt: string;
  finalPrompt: string;
  brandContext: string;
  createdAt: string;
};

export type ResultObject = {
  id: string;
  type: "result";
  goalId?: string;
  workflowId: string;
  nodeId: string;
  assetIds: string[];
  brandId?: string;
  skillId?: string;
  modelId?: string;
  promptRecordId: string;
  logIds: string[];
  feedbackIds: string[];
  preview: string;
  outputPath?: string;
  createdAt: string;
};

export type FeedbackObject = {
  id: string;
  type: "feedback";
  targetType: WorkGraphObjectType;
  targetId: string;
  rating: "accepted" | "needs_revision" | "failed";
  note: string;
  memoryId: string;
  createdAt: string;
};

export type MemoryObject = {
  id: string;
  type: "memory";
  sourceType: WorkGraphObjectType;
  sourceId: string;
  brandId?: string;
  reusable: boolean;
  rule: string;
  createdAt: string;
};

export type ExecutionLogObject = {
  id: string;
  type: "execution_log";
  executionId: string;
  workflowId: string;
  nodeId: string;
  step: string;
  status: "queued" | "running" | "done" | "failed";
  message: string;
  payload?: unknown;
  createdAt: string;
};

export type WorkGraphCoreObject =
  | GoalObject
  | AssetObject
  | BrandObject
  | SkillObject
  | ModelObject
  | ModelPolicyObject
  | WorkflowObject
  | WorkflowNodeObject
  | ResultObject
  | FeedbackObject
  | MemoryObject
  | ExecutionLogObject
  | PromptRecordObject;

export function isWorkGraphNodeType(value: string): value is WorkGraphNodeType {
  return (workGraphNodeTypes as readonly string[]).includes(value);
}

export function isWorkGraphModelProvider(value: string): value is WorkGraphModelProvider {
  return (workGraphModelProviders as readonly string[]).includes(value);
}

export function isWorkGraphModelStrategy(value: string): value is WorkGraphModelStrategy {
  return (workGraphModelStrategies as readonly string[]).includes(value);
}

export function normalizeWorkGraphNodeType(value: string, fallback: WorkGraphNodeType = "skill_execute") {
  const aliases: Record<string, WorkGraphNodeType> = {
    brand: "brand_context",
    reference: "asset_input",
    skill: "skill_execute",
    process: "prompt_generate",
    prompt: "prompt_generate",
    model: "model_select",
    script: "text_generate",
    compose: "image_generate",
    output: "preview",
    file: "export",
    video: "video_generate",
    audio: "skill_execute"
  };
  if (aliases[value]) return aliases[value];
  return isWorkGraphNodeType(value) ? value : fallback;
}

export function normalizeWorkGraphModelStrategy(value: string, fallback: WorkGraphModelStrategy = "balanced") {
  return isWorkGraphModelStrategy(value) ? value : fallback;
}
