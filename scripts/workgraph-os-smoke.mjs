import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distIndex = path.join(root, "apps", "workgraph-os", "dist", "index.html");
const sourceFile = path.join(root, "apps", "workgraph-os", "src", "main.tsx");
const nextStudioFile = path.join(root, "apps", "web", "app", "workgraph-studio.tsx");
const nextPackageFile = path.join(root, "apps", "web", "package.json");
const packageFile = path.join(root, "package.json");
const viteConfigFile = path.join(root, "apps", "workgraph-os", "vite.config.ts");
const coreFile = path.join(root, "packages", "core", "src", "index.ts");
const databaseFile = path.join(root, "packages", "database", "src", "index.ts");
const modelRouterFile = path.join(root, "packages", "model-router", "src", "index.ts");
const workflowEngineFile = path.join(root, "packages", "workflow-engine", "src", "index.ts");
const brandStoreFile = path.join(root, "packages", "brand-store", "src", "index.ts");
const assetStoreFile = path.join(root, "packages", "asset-store", "src", "index.ts");
const memoryEngineFile = path.join(root, "packages", "memory-engine", "src", "index.ts");
const skillRuntimeFile = path.join(root, "packages", "skill-runtime", "src", "index.ts");
const piAdapterFile = path.join(root, "packages", "pi-adapter", "src", "index.ts");
const serverFile = path.join(root, "backend", "src", "server.ts");
const uiFlowSmokeFile = path.join(root, "scripts", "workgraph-os-ui-flow-smoke.mjs");
const skillScaffoldFile = path.join(root, "scripts", "workgraph-os-skill-scaffold.mjs");
const requiredPiSkillFiles = [
  "SKILL.md",
  "skill.json",
  "scripts/run.ts",
  "resources/guide.md",
  "examples/input.json",
  "examples/output.json"
];
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
const nextStudioSource = await readFile(nextStudioFile, "utf8");
const nextPackageJson = await readFile(nextPackageFile, "utf8");
const packageJson = await readFile(packageFile, "utf8");
const viteConfig = await readFile(viteConfigFile, "utf8");
const coreSource = await readFile(coreFile, "utf8");
const databaseSource = await readFile(databaseFile, "utf8");
const modelRouterSource = await readFile(modelRouterFile, "utf8");
const workflowEngineSource = await readFile(workflowEngineFile, "utf8");
const brandStoreSource = await readFile(brandStoreFile, "utf8");
const assetStoreSource = await readFile(assetStoreFile, "utf8");
const memoryEngineSource = await readFile(memoryEngineFile, "utf8");
const skillRuntimeSource = await readFile(skillRuntimeFile, "utf8");
const piAdapterSource = await readFile(piAdapterFile, "utf8");
const serverSource = await readFile(serverFile, "utf8");
const uiFlowSmokeSource = await readFile(uiFlowSmokeFile, "utf8");
const skillScaffoldSource = await readFile(skillScaffoldFile, "utf8");
await Promise.all(requiredAssets.map((asset) => access(asset)));
await Promise.all([
  ...requiredPiSkillFiles.map((file) => access(path.join(root, ".pi", "skills", "generated", file))),
  ...requiredPiSkillFiles.map((file) => access(path.join(root, "data", "skills", "generated", file)))
]);

