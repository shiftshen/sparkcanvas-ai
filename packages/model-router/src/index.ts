import { normalizeWorkGraphModelStrategy, normalizeWorkGraphNodeType, type WorkGraphModelStrategy } from "@sparkcanvas/core";

export type WorkGraphModelCapability = "image" | "video" | "text" | "local" | "reference_image" | "composition";
export type WorkGraphModelKind = "image" | "video" | "text" | "local";
export type WorkGraphModelStatus = "ready" | "fallback" | "offline" | "disabled";

export type WorkGraphModelCatalogItem = {
  id: string;
  kind: WorkGraphModelKind;
  status: WorkGraphModelStatus;
  capabilities: WorkGraphModelCapability[];
  fallbackModelIds: string[];
  nodeAffinity: string[];
  route: string;
};

export type WorkGraphRoutingDecision = {
  id: string;
  nodeId: string;
  nodeType: string;
  strategy: WorkGraphModelStrategy;
  requestedModelId: string;
  selectedModelId: string;
  selectedCapability: "image" | "video" | "text" | "local";
  fallbackModelIds: string[];
  route: string;
  reason: string;
  createdAt: string;
};

export type WorkGraphModelRouterInput = {
  activeModelId?: string;
  output: string;
  node?: {
    id?: string;
    type?: string;
    modelStrategy?: string;
  };
  now?: () => string;
  idFactory?: () => string;
};

export function workGraphResultKind(output: string) {
  if (/mp4|video|mov/i.test(output)) return "video";
  if (/pdf|doc|text|script|copy/i.test(output)) return "document";
  if (/zip|archive/i.test(output)) return "archive";
  return "image";
}

export function workGraphModelCatalog(activeModelId = "imgen", defaultOutput = "PNG") {
  const activeModel = activeModelId || "imgen";
  return [
    {
      id: "vdamo-gpt-image-2",
      kind: "image",
      status: "ready",
      capabilities: ["image", "reference_image"],
      fallbackModelIds: ["vdamo-gpt-image-1-5", "vdamo-gpt-image-1", "imgen"],
      nodeAffinity: ["output", "compose", "preview", "image_generate"],
      route: "/v1/images/generations"
    },
    {
      id: "vdamo-gpt-image-1-5",
      kind: "image",
      status: "fallback",
      capabilities: ["image", "reference_image"],
      fallbackModelIds: ["vdamo-gpt-image-1", "imgen"],
      nodeAffinity: ["output", "compose", "preview", "image_generate"],
      route: "/v1/images/generations"
    },
    {
      id: "vdamo-gpt-image-1",
      kind: "image",
      status: "fallback",
      capabilities: ["image", "reference_image"],
      fallbackModelIds: ["imgen"],
      nodeAffinity: ["output", "compose", "preview", "image_generate"],
      route: "/v1/images/generations"
    },
    {
      id: "imgen",
      kind: "image",
      status: activeModel === "imgen" ? "ready" : "fallback",
      capabilities: ["image", "reference_image", "composition"],
      fallbackModelIds: ["vdamo-gpt-image-2", "local-flux"],
      nodeAffinity: ["skill", "compose", "output", "skill_execute", "image_generate", "preview"],
      route: "/v1/responses image_generation"
    },
    {
      id: "yijiarj-grok-video-super",
      kind: "video",
      status: "ready",
      capabilities: ["video", "reference_image"],
      fallbackModelIds: ["yijiarj-grok-video-720p", "yijiarj-veo-3-1-fast"],
      nodeAffinity: ["video", "output", "video_generate", "preview"],
      route: "/v1/videos"
    },
    {
      id: "yijiarj-grok-video-720p",
      kind: "video",
      status: "fallback",
      capabilities: ["video", "reference_image"],
      fallbackModelIds: ["yijiarj-grok-video-super", "yijiarj-veo-3-1-fast"],
      nodeAffinity: ["video", "output", "video_generate", "preview"],
      route: "/v1/videos"
    },
    {
      id: "yijiarj-veo-3-1-fast",
      kind: "video",
      status: "fallback",
      capabilities: ["video", "reference_image"],
      fallbackModelIds: ["yijiarj-grok-video-super"],
      nodeAffinity: ["video", "video_generate"],
      route: "/v1/videos"
    },
    {
      id: "local-flux",
      kind: "local",
      status: "offline",
      capabilities: ["image", "local"],
      fallbackModelIds: ["imgen"],
      nodeAffinity: ["compose", "output", "image_generate", "preview"],
      route: "ollama/local-image"
    },
    {
      id: activeModel,
      kind: /video|grok|veo|kling/i.test(activeModel) ? "video" : workGraphResultKind(defaultOutput) === "video" ? "video" : "image",
      status: "ready",
      capabilities: /video|grok|veo|kling/i.test(activeModel) ? ["video", "reference_image"] : ["image", "reference_image", "composition"],
      fallbackModelIds: ["imgen"],
      nodeAffinity: ["skill", "compose", "output", "video", "skill_execute", "image_generate", "video_generate", "preview"],
      route: /video|grok|veo|kling/i.test(activeModel) ? "/v1/videos" : "workspace-active-model"
    }
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index) as WorkGraphModelCatalogItem[];
}

export function routeWorkGraphModel(input: WorkGraphModelRouterInput): WorkGraphRoutingDecision {
  const activeModelId = input.activeModelId || "imgen";
  const createdAt = input.now?.() ?? new Date().toISOString();
  const nodeId = input.node?.id || "workflow";
  const rawNodeType = input.node?.type || "skill_execute";
  const nodeType = normalizeWorkGraphNodeType(rawNodeType, /video/i.test(rawNodeType) ? "video_generate" : "skill_execute");
  const outputKind = workGraphResultKind(input.output);
  const requiredCapability = outputKind === "video" ? "video" : outputKind === "document" || outputKind === "archive" ? "text" : "image";
  const strategy = normalizeWorkGraphModelStrategy(input.node?.modelStrategy || (outputKind === "video" ? "high_quality" : requiredCapability === "text" ? "fast_draft" : "balanced"));
  const models = workGraphModelCatalog(activeModelId, input.output);
  const requested = models.find((item) => item.id === activeModelId);
  const matches = (item: WorkGraphModelCatalogItem) => item.status === "ready"
    && item.capabilities.includes(requiredCapability)
    && (item.nodeAffinity.includes(nodeType) || item.nodeAffinity.includes(rawNodeType));
  const activeMatches = requested && matches(requested);
  const selected = activeMatches
    ? requested
    : models.find(matches)
      ?? models.find((item) => item.status === "ready" && item.capabilities.includes(requiredCapability))
      ?? requested
      ?? models[0];
  return {
    id: input.idFactory?.() ?? `route-${Date.now().toString(36)}`,
    nodeId,
    nodeType,
    strategy,
    requestedModelId: activeModelId,
    selectedModelId: selected.id,
    selectedCapability: requiredCapability === "text" ? "text" : selected.kind === "local" ? "local" : requiredCapability,
    fallbackModelIds: selected.fallbackModelIds,
    route: selected.route,
    reason: activeMatches
      ? `active model ${activeModelId} matches ${nodeType}/${requiredCapability}/${strategy}`
      : `selected ${selected.id} for ${nodeType}/${requiredCapability}/${strategy}; active ${activeModelId} did not fully match capability, status, or node affinity`,
    createdAt
  };
}
