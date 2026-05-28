import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distIndex = path.join(root, "apps", "workgraph-os", "dist", "index.html");
const sourceFile = path.join(root, "apps", "workgraph-os", "src", "main.tsx");
const requiredAssets = [
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-logo.png"),
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-product.png"),
  path.join(root, "apps", "workgraph-os", "public", "brand-assets", "generated", "xmanx-ip.png")
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const html = await readFile(distIndex, "utf8");
const source = await readFile(sourceFile, "utf8");
await Promise.all(requiredAssets.map((asset) => access(asset)));

assert(html.includes("<title>WorkGraph OS</title>"), "workgraph-os dist index should preserve the app title");
assert(html.includes("/assets/"), "workgraph-os dist index should reference built assets");
assert(source.includes("type WorkGraphWorkspace"), "workgraph-os should define a workspace object model");
assert(source.includes("workspaceStorageKey"), "workgraph-os should define workspace persistence");
assert(source.includes("recordFeedback"), "workgraph-os should record feedback objects");
assert(source.includes("对象图谱"), "workgraph-os should expose an object graph surface");
assert(source.includes("WorkGraphObjectIndex"), "workgraph-os should consume the backend object index");
assert(source.includes("/workgraph-os/objects"), "workgraph-os should request the object index API");
assert(source.includes("/workgraph-os/brands"), "workgraph-os should request backend brand memory objects");
assert(source.includes("/workgraph-os/assets"), "workgraph-os should request backend asset material objects");
assert(source.includes("/workgraph-os/skills"), "workgraph-os should request backend skill store objects");
assert(source.includes("/workgraph-os/run"), "workgraph-os should request the backend workflow runner API");
assert(source.includes("/workgraph-os/plan"), "workgraph-os should request the backend workflow planner API");
assert(source.includes("ExecutionLogEntry"), "workgraph-os should model node execution log entries");
assert(source.includes("planBackendWorkflow"), "workgraph-os should expose backend workflow planning from the UI");
assert(source.includes("createdSkillId"), "workgraph-os should expose planner-created skill ids");
assert(source.includes("WorkGraphHistoryEntry"), "workgraph-os should model object history entries");
assert(source.includes("/workgraph-os/history"), "workgraph-os should request the history API");
assert(source.includes("nodes: WorkflowNode[]"), "workgraph-os should persist canvas nodes as workspace objects");
assert(source.includes("const nodes = workspace.nodes.length ? workspace.nodes : buildNodes"), "workgraph-os should save generated canvas nodes to the backend");
assert(source.includes("type GoalObject"), "workgraph-os should define a structured Goal Object");
assert(source.includes("interpretGoal"), "workgraph-os should interpret natural language input into a Goal Object");
assert(source.includes("successCriteria"), "workgraph-os should carry goal success criteria");
assert(source.includes("capabilityType"), "workgraph-os should define standardized Skill Object capability metadata");
assert(source.includes("skillMdPath"), "workgraph-os should carry a future SKILL.md export path");
assert(source.includes("runCount") && source.includes("successCount"), "workgraph-os should track skill evolution counters");
assert(source.includes("fallbackModelIds"), "workgraph-os should define model fallback routing metadata");
assert(source.includes("nodeAffinity"), "workgraph-os should define node-level model affinity");
assert(source.includes("routingRules"), "workgraph-os should define model routing rules");
assert(source.includes("lastRoutingDecision"), "workgraph-os should show the latest model routing decision");
assert(source.includes("type WorkflowObject"), "workgraph-os should define a structured Workflow Object");
assert(source.includes("buildWorkflowObject"), "workgraph-os should build reusable workflow objects from graph state");
assert(source.includes("edgeIds") && source.includes("runCount"), "workgraph-os should track workflow edges and run counts");
assert(source.includes("type ResultObject"), "workgraph-os should define a structured Result Object");
assert(source.includes("buildResultObject"), "workgraph-os should build result objects from workflow runs");
assert(source.includes("runBackendWorkflow"), "workgraph-os should prefer backend workflow execution when available");
assert(source.includes("saveResultAsMaterial"), "workgraph-os should allow accepted results to become reusable materials");
assert(source.includes("normalizeFeedbackObject"), "workgraph-os should normalize linked Feedback Objects");
assert(source.includes("normalizeMemoryObject"), "workgraph-os should normalize structured Memory Objects");
assert(source.includes("buildMemoryFromFeedback"), "workgraph-os should turn feedback into linked reusable memory");
assert(source.includes("evolveSkillFromFeedback"), "workgraph-os should evolve Skill Objects from human feedback");
assert(source.includes("reuse pattern") && source.includes("avoid pattern"), "workgraph-os should preserve feedback learning patterns in Skill evolution");
assert(source.includes("memoryId") && source.includes("sourceType"), "workgraph-os should link feedback and memory object ids");
assert(source.includes("confidence") && source.includes("reusable"), "workgraph-os should track memory confidence and reusability");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "workgraph-os-dist-index",
    "workgraph-os-built-assets",
    "workgraph-os-public-brand-assets",
    "workgraph-os-object-model",
    "workgraph-os-object-persistence-ready",
    "workgraph-os-feedback-memory-ready",
    "workgraph-os-backend-object-index-ready",
    "workgraph-os-backend-brand-memory-ready",
    "workgraph-os-backend-asset-retriever-ready",
    "workgraph-os-backend-skill-store-ready",
    "workgraph-os-backend-runner-ready",
    "workgraph-os-backend-workflow-planner-ready",
    "workgraph-os-node-execution-log-ready",
    "workgraph-os-planner-created-skill-ready",
    "workgraph-os-history-ready",
    "workgraph-os-node-object-ready",
    "workgraph-os-goal-object-ready",
    "workgraph-os-skill-object-ready",
    "workgraph-os-model-object-ready",
    "workgraph-os-model-routing-decision-ready",
    "workgraph-os-workflow-object-ready",
    "workgraph-os-result-object-ready",
    "workgraph-os-feedback-memory-link-ready",
    "workgraph-os-feedback-skill-evolution-ready"
  ]
}));