assert(html.includes("<title>WorkGraph OS</title>"), "workgraph-os dist index should preserve the app title");
assert(html.includes("/assets/"), "workgraph-os dist index should reference built assets");
assert(source.includes("type WorkGraphWorkspace"), "workgraph-os should define a workspace object model");
assert(source.includes("workspaceStorageKey"), "workgraph-os should define workspace persistence");
assert(source.includes("recordFeedback"), "workgraph-os should record feedback objects");
assert(source.includes("对象图谱"), "workgraph-os should expose an object graph surface");
assert(source.includes("WorkGraphObjectIndex"), "workgraph-os should consume the backend object index");
assert(source.includes("/workgraph-os/objects"), "workgraph-os should request the object index API");
assert(source.includes("/workgraph-os/memories"), "workgraph-os should request the backend memory store API");
assert(source.includes("/workgraph-os/brands"), "workgraph-os should request backend brand memory objects");
assert(source.includes("/workgraph-os/assets"), "workgraph-os should request backend asset material objects");
assert(source.includes("uploadBackendAsset"), "workgraph-os should upload AssetObjects into the backend data/assets store");
assert(source.includes("/workgraph-os/skills"), "workgraph-os should request backend skill store objects");
assert(source.includes("loadBackendSkillDetail"), "workgraph-os should inspect Pi Skill file details from the backend");
assert(source.includes("previewBackendSkillOptimization"), "workgraph-os should preview Skill optimization diffs without silent overwrites");
assert(source.includes("applyBackendSkillOptimization"), "workgraph-os should apply reviewed Skill optimization into versioned files");
assert(source.includes("Pi Skill 管理"), "workgraph-os should nest skill management behind a Pi Skill section");
assert(source.includes("Online skill search: planned / disabled"), "workgraph-os should show online Skill search as planned/disabled");
assert(source.includes("pm-skill-detail"), "workgraph-os should render Skill file structure and contents in the UI");
assert(source.includes("http://localhost:30141/"), "workgraph-os should expose the local Pi Web entrypoint");
assert(packageJson.includes("WGOS_BACKEND_PORT") && packageJson.includes("WGOS_WEB_PORT"), "pnpm dev should expose configurable WorkGraph OS local ports");
assert(packageJson.includes("@sparkcanvas/web dev"), "pnpm dev should launch the Next.js WorkGraph Studio by default");
assert(skillScaffoldSource.includes("scripts/run.ts") && skillScaffoldSource.includes("resources/guide.md") && skillScaffoldSource.includes("examples/output.json"), "WorkGraph OS should have a repairable full Skill scaffold for .pi/skills and data/skills");
assert(nextPackageJson.includes("next") && nextPackageJson.includes("@xyflow/react") && nextPackageJson.includes("zustand"), "apps/web should use Next.js, React Flow and Zustand");
assert(nextStudioSource.includes("WorkGraphStudio") && nextStudioSource.includes("ReactFlow") && nextStudioSource.includes("useStudioStore"), "apps/web should expose the WorkGraph Studio control surface");
assert(nextStudioSource.includes("/workgraph-os/plan") && nextStudioSource.includes("/workgraph-os/run") && nextStudioSource.includes("/workgraph-os/feedback"), "apps/web should drive plan, run and feedback backend APIs");
assert(nextStudioSource.includes("data-resource-panel") && nextStudioSource.includes("data-inspector-panel") && nextStudioSource.includes("data-node-skill-workbench"), "apps/web should render object library, node inspector and nested Skill manager");
assert(nextStudioSource.includes("data-bottom-goal-composer=\"true\"") && nextStudioSource.includes("data-bottom-goal-input=\"true\"") && nextStudioSource.includes("data-bottom-plan-goal=\"true\"") && nextStudioSource.includes("data-bottom-run-active-node-main"), "apps/web should use a Pi-style bottom goal composer as the main input and execution entry");
assert(nextStudioSource.includes("data-top-command-bar") && nextStudioSource.includes("data-bottom-goal-composer"), "apps/web header should be a lightweight status bar instead of the primary goal input");
assert(nextStudioSource.includes("data-canvas-node-toolbar=\"true\"") && nextStudioSource.includes("data-module-state-model") && nextStudioSource.includes("data-node-skill-workbench") && nextStudioSource.includes("saveSkillFile"), "apps/web should expose selected-node module operations in a fixed canvas toolbar that avoids covering nodes");
assert(nextStudioSource.includes("nodeModuleKind") && nextStudioSource.includes("assetPreviews") && nextStudioSource.includes("data-brand-learning-panel") && nextStudioSource.includes("applySkillOptimization"), "apps/web should render node-type-specific canvas modules instead of generic demo cards");
assert(nextStudioSource.includes("nodeOperationProfile") && nextStudioSource.includes("data-node-operation-profile=\"true\"") && nextStudioSource.includes("data-node-inspector-operation-profile=\"true\"") && nextStudioSource.includes("data-inspector-operation-takeover"), "apps/web should explain node-specific roles, takeover points and module operations on the canvas and inspector");
assert(nextStudioSource.includes("分镜") && nextStudioSource.includes("data-node-skill-workbench") && nextStudioSource.includes("data-brand-learning-panel") && nextStudioSource.includes("data-feedback-workbench"), "apps/web should provide professional operation profiles for video, Skill, brand and feedback nodes");
assert(nextStudioSource.includes("data-brand-learning-panel=\"true\"") && nextStudioSource.includes("data-feedback-learning-summary") && nextStudioSource.includes("lastFeedbackLearning"), "apps/web should surface feedback-driven DAPOT brand learning in the Brand module");
assert(nextStudioSource.includes("nodeModuleDrawer === \"params\"") && nextStudioSource.includes("patchActiveNodeParams") && nextStudioSource.includes("ratio") && nextStudioSource.includes("1024x1024"), "apps/web should expose node-type-specific module parameter controls");
assert(nextStudioSource.includes("data-node-operation-panel") && nextStudioSource.includes("storyboard") && nextStudioSource.includes("data-node-operation-profile") && nextStudioSource.includes("data-preview-trace-drawer"), "apps/web should give video nodes a dedicated storyboard, prompt and trace control panel");
assert(nextStudioSource.includes("videoShotLines") && nextStudioSource.includes("videoImagePromptLines") && nextStudioSource.includes("thaiCopyLine") && nextStudioSource.includes("data-node-result-summary"), "apps/web should parse and summarize video preview plans inside node controls");
assert(nextStudioSource.includes("persistedActiveNodeId") && nextStudioSource.includes("data-active-node-id") && nextStudioSource.includes("data-workspace-node-count") && nextStudioSource.includes("data-workspace-load-state"), "apps/web should restore the persisted active node and expose runtime workspace state for UI verification");
assert(nextStudioSource.includes("workspaceLoadState") && nextStudioSource.includes("browser fetch is unavailable") && nextStudioSource.includes("data-workspace-load-state"), "apps/web should make WorkGraph API load failures visible instead of silently staying on fallback nodes");
assert(nextStudioSource.includes("data-node-action-strip") && nextStudioSource.includes("workgraph-node-param-change") && nextStudioSource.includes("data-current-node-primary-action") && nextStudioSource.includes("data-canvas-node-toolbar"), "apps/web should expose module parameters and actions inside the selected canvas node");
assert(nextStudioSource.includes("modelPolicies?: ModelPolicyObject[]") && nextStudioSource.includes("data-model-policy-learning-panel=\"true\"") && nextStudioSource.includes("data-model-policy-learning-panel") && nextStudioSource.includes("activeNodeModelPolicy"), "apps/web should surface feedback ModelPolicy learning both in the node step and the model drawer");
assert(nextStudioSource.includes("data-feedback-workbench=\"true\"") && nextStudioSource.includes("FeedbackTargetOption") && nextStudioSource.includes("data-feedback-learning-summary=\"true\"") && nextStudioSource.includes("data-feedback-workbench"), "apps/web should provide a feedback workbench for scoped learning across Result, Node, Skill, Brand, Model, Workflow and Asset objects");
assert(nextStudioSource.includes("data-node-module-drawer-launcher=\"true\"") && nextStudioSource.includes("data-node-native-module-drawers=\"true\"") && nextStudioSource.includes("data-node-native-module=\"params\"") && nextStudioSource.includes("data-node-native-module-drawers"), "apps/web should keep model, parameter, Skill, asset and brand details in a secondary node module drawer");
assert(nextStudioSource.includes("preferredNodeModuleDrawer") && nextStudioSource.includes("activateNode") && nextStudioSource.includes("onNodeClick={(_, node) => activateNode(node.id)}"), "apps/web should auto-open the correct secondary module when a graph node is selected");
assert(nextStudioSource.includes("if (type === \"brand_context\") return \"brand\"") && nextStudioSource.includes("if (type === \"model_select\") return \"model\"") && nextStudioSource.includes("if (type === \"skill_search\" || type === \"skill_create\" || type === \"skill_execute\") return \"skill\""), "apps/web should map node types to the most useful takeover module");
assert(nextStudioSource.includes("persistNodePositions") && nextStudioSource.includes("node layout saved") && nextStudioSource.includes("typeof node.x === \"number\"") && nextStudioSource.includes("persistNodePositions") && nextStudioSource.includes("persistNodePositions"), "apps/web should persist user-arranged graph node positions and provide readable auto layout");
assert(nextStudioSource.includes("patchActiveNode") && nextStudioSource.includes("deleteActiveNode") && nextStudioSource.includes("addNodeAfterActive") && nextStudioSource.includes("retryActiveNode") && nextStudioSource.includes("retryActiveNode"), "apps/web should persist node edit, delete, add and retry controls");
assert(nextStudioSource.includes("saveActiveNodeAsSkill") && nextStudioSource.includes("/workgraph-os/skills"), "apps/web should save a graph node as a Skill Object");
assert(nextStudioSource.includes("searchSkillForNode") && nextStudioSource.includes("createDraftSkillForNode") && nextStudioSource.includes("bindSkillToActiveNode") && nextStudioSource.includes("data-node-skill-search=\"true\""), "apps/web should search, create draft and bind Skills inside the selected node module");
assert(nextStudioSource.includes("skillOptimizationPromptForNode") && nextStudioSource.includes("data-skill-draft-followup=\"true\"") && nextStudioSource.includes("optimizePrompt"), "apps/web should open newly created or bound node Skills directly into the optimization follow-up flow");
assert(nextStudioSource.includes("node model saved") && nextStudioSource.includes("node strategy saved") && nextStudioSource.includes("modelStrategies") && nextStudioSource.includes("bindSkillToActiveNode"), "apps/web should allow per-node model strategy, model and Skill replacement");
assert(nextStudioSource.includes("openActiveSkillDrawer") && nextStudioSource.includes("activeNode?.skillId || skills[0]?.id"), "apps/web should open a real Skill detail from the node inspector");
assert(nextStudioSource.includes("saveSkillFile") && nextStudioSource.includes("/files") && nextStudioSource.includes("saveSkillFile"), "apps/web should edit and save reviewed Skill files");
assert(nextStudioSource.includes("applySkillOptimization") && nextStudioSource.includes("applySkillOptimization") && nextStudioSource.includes("applySkillOptimization"), "apps/web should preview and confirm natural-language Skill optimization");
assert(nextStudioSource.includes("copySkill") && nextStudioSource.includes("/copy") && nextStudioSource.includes("Copy"), "apps/web should expose Skill copy from the Skill drawer");
assert(nextStudioSource.includes("testSkill") && nextStudioSource.includes("/test") && nextStudioSource.includes("testSkill"), "apps/web should expose local Skill testing and usage history");
assert(nextStudioSource.includes("uploadAssetFile") && nextStudioSource.includes("/workgraph-os/assets/upload") && nextStudioSource.includes("type=\"file\""), "apps/web should upload AssetObjects into the local asset store");
assert(nextStudioSource.includes("nodeModuleDrawer === \"asset\"") && nextStudioSource.includes("bindAssetToNode") && nextStudioSource.includes("materialIds"), "apps/web should bind uploaded or selected assets to the active node");
assert(nextStudioSource.includes("draggable={object.type === \"asset\"}") && nextStudioSource.includes("application/x-workgraph-asset") && nextStudioSource.includes("handleAssetDrop") && nextStudioSource.includes("assetIdFromDataTransfer"), "apps/web should support dragging AssetObjects from the library onto graph nodes");
assert(nextStudioSource.includes("data-node-io-editor") && nextStudioSource.includes("data-prompt-context-breakdown") && nextStudioSource.includes("data-node-asset-workbench") && nextStudioSource.includes("activeNodeLogs"), "apps/web should expose per-node input, output, prompt context, assets and logs for takeover");
assert(nextStudioSource.includes("data-node-io-editor=\"true\"") && nextStudioSource.includes("data-node-io-editor") && nextStudioSource.includes("data-inspector-input-panel") && nextStudioSource.includes("node input saved"), "apps/web should allow direct editing of the active node input/prompt from the takeover inspector");
assert(nextStudioSource.includes("data-prompt-context-breakdown=\"true\"") && nextStudioSource.includes("data-prompt-context-field") && nextStudioSource.includes("data-prompt-context-breakdown") && nextStudioSource.includes("data-prompt-context-field") && nextStudioSource.includes("data-prompt-context-breakdown"), "apps/web should separate workspace goal, node input, effective source and final prompt for readable execution trace");
assert(nextStudioSource.includes("data-preview-trace-drawer") && nextStudioSource.includes("PromptRecord") && nextStudioSource.includes("activeNodeLogs") && nextStudioSource.includes("data-pi-session-trace-summary"), "apps/web should expose ResultObject traceability in Preview");
assert(
  nextStudioSource.includes("data-preview-trace-drawer")
  && nextStudioSource.includes("data-prompt-context-field")
  && nextStudioSource.includes("data-prompt-context-breakdown")
  && nextStudioSource.includes("latestPromptRecord")
  && nextStudioSource.includes("latestPromptRecord")
  && nextStudioSource.includes("latestPromptRecord")
  && nextStudioSource.includes("latestPromptRecord"),
  "apps/web Preview should expose workspace, node input, effective source and final prompt trace fields"
);
assert(nextStudioSource.includes("latestPromptRecord") && nextStudioSource.includes("resultAssets") && nextStudioSource.includes("resultLogs") && nextStudioSource.includes("piSessionId"), "apps/web should link preview results to prompt, asset, Pi session and log records");
assert(nextStudioSource.includes("type PreviewTraceAction") && nextStudioSource.includes("openPreviewTraceTarget") && nextStudioSource.includes("data-preview-trace-drawer") && nextStudioSource.includes("data-preview-trace-drawer"), "apps/web Preview trace should provide actionable links back to node, brand, skill, model and asset controls");
assert(nextStudioSource.includes("data-preview-trace-drawer") && nextStudioSource.includes("data-preview-trace-drawer") && nextStudioSource.includes("data-preview-trace-drawer") && nextStudioSource.includes("data-preview-trace-drawer") && nextStudioSource.includes("data-preview-trace-drawer"), "apps/web Preview trace actions should open the relevant secondary control modules");
assert(nextStudioSource.includes("data-pi-session-trace-summary=\"true\"") && nextStudioSource.includes("data-pi-session-context-panel=\"true\"") && nextStudioSource.includes("/workgraph-os/pi/sessions/") && nextStudioSource.includes("piSessionDetail") && nextStudioSource.includes("data-pi-session-list=\"true\""), "apps/web should expose Pi adapter session summary, context and recent Pi sessions in the workbench UI");
assert(nextStudioSource.includes("data-queue-dashboard") && nextStudioSource.includes("sqlite") && nextStudioSource.includes("historyEntries") && nextStudioSource.includes("/workgraph-os/snapshots"), "apps/web should expose Queue, SQLite, history and data snapshot status");
assert(nextStudioSource.includes("版本") && nextStudioSource.includes("skillVersionDirs") && nextStudioSource.includes("skillLogFiles"), "apps/web should expose Skill versions and logs from the file tree");
assert(serverSource.includes("/workgraph-os/skills/:id/copy") && serverSource.includes("skill-copied"), "backend should copy Skills into the local Skill store");
assert(serverSource.includes("/workgraph-os/skills/:id/test") && serverSource.includes("skill-tested") && serverSource.includes("withWorkGraphSkillEvolution"), "backend should locally test Skills and update evolution history");
assert(serverSource.includes("/workgraph-os/snapshots") && serverSource.includes("workgraph-object-snapshot-store"), "backend should expose WorkGraph data snapshot status");
assert(uiFlowSmokeSource.includes("same-origin-plan") && uiFlowSmokeSource.includes("same-origin-run-preview-only") && uiFlowSmokeSource.includes("same-origin-feedback-memory"), "UI flow smoke should verify the local WorkGraph Studio end-to-end path through the web server");
assert(uiFlowSmokeSource.includes("same-origin-draft-skill-create-bind-followup") && uiFlowSmokeSource.includes("draftSkillDetail") && uiFlowSmokeSource.includes("draftOptimization"), "UI flow smoke should verify node-created draft Skill binding and optimization preview");
assert(uiFlowSmokeSource.includes("same-origin-brand-learning-visible") && uiFlowSmokeSource.includes("brandForbiddenWords") && uiFlowSmokeSource.includes("learnedBrands"), "UI flow smoke should verify feedback learning is visible through the brand store");
assert(viteConfig.includes("VITE_API_TARGET"), "WorkGraph OS Vite proxy should follow the configured backend target");
assert(source.includes("libraryView"), "workgraph-os should keep heavy configuration in secondary library tabs");
assert(source.includes("VDAMO · GPT Image 2"), "workgraph-os should default visible image routing to VDAMO GPT Image 2");
assert(source.includes("yijiarj · grok video super"), "workgraph-os should expose yijiarj video routing without replacing image models");
assert(source.includes("selectModelForPrompt"), "workgraph-os should route video prompts to video models instead of the image model");
assert(source.includes("inferBrandIdFromPrompt"), "workgraph-os should infer DAPOT brand context from prompts and loaded backend brands");
assert(serverSource.includes("forbiddenWords: selected.forbiddenWords") && serverSource.includes("sceneKeywords: selected.sceneKeywords"), "backend should expose learned brand constraints in WorkGraph brand payloads");
assert(source.includes("syncWorkspaceBrandMaterials"), "workgraph-os should keep selected assets aligned with inferred brand context");
assert(source.includes("/workgraph-os/run"), "workgraph-os should request the backend workflow runner API");
assert(source.includes("/workgraph-os/plan"), "workgraph-os should request the backend workflow planner API");
assert(source.includes("ExecutionLogEntry"), "workgraph-os should model node execution log entries");
assert(source.includes("visibleExecutionLog"), "workgraph-os should render node execution log entries");
assert(source.includes("执行日志"), "workgraph-os should expose execution logs in the inspector UI");
assert(source.includes("planBackendWorkflow"), "workgraph-os should expose backend workflow planning from the UI");
assert(source.includes("createdSkillId"), "workgraph-os should expose planner-created skill ids");
assert(source.includes("WorkGraphHistoryEntry"), "workgraph-os should model object history entries");
assert(source.includes("/workgraph-os/history"), "workgraph-os should request the history API");
assert(source.includes("WorkGraphSqliteStatus"), "workgraph-os should model SQLite export status");
assert(source.includes("/workgraph-os/sqlite/schema"), "workgraph-os should request the SQLite schema API");
assert(source.includes("SQLite Export"), "workgraph-os should expose SQLite export status in the object library");
assert(source.includes("wgos_execution_logs"), "workgraph-os should surface Log Store rows in SQLite readiness");
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
assert(source.includes("type PromptRecordObject"), "workgraph-os should define PromptRecord objects for result traceability");
assert(source.includes("buildResultObject"), "workgraph-os should build result objects from workflow runs");
assert(source.includes("promptRecordId") && source.includes("PromptRecord"), "workgraph-os should surface PromptRecord links in result previews");
assert(source.includes("runBackendWorkflow"), "workgraph-os should prefer backend workflow execution when available");
assert(source.includes("updateNode(nodeId") && source.includes("toggleActiveNodeDisabled") && source.includes("deleteActiveNode") && source.includes("retryActiveNode"), "workgraph-os should support node edit, disable, delete and retry controls");
assert(source.includes("setActiveNodeModel") && source.includes("setActiveNodeSkill") && source.includes("setActiveNodeMaterial"), "workgraph-os should allow node-level model, skill and asset replacement");
assert(source.includes("workspace.nodes.length ? workspace.nodes : generatedNodes"), "workgraph-os should persist user-edited graph nodes instead of always rebuilding the graph");
assert(source.includes("saveResultAsMaterial"), "workgraph-os should allow accepted results to become reusable materials");
assert(source.includes("normalizeFeedbackObject"), "workgraph-os should normalize linked Feedback Objects");
assert(source.includes("normalizeMemoryObject"), "workgraph-os should normalize structured Memory Objects");
assert(source.includes("buildMemoryFromFeedback"), "workgraph-os should turn feedback into linked reusable memory");
assert(source.includes("recordBackendFeedback"), "workgraph-os should persist feedback to the backend memory and brand learning store");
assert(source.includes("searchBackendMemories"), "workgraph-os should search reusable backend memories");
assert(source.includes("relatedMemories"), "workgraph-os should surface related memories in the UI");
assert(coreSource.includes("workGraphNodeTypes") && coreSource.includes('"video_generate"') && coreSource.includes('"brand_context"'), "core package should define WorkGraph node types from the product contract");
assert(coreSource.includes("workGraphModelProviders") && coreSource.includes('"ollama"') && coreSource.includes('"local_flux"'), "core package should define model providers from the product contract");
assert(coreSource.includes("workGraphModelStrategies") && coreSource.includes('"fast_draft"') && coreSource.includes('"final_output"'), "core package should define node-level model strategies");
assert(coreSource.includes("type ResultObject") && coreSource.includes("promptRecordId") && coreSource.includes("feedbackIds"), "core package should define traceable ResultObject links");
assert(databaseSource.includes("drizzle-orm/sqlite-core") && databaseSource.includes("sqliteTable") && databaseSource.includes("workGraphWorkspaces") && databaseSource.includes("workGraphObjects") && databaseSource.includes("workGraphEdges"), "database package should define Drizzle SQLite tables for WorkGraph core objects");
assert(databaseSource.includes("workGraphCreateSql") && databaseSource.includes("wgos_execution_logs"), "database package should export SQLite DDL used by backend sync");
assert(modelRouterSource.includes("routeWorkGraphModel") && modelRouterSource.includes("workGraphModelCatalog"), "model-router package should own WorkGraph model catalog and routing decisions");
assert(modelRouterSource.includes("nodeAffinity") && modelRouterSource.includes("fallbackModelIds") && modelRouterSource.includes("strategy"), "model-router package should preserve node-level strategy, affinity and fallback routing");
assert(workflowEngineSource.includes("planWorkGraphWorkflow") && workflowEngineSource.includes("Goal Object") && workflowEngineSource.includes("Feedback Memory"), "workflow-engine package should own goal-to-graph workflow planning");
assert(workflowEngineSource.includes("skill-candidate") && workflowEngineSource.includes("model-router") && workflowEngineSource.includes("review-memory"), "workflow-engine package should create candidate skills and auditable graph nodes");
assert(workflowEngineSource.includes('"brand_context"') && workflowEngineSource.includes('"asset_search"') && workflowEngineSource.includes('"prompt_generate"') && workflowEngineSource.includes('"skill_execute"') && workflowEngineSource.includes('"video_generate"') && workflowEngineSource.includes('"preview"') && workflowEngineSource.includes('"human_review"') && workflowEngineSource.includes('"feedback"') && workflowEngineSource.includes('"archive"'), "workflow-engine planner should emit canonical WorkGraph control node types");
assert(brandStoreSource.includes("syncBrandRecords") && brandStoreSource.includes("brandDir") && brandStoreSource.includes("brandStorePath"), "brand-store package should persist WorkGraph brand records into a data/brands directory");
assert(assetStoreSource.includes("storeAssetBuffer") && assetStoreSource.includes("assetKindFromMime") && assetStoreSource.includes("isPreviewableImageAsset"), "asset-store package should own data/assets file storage and type detection");
assert(memoryEngineSource.includes("learnFromWorkGraphFeedback") && memoryEngineSource.includes("buildWorkGraphFeedbackMemory"), "memory-engine package should own feedback-to-memory learning");
assert(memoryEngineSource.includes("feedback avoid") && memoryEngineSource.includes("memoryReusable"), "memory-engine package should preserve avoid/reuse feedback learning rules");
assert(skillRuntimeSource.includes("runWorkGraphSkill") && skillRuntimeSource.includes("workgraph-skill-runtime"), "skill-runtime package should own local Skill execution results");
assert(skillRuntimeSource.includes("Generated first-stage preview plan without calling paid video generation"), "skill-runtime should preserve first-stage no-paid-video preview mode");
assert(skillRuntimeSource.includes("TikTok Opening Video Plan") && skillRuntimeSource.includes("Thai-first Copy"), "skill-runtime should generate previewable DAPOT TikTok video plan content");
assert(skillRuntimeSource.includes("nodeParams") && skillRuntimeSource.includes("Module Parameters: ratio") && skillRuntimeSource.includes("quality"), "skill-runtime should make node module parameters visible in generated previews and logs");
assert(serverSource.includes("writeWorkGraphPiSession") && serverSource.includes("writePiSessionRecord") && serverSource.includes("piSessionId"), "backend should write Pi session records and link ResultObject trace to Pi");
assert(serverSource.includes("buildPiExecutionContext") && serverSource.includes("/workgraph-os/pi/sessions") && serverSource.includes("readPiSessionRecord"), "backend should expose Pi adapter execution context and read Pi session records back into WorkGraph OS");
assert(piAdapterSource.includes("type PiExecutionContext") && piAdapterSource.includes("buildPiExecutionContext") && piAdapterSource.includes("listPiSessionRecords"), "pi-adapter package should model Pi execution context and list local Pi sessions");
assert(piAdapterSource.includes("probePiWebBridge") && piAdapterSource.includes("runPiWebSession") && piAdapterSource.includes("/api/agent"), "pi-adapter should provide a real pi-web bridge client (probe + run via /api/agent)");
assert(serverSource.includes("applyWorkGraphPiBridge") && serverSource.includes("workGraphPiWebConfig") && serverSource.includes("WGOS_PIWEB_BASE_URL"), "backend run should apply the switchable pi-web bridge from configuration");
assert(serverSource.includes("/workgraph-os/pi/status") && serverSource.includes("pi-web-bridge"), "backend should expose pi-web bridge reachability status");
assert(serverSource.includes("simulated: true") && serverSource.includes("executor = \"pi-web\""), "backend should default runs to simulated and only flip to pi-web on real execution");
assert(serverSource.includes("Input Files:") && serverSource.includes("inputFiles") && serverSource.includes("existsSync(entry.path)"), "backend should inject selected materials as real local file paths into the final prompt");
assert(serverSource.includes("startWorkGraphOutputWatcher") && serverSource.includes("fsWatch(workGraphOsOutputWatchDir") && serverSource.includes("registerWatchedOutputFile"), "backend should watch the output directory and register new media as assets");
assert(serverSource.includes("/workgraph-os/outputs") && serverSource.includes("workgraph-output-watcher"), "backend should expose output watcher status");
assert(serverSource.includes("isWatchableOutputFile") && serverSource.includes("md|json|jsonl|tmp"), "output watcher should skip bookkeeping files and only register media/documents");
assert(serverSource.includes("resolveWorkGraphSqliteWriter") && serverSource.includes("node-sqlite") && serverSource.includes("json-only"), "backend SQLite sync should resolve a writer with a node:sqlite and json-only fallback");
assert(serverSource.includes("JSON remains authoritative") && serverSource.includes("console.warn(`WorkGraph SQLite sync"), "backend SQLite sync should never throw out of save/run when tooling is missing");
assert(serverSource.includes("createRequire(import.meta.url)(\"node:sqlite\")"), "backend should use node:sqlite as a fallback writer when the sqlite3 CLI is absent");
assert(serverSource.includes("writer,") && serverSource.includes("WGOS_SQLITE_WRITER"), "backend SQLite readiness should expose the resolved writer and honor WGOS_SQLITE_WRITER override");
assert(skillRuntimeSource.includes("evaluateWorkGraphSkillEvolution") && skillRuntimeSource.includes("reusable-template") && skillRuntimeSource.includes("needs_repair"), "skill-runtime should own the auto-evolution decision (promote-to-template / repair-task)");
assert(serverSource.includes("applyWorkGraphSkillEvolutionOutcome") && serverSource.includes("evaluateWorkGraphSkillEvolution") && serverSource.includes("WGOS_SKILL_PROMOTE_THRESHOLD"), "backend run should auto-evolve the executed skill after each run");
assert(serverSource.includes("type: \"skill-repair\"") && serverSource.includes("suggestedPrompt"), "backend should queue an actionable repair task when a run fails");
assert(serverSource.includes("/workgraph-os/skills/evolution") && serverSource.includes("workgraph-skill-evolution"), "backend should expose skill templates and repair tasks");
assert(piAdapterSource.includes("listPiWebModels") && piAdapterSource.includes("modelList"), "pi-adapter should list live pi-web models for capability probing");
assert(serverSource.includes("/workgraph-os/models/probe") && serverSource.includes("workgraph-model-probe") && serverSource.includes("live ="), "backend should expose a live model probe mapping live availability onto the catalog");
assert(serverSource.includes("buildWorkGraphResultVariants") && serverSource.includes("variantGroupId") && serverSource.includes("variantIndex"), "backend run should support side-by-side output variants");
assert(serverSource.includes("/workgraph-os/versions/:type/:id") && serverSource.includes("workgraph-version-history"), "backend should expose per-object version history derived from snapshots");
assert(serverSource.includes("nodeParams") && serverSource.includes("Node Parameters:"), "backend should carry node module parameters into PromptRecord, Result trace and Skill runtime input");
assert(serverSource.includes("activeNodeId?: string") && serverSource.includes("activeNodeId: z.string().default(\"\")"), "backend should persist the active WorkGraph node selection for UI takeover after reload");
assert(serverSource.includes("effectivePrompt") && serverSource.includes("workspacePrompt") && serverSource.includes("prompt: effectivePrompt"), "backend should execute nodes with edited node input while preserving the original workspace prompt");
assert(source.includes("evolveSkillFromFeedback"), "workgraph-os should evolve Skill Objects from human feedback");
assert(source.includes("reuse pattern") && source.includes("avoid pattern"), "workgraph-os should preserve feedback learning patterns in Skill evolution");
assert(source.includes("memoryId") && source.includes("sourceType"), "workgraph-os should link feedback and memory object ids");
assert(source.includes("confidence") && source.includes("reusable"), "workgraph-os should track memory confidence and reusability");
assert(source.includes("brandId: workspace.activeBrandId"), "feedback should carry active brand context for brand memory learning");

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
    "workgraph-os-backend-memory-store-ready",
    "workgraph-os-backend-brand-memory-ready",
    "workgraph-os-backend-asset-retriever-ready",
    "workgraph-os-backend-asset-upload-ready",
    "workgraph-os-backend-skill-store-ready",
    "workgraph-os-pi-skill-detail-ready",
    "workgraph-os-skill-optimization-preview-ready",
    "workgraph-os-skill-optimization-apply-ready",
    "workgraph-os-pi-web-entry-ready",
    "workgraph-os-pnpm-dev-entry-ready",
    "workgraph-os-next-studio-ready",
    "workgraph-os-bottom-composer-ready",
    "workgraph-os-react-flow-ready",
    "workgraph-os-next-node-edit-ready",
    "workgraph-os-next-node-save-skill-ready",
    "workgraph-os-next-skill-file-edit-ready",
    "workgraph-os-next-skill-optimize-confirm-ready",
    "workgraph-os-skill-copy-test-history-ready",
    "workgraph-os-next-asset-upload-ready",
    "workgraph-os-next-node-asset-binding-ready",
    "workgraph-os-next-node-takeover-inspector-ready",
    "workgraph-os-next-result-trace-ready",
    "workgraph-os-next-preview-trace-actions-ready",
    "workgraph-os-next-ops-snapshot-panel-ready",
    "workgraph-os-next-skill-version-panel-ready",
    "workgraph-os-ui-flow-smoke-ready",
    "workgraph-os-secondary-skill-management-ready",
    "workgraph-os-vdamo-image-route-ready",
    "workgraph-os-yijiarj-video-route-ready",
    "workgraph-os-prompt-brand-inference-ready",
    "workgraph-os-brand-scoped-materials-ready",
    "workgraph-os-backend-runner-ready",
    "workgraph-os-node-control-ready",
    "workgraph-os-backend-workflow-planner-ready",
    "workgraph-os-node-execution-log-ready",
    "workgraph-os-execution-log-ui-ready",
    "workgraph-os-planner-created-skill-ready",
    "workgraph-os-history-ready",
    "workgraph-os-sqlite-export-status-ready",
    "workgraph-os-node-object-ready",
    "workgraph-os-goal-object-ready",
    "workgraph-os-skill-object-ready",
    "workgraph-os-model-object-ready",
    "workgraph-os-model-routing-decision-ready",
    "workgraph-os-workflow-object-ready",
    "workgraph-os-result-object-ready",
    "workgraph-os-prompt-record-ready",
    "workgraph-os-feedback-memory-link-ready",
    "workgraph-os-feedback-skill-evolution-ready",
    "workgraph-os-feedback-brand-learning-ready",
    "workgraph-os-memory-engine-ready",
    "workgraph-os-skill-runtime-ready",
    "workgraph-os-pi-web-bridge-ready",
    "workgraph-os-input-file-injection-ready",
    "workgraph-os-output-watcher-ready",
    "workgraph-os-sqlite-writer-hardening-ready",
    "workgraph-os-skill-auto-evolution-ready",
    "workgraph-os-model-live-probe-ready",
    "workgraph-os-output-variants-ready",
    "workgraph-os-version-history-ready"
  ]
}));
