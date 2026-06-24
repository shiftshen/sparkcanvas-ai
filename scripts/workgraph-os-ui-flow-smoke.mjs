const webBaseUrl = process.env.WGOS_WEB_URL ?? "http://localhost:3203";
const prompt = "给 DAPOT 做一条泰国年轻女性喜欢的新店开业 TikTok 视频";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${webBaseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

const html = await request("/");
assert(String(html).includes("工作图谱"), "UI smoke should load the WorkGraph Studio (工作图谱) page through the local web server");

const initialWorkspace = await request("/workgraph-os/workspace", {
  method: "PUT",
  body: JSON.stringify({
    version: 1,
    id: "workspace-local",
    prompt,
    activeBrandId: "brand-dapot",
    activeModelId: "vdamo-gpt-image-2",
    selectedIds: [],
    activeMaterialId: "",
    activeSkillId: "",
    activeNodeId: "",
    materials: [],
    skills: [],
    models: [],
    nodes: [],
    edges: [],
    jobs: [],
    results: [],
    feedback: [],
    memories: [],
    executionLog: [],
    promptRecords: [],
    updatedAt: new Date().toISOString()
  })
});
assert(initialWorkspace.workspace?.prompt === prompt, "UI smoke should save the workspace through the web same-origin API");

const plan = await request("/workgraph-os/plan", {
  method: "POST",
  body: JSON.stringify({ prompt, brandId: "brand-dapot" })
});
assert(plan.workspace?.activeBrandId === "brand_dapot", "UI smoke should infer and persist DAPOT brand context");
assert(plan.workspace?.nodes?.some((node) => node.id === "workflow-runner" && node.type === "skill_execute"), "UI smoke should generate the executable workflow node");
assert(plan.workspace?.materials?.some((asset) => String(asset.token).includes("$dapot")), "UI smoke should search DAPOT assets");

const workflowRunner = plan.workspace.nodes.find((node) => node.id === "workflow-runner");
assert(workflowRunner, "UI smoke should have a workflow-runner node for Skill takeover");
const draftSkill = await request("/workgraph-os/skills", {
  method: "POST",
  body: JSON.stringify({
    title: `${workflowRunner.title} Draft Skill`,
    command: `/ui-flow-${workflowRunner.type}-${Date.now().toString(36)}`.replace(/[^a-z0-9/_-]+/gi, "-").toLowerCase(),
    output: "Video Plan",
    description: [
      "Draft Skill created from the selected WorkGraph node.",
      `Node: ${workflowRunner.title}`,
      `Goal: ${prompt}`,
      workflowRunner.body ? `Node prompt: ${workflowRunner.body}` : ""
    ].filter(Boolean).join("\n"),
    keywords: [workflowRunner.type, "draft", "node-created", "dapot", "workgraph-os"],
    capabilityType: "video_planning"
  })
});
assert(draftSkill.skill?.id, "UI smoke should create a draft Skill from the selected node");
const workspaceWithDraftSkill = await request("/workgraph-os/workspace", {
  method: "PUT",
  body: JSON.stringify({
    ...draftSkill.workspace,
    nodes: draftSkill.workspace.nodes.map((node) => node.id === "workflow-runner" ? { ...node, skillId: draftSkill.skill.id } : node),
    activeNodeId: "workflow-runner",
    activeSkillId: draftSkill.skill.id,
    updatedAt: new Date().toISOString()
  })
});
assert(workspaceWithDraftSkill.workspace?.nodes?.some((node) => node.id === "workflow-runner" && node.skillId === draftSkill.skill.id), "UI smoke should bind the draft Skill back to the active node");
const draftSkillDetail = await request(`/workgraph-os/skills/${draftSkill.skill.id}`);
assert(draftSkillDetail.files?.some((file) => file.path === "SKILL.md"), "UI smoke should open the draft Skill files after creation");
assert(draftSkillDetail.tree?.some((item) => item.path === "versions") && draftSkillDetail.tree?.some((item) => item.path === "logs"), "UI smoke draft Skill should expose versions and logs folders");
const draftOptimizationPrompt = [
  `优化 ${draftSkill.skill.title} Skill，使它更适合 DAPOT 新店开业 TikTok 视频。`,
  "要求：泰语优先、少文字、年轻女性喜欢、干净可信、温暖、好复制、适合拍照传播。",
  "避免：廉价感、拼接感、文字太多、不落地、过度复杂、低质卡通、杂乱背景。"
].join("\n");
const draftOptimization = await request(`/workgraph-os/skills/${draftSkill.skill.id}/optimize`, {
  method: "POST",
  body: JSON.stringify({ prompt: draftOptimizationPrompt, files: ["SKILL.md"] })
});
assert(draftOptimization.status === "preview" && draftOptimization.writesFiles === false && String(draftOptimization.diffPreview).includes("Proposed Optimization"), "UI smoke should preview draft Skill optimization before writing files");

const run = await request("/workgraph-os/run", {
  method: "POST",
  body: JSON.stringify({ nodeId: "workflow-runner", prompt, bridge: "off" })
});
assert(run.execution?.executor === "workgraph-skill-runtime", "UI smoke should run through local Skill runtime");
assert(run.executionLog?.some((entry) => entry.payload?.previewOnly === true), "UI smoke must remain preview-only and avoid paid yijia calls");
assert(String(run.result?.output).includes("TikTok Opening Video Plan"), "UI smoke should produce a previewable video plan");
assert(String(run.result?.output).includes("执行 /ui-flow-skill_execute-mpqpjzsz"), "UI smoke should run with the edited node input instead of only the global workspace prompt");
assert(String(run.promptRecord?.sourcePrompt).includes("执行 /ui-flow-skill_execute-mpqpjzsz") && run.promptRecord?.workspacePrompt === prompt, "UI smoke PromptRecord should keep both effective node prompt and original workspace prompt");
assert(run.result?.trace?.piSessionId, "UI smoke result should trace Pi session");
const piSessions = await request("/workgraph-os/pi/sessions?limit=5");
assert(piSessions.source === "pi-adapter" && piSessions.sessions?.some((session) => session.id === run.result.trace.piSessionId), "UI smoke should read Pi session list back through the Pi adapter API");
const piSessionDetail = await request(`/workgraph-os/pi/sessions/${encodeURIComponent(run.result.trace.piSessionId)}`);
assert(piSessionDetail.session?.input?.piContext?.source === "pi-adapter", "UI smoke Pi session detail should include the Pi adapter execution context");
assert(piSessionDetail.session?.resultId === run.execution.resultId && piSessionDetail.session?.promptRecordId === run.promptRecord.id, "UI smoke Pi session detail should link result and PromptRecord");

// pi-web bridge: the run forced bridge:"off", so it must honestly report a simulated, no-cost run.
assert(run.bridge?.simulated === true && run.bridge?.outcome === "simulated", "UI smoke run with bridge:off should mark execution simulated");
assert(run.execution?.simulated === true, "UI smoke execution object should carry the simulated flag");
assert(run.executionLog?.some((entry) => entry.step === "bridge"), "UI smoke run should record a pi-web bridge execution log entry");
const piStatus = await request("/workgraph-os/pi/status");
assert(piStatus.source === "pi-web-bridge" && typeof piStatus.reachable === "boolean" && ["auto", "on", "off"].includes(piStatus.mode), "UI smoke pi-web status should expose bridge reachability and mode");

// input-file injection + output watcher (deliverable ②)
assert(Array.isArray(run.promptRecord?.inputFiles), "UI smoke run PromptRecord should expose a resolved inputFiles array for pi-readable paths");
const outputs = await request("/workgraph-os/outputs");
assert(outputs.source === "workgraph-output-watcher" && typeof outputs.enabled === "boolean" && typeof outputs.active === "boolean", "UI smoke should expose the output watcher status");

// skill auto-evolution (deliverable ④)
assert(run.skillEvolution && typeof run.skillEvolution.status === "string", "UI smoke run should return a skill auto-evolution decision");
const evolution = await request("/workgraph-os/skills/evolution");
assert(evolution.source === "workgraph-skill-evolution" && Array.isArray(evolution.templates) && Array.isArray(evolution.repairTasks), "UI smoke should expose skill templates and repair tasks");

// model live probe + output variants + version history (deliverable ⑤)
const modelProbe = await request("/workgraph-os/models/probe");
assert(modelProbe.source === "workgraph-model-probe" && Array.isArray(modelProbe.catalog) && modelProbe.catalog.every((item) => ["available", "unavailable", "unknown"].includes(item.live)), "UI smoke should expose live model availability on the catalog");
const variantRun = await request("/workgraph-os/run", { method: "POST", body: JSON.stringify({ nodeId: "workflow-runner", bridge: "off", variants: 2 }) });
assert(Array.isArray(variantRun.variants) && variantRun.variants.length === 2 && variantRun.variants[0].variantRole === "primary" && variantRun.variants[1].variantRole === "variant", "UI smoke should produce side-by-side output variants");
const versions = await request(`/workgraph-os/versions/result/${encodeURIComponent(variantRun.result.id)}`);
assert(versions.source === "workgraph-version-history" && versions.versionCount >= 1, "UI smoke should expose per-object version history");

const feedback = await request("/workgraph-os/feedback", {
  method: "POST",
  body: JSON.stringify({
    targetId: run.execution.resultId,
    targetType: "result",
    rating: "needs_revision",
    action: "avoid",
    note: "这个太廉价，不适合 DAPOT；后续要更干净可信，减少文字和拼接感。",
    sourceResultId: run.execution.resultId,
    sourceWorkflowId: run.execution.workflowId,
    brandId: "brand_dapot"
  })
});
assert(feedback.memory?.reusable === true, "UI smoke feedback should write reusable memory");
assert(feedback.workspace?.results?.some((result) => result.id === run.execution.resultId && result.trace?.feedbackIds?.includes(feedback.feedback.id)), "UI smoke feedback should link back to Result trace");
assert(feedback.workspace?.modelPolicies?.some((policy) => policy.feedbackId === feedback.feedback.id && policy.avoid === true), "UI smoke feedback should create a visible avoid ModelPolicy");
assert(feedback.appliedLearning?.modelPolicyId && feedback.appliedLearning?.modelPolicyStrategy, "UI smoke feedback should expose model policy learning metadata");
assert(feedback.appliedLearning?.brandForbiddenWords?.some((item) => String(item).includes("这个太廉价")), "UI smoke feedback should expose DAPOT brand forbidden learning");
assert(feedback.brand?.forbiddenWords?.some((item) => String(item).includes("这个太廉价")), "UI smoke feedback should return updated brand learning for the Brand module");
const learnedBrands = await request("/workgraph-os/brands");
assert(learnedBrands.brands?.some((brand) => brand.id === "brand_dapot" && brand.forbiddenWords?.some((item) => String(item).includes("这个太廉价"))), "UI smoke should reload DAPOT learned forbidden words from the brand store");

const queue = await request("/workgraph-os/snapshots");
assert(queue.storage?.exists === true, "UI smoke should expose data snapshot status through the web same-origin API");
assert(queue.snapshots?.some((item) => item.type === "results" && item.exists), "UI smoke should expose result snapshots");
assert(queue.snapshots?.some((item) => item.type === "feedback" && item.exists), "UI smoke should expose feedback snapshots");

const sqlite = await request("/workgraph-os/sqlite/schema");
assert(sqlite.storage === "native-sqlite", "UI smoke should expose native SQLite readiness");
assert(sqlite.rowCounts?.wgos_objects > 0 && sqlite.rowCounts?.wgos_execution_logs > 0, "UI smoke should expose populated SQLite rows");
assert(["sqlite3-cli", "node-sqlite", "json-only"].includes(sqlite.writer), "UI smoke should expose the resolved SQLite writer for graceful degradation");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "local-web-page",
    "same-origin-workspace-save",
    "same-origin-plan",
    "same-origin-draft-skill-create-bind-followup",
    "same-origin-run-preview-only",
    "same-origin-pi-session-context",
    "same-origin-pi-bridge-simulated",
    "same-origin-input-file-injection",
    "same-origin-output-watcher",
    "same-origin-skill-auto-evolution",
    "same-origin-model-live-probe",
    "same-origin-output-variants",
    "same-origin-version-history",
    "same-origin-feedback-memory",
    "same-origin-brand-learning-visible",
    "same-origin-model-policy-learning-visible",
    "same-origin-snapshots",
    "same-origin-sqlite-status"
  ],
  resultId: run.execution.resultId,
  feedbackId: feedback.feedback.id,
  draftSkillId: draftSkill.skill.id,
  webBaseUrl
}, null, 2));
