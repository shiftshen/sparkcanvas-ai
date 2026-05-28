import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4199;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-smoke-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const workGraphOsDataFile = path.join(tempDir, "workgraph-os.json");
const workGraphOsHistoryFile = path.join(tempDir, "workgraph-os-history.json");
const generatedDir = path.join(tempDir, "generated");
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
let token = "";
const optionalChecks = [];

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    PORT: String(port),
    SPARKCANVAS_DATA_FILE: dataFile,
    WORKGRAPH_OS_DATA_FILE: workGraphOsDataFile,
    WORKGRAPH_OS_HISTORY_FILE: workGraphOsHistoryFile,
    SPARKCANVAS_GENERATED_DIR: generatedDir,
    SPARKCANVAS_DISABLE_IMAGE_GEN: "1",
    SPARKCANVAS_PUBLIC_BASE_URL: "http://127.0.0.1:1234"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function uploadAssetImage(params) {
  const png = Buffer.from(tinyPngBase64, "base64");
  const query = new URLSearchParams(params);
  const response = await fetch(`${baseUrl}/assets/upload?${query.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      Authorization: `Bearer ${token}`
    },
    body: png
  });
  if (!response.ok) throw new Error(`POST /assets/upload failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const health = await request("/health");
      if (health.ok && health.domain === "xmanx.com") return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Server did not become ready.\n${serverLog}`);
}

async function waitForTask(taskId) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 8000) {
    const result = await request(`/tasks/${taskId}`);
    last = result;
    if (result.task.status === "completed" && result.frame.status === "success") return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Task ${taskId} did not complete: ${JSON.stringify({
    taskStatus: last?.task?.status,
    taskProgress: last?.task?.progress,
    frameStatus: last?.frame?.status,
    frameProgress: last?.frame?.progress
  })}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeOpenAiCompatibleBaseUrl(value, defaultBaseUrl = "https://api.vdamo.com/v1") {
  const normalized = (value || defaultBaseUrl)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|images\/generations|responses|models)$/i, "");
  return /\/v\d+(?:beta)?$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", ...options });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function createSmokeVideo(filename, color) {
  await mkdir(generatedDir, { recursive: true });
  const outputPath = path.join(generatedDir, filename);
  const candidates = [process.env.FFMPEG_PATH, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].filter(Boolean);
  for (const ffmpeg of candidates) {
    const ok = await runProcess(ffmpeg, [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${color}:s=320x180:d=1`,
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath
    ]);
    if (ok) return `/generated/${filename}`;
  }
  return "";
}

try {
  await waitForServer();

  const unauthorized = await fetch(`${baseUrl}/workspace`);
  assert(unauthorized.status === 401, "workspace should require a demo token");
  const unauthorizedWorkGraph = await fetch(`${baseUrl}/workgraph-os/workspace`);
  assert(unauthorizedWorkGraph.status === 401, "WorkGraph OS workspace should require a token");

  const wrongLogin = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: "shift", password: "wrong-password" })
  });
  assert(wrongLogin.status === 401, "demo login should reject invalid credentials");

  let rateLimited = false;
  const bruteAccount = "bruteforce@example.com";
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: bruteAccount, password: "wrong-password" })
    });
    if (attempt < 10) {
      assert(response.status === 401, `login attempt ${attempt + 1} should still be rejected normally`);
    } else {
      rateLimited = response.status === 429;
      assert(rateLimited, "login attempts should be rate limited after repeated failures");
    }
  }

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  token = login.token;
  assert(typeof login.user?.credits === "number" && login.user.credits > 0, "demo login should return usable credits");
  const refilledUser = await request("/me/credits/refill", { method: "POST", body: JSON.stringify({}) });
  assert(refilledUser.credits === 1260, "local demo credit refill should keep demo account testable");

  const authConfig = await request("/auth/config");
  assert(authConfig.demo?.enabled === true, "local auth config should expose demo login");
  assert(authConfig.demo?.defaultAccount === "shift", "local auth config should expose the default demo account");
  assert(typeof authConfig.registrationReason === "string" && authConfig.registrationReason.length > 0, "auth config should explain registration availability");
  assert(typeof authConfig.google?.reason === "string" && authConfig.google.reason.length > 0, "auth config should explain Google availability");

  const initialWorkGraph = await request("/workgraph-os/workspace");
  assert(initialWorkGraph.storage?.mode === "filesystem-json", "WorkGraph OS should use filesystem JSON storage through the backend");
  assert(initialWorkGraph.workspace === null, "new WorkGraph OS storage should start empty in isolated smoke data dir");
  const workGraphBrands = await request("/workgraph-os/brands");
  assert(workGraphBrands.source === "sparkcanvas-brand-db", "WorkGraph OS should read brands from the SparkCanvas brand database");
  assert(workGraphBrands.brands?.some((brand) => brand.id === "brand_xmanx" && String(brand.context).includes("$copy.brand_name")), "WorkGraph OS brand API should expose compiled brand context");
  const workGraphAssets = await request("/workgraph-os/assets?brandId=brand_xmanx");
  assert(workGraphAssets.source === "sparkcanvas-asset-store", "WorkGraph OS should read assets from the SparkCanvas asset store");
  assert(workGraphAssets.assets?.some((asset) => asset.source === "sparkcanvas-asset-store" && String(asset.token).startsWith("$")), "WorkGraph OS asset API should expose tokenized material objects");
  const workGraphPayload = {
    version: 1,
    goal: {
      id: "goal-smoke",
      title: "DAPOT opening TikTok video",
      rawInput: "给 DAPOT 做一条开业短视频",
      normalizedIntent: "video_generation -> mp4 using brand:dapot",
      goalType: "video_generation",
      brandId: "dapot",
      outputTarget: "mp4",
      constraints: ["language: Thai-first", "audience: young users"],
      successCriteria: ["visible work graph", "reviewable mp4 result"]
    },
    materials: [{ id: "mat-smoke", title: "Smoke asset", kind: "image", token: "$smoke.asset" }],
    skills: [{
      id: "skill-smoke",
      title: "Smoke skill",
      command: "/smoke",
      capabilityType: "workflow_automation",
      skillMdPath: "skills/generated/smoke/SKILL.md",
      runtime: "pi-skill",
      inputs: ["Goal Object"],
      outputs: ["Result Object"],
      evolution: { status: "candidate", runCount: 2, successCount: 1, failureCount: 1, testPlan: ["run smoke skill"] }
    }],
    nodes: [{ id: "node-smoke", title: "Smoke node", type: "skill", body: "Use smoke asset", status: "ready", materialIds: ["mat-smoke"] }],
    workflow: {
      id: "workflow-smoke",
      title: "Smoke reusable workflow",
      goalId: "goal-smoke",
      version: "0.1.0",
      status: "ready",
      reusable: true,
      prompt: "给 DAPOT 做一条开业短视频",
      nodeIds: ["node-smoke"],
      edgeIds: ["goal-smoke->node-smoke"],
      selectedMaterialIds: ["mat-smoke"],
      skillIds: ["skill-smoke"],
      modelIds: ["imgen"],
      resultIds: ["result-smoke"],
      runCount: 3
    },
    activeBrandId: "dapot",
    activeModelId: "imgen",
    selectedIds: ["mat-smoke"],
    prompt: "给 DAPOT 做一条开业短视频",
    activeMaterialId: "mat-smoke",
    jobs: [],
    results: [{
      id: "result-smoke",
      title: "Smoke result",
      workflowId: "workflow-smoke",
      nodeId: "node-smoke",
      kind: "image",
      status: "preview",
      version: 2,
      output: "PNG",
      previewUrl: "/brand-assets/generated/xmanx-product.png",
      sourceJobId: "job-smoke",
      materialIds: ["mat-smoke"],
      canSaveAsMaterial: true
    }],
    feedback: [{
      id: "fb-smoke",
      targetId: "result-smoke",
      targetType: "result",
      rating: "accepted",
      action: "reuse",
      note: "accepted",
      memoryId: "mem-smoke",
      sourceResultId: "result-smoke",
      sourceWorkflowId: "workflow-smoke",
      createdAt: "2026-05-24T00:00:00.000Z"
    }],
    memories: [{
      id: "mem-smoke",
      title: "Smoke feedback memory",
      source: "feedback",
      sourceType: "feedback",
      sourceId: "fb-smoke",
      targetType: "result",
      targetId: "result-smoke",
      confidence: 0.9,
      reusable: true,
      body: "reuse: feedback memory",
      createdAt: "2026-05-24T00:00:00.000Z"
    }]
  };
  const savedWorkGraph = await request("/workgraph-os/workspace", { method: "PUT", body: JSON.stringify(workGraphPayload) });
  assert(savedWorkGraph.workspace?.prompt === workGraphPayload.prompt, "WorkGraph OS workspace should persist the prompt");
  assert(savedWorkGraph.workspace?.goal?.goalType === "video_generation", "WorkGraph OS workspace should persist structured goal objects");
  assert(savedWorkGraph.workspace?.workflow?.reusable === true, "WorkGraph OS workspace should persist structured workflow objects");
  assert(savedWorkGraph.workspace?.results?.[0]?.canSaveAsMaterial === true, "WorkGraph OS workspace should persist structured result objects");
  assert(savedWorkGraph.workspace?.skills?.[0]?.skillMdPath === "skills/generated/smoke/SKILL.md", "WorkGraph OS workspace should persist standardized skill object metadata");
  assert(savedWorkGraph.workspace?.feedback?.[0]?.memoryId === "mem-smoke", "WorkGraph OS workspace should persist linked feedback objects");
  assert(savedWorkGraph.objectIndex?.counts?.asset >= 2, "WorkGraph OS workspace save should return workspace and asset-store Asset Objects");
  const savedBrandObject = savedWorkGraph.objectIndex?.objects?.find((item) => item.type === "brand");
  assert(savedBrandObject?.payload?.source === "sparkcanvas-brand-db", "WorkGraph OS workspace save should index brand database payloads");
  assert(savedWorkGraph.objectIndex?.objects?.some((item) => item.type === "asset" && item.payload?.source === "sparkcanvas-asset-store"), "WorkGraph OS object index should include asset-store derived Asset Objects");
  assert(savedWorkGraph.objectIndex?.counts?.node === 1, "WorkGraph OS workspace save should return persisted node objects");
  assert(savedWorkGraph.historyEntry?.objectIds?.includes("asset:mat-smoke"), "WorkGraph OS workspace save should record a history snapshot");
  const reloadedWorkGraph = await request("/workgraph-os/workspace");
  assert(reloadedWorkGraph.workspace?.materials?.[0]?.id === "mat-smoke", "WorkGraph OS workspace should reload from filesystem JSON");
  assert(reloadedWorkGraph.workspace?.nodes?.[0]?.id === "node-smoke", "WorkGraph OS workspace should reload canvas node objects");
  assert(reloadedWorkGraph.workspace?.memories?.[0]?.id === "mem-smoke", "WorkGraph OS workspace should reload memory objects");
  const workGraphObjects = await request("/workgraph-os/objects");
  assert(workGraphObjects.counts?.goal === 1, "WorkGraph OS object index should include a goal object");
  assert(workGraphObjects.counts?.asset >= 2, "WorkGraph OS object index should include workspace and asset-store asset objects");
  assert(workGraphObjects.counts?.skill === 1, "WorkGraph OS object index should include skill objects");
  assert(workGraphObjects.counts?.model === 1, "WorkGraph OS object index should include model objects");
  assert(workGraphObjects.counts?.node === 1, "WorkGraph OS object index should include node objects");
  assert(workGraphObjects.counts?.result === 1, "WorkGraph OS object index should include result objects");
  assert(workGraphObjects.counts?.memory === 1, "WorkGraph OS object index should include memory objects");
  const goalObject = workGraphObjects.objects.find((item) => item.id === "goal:goal-smoke");
  assert(goalObject?.source === "workspace" && goalObject?.summary === "video_generation -> mp4 using brand:dapot", "WorkGraph OS object index should include the saved structured goal");
  const skillObject = workGraphObjects.objects.find((item) => item.id === "skill:skill-smoke");
  assert(skillObject?.summary?.includes("/smoke") && skillObject?.summary?.includes("skills/generated/smoke/SKILL.md"), "WorkGraph OS object index should include standardized skill metadata");
  const modelObject = workGraphObjects.objects.find((item) => item.id === "model:imgen");
  assert(String(modelObject?.payload?.routingPolicy).includes("fallback"), "WorkGraph OS object index should include model routing policy metadata");
  assert(Array.isArray(modelObject?.payload?.modelCatalog) && modelObject.payload.modelCatalog.length > 0, "WorkGraph OS object index should include model routing catalog metadata");
  const workflowObject = workGraphObjects.objects.find((item) => item.id === "workflow:workflow-smoke");
  assert(workflowObject?.source === "workspace" && String(workflowObject?.payload?.runCount) === "3", "WorkGraph OS object index should include reusable workflow object metadata");
  const resultObject = workGraphObjects.objects.find((item) => item.id === "result:result-smoke");
  assert(resultObject?.summary?.includes("image v2") && resultObject?.payload?.canSaveAsMaterial === true, "WorkGraph OS object index should include previewable result object metadata");
  const feedbackObject = workGraphObjects.objects.find((item) => item.id === "feedback:fb-smoke");
  assert(feedbackObject?.summary?.includes("reuse") && feedbackObject?.summary?.includes("result:result-smoke"), "WorkGraph OS object index should include feedback target/action metadata");
  const memoryObject = workGraphObjects.objects.find((item) => item.id === "memory:mem-smoke");
  assert(memoryObject?.payload?.sourceId === "fb-smoke" && memoryObject?.payload?.reusable === true, "WorkGraph OS object index should include reusable memory source metadata");
  assert(workGraphObjects.objects.some((item) => item.id === "asset:mat-smoke"), "WorkGraph OS object index should include the saved asset");
  assert(workGraphObjects.objects.some((item) => item.id === "node:node-smoke"), "WorkGraph OS object index should include the saved canvas node");
  const memoryObjects = await request("/workgraph-os/objects?type=memory");
  assert(memoryObjects.objects.length === 1 && memoryObjects.objects[0].id === "memory:mem-smoke", "WorkGraph OS object index should support type filtering");
  const smokeAssetObject = await request("/workgraph-os/objects/asset/mat-smoke");
  assert(smokeAssetObject.title === "Smoke asset", "WorkGraph OS object detail should return the requested object");
  const workGraphSkills = await request("/workgraph-os/skills");
  assert(workGraphSkills.source === "workgraph-skill-store" && workGraphSkills.skills?.some((skill) => skill.id === "skill-smoke"), "WorkGraph OS skill store should list workspace skills");
  const createdWorkGraphSkill = await request("/workgraph-os/skills", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke created skill",
      command: "/smoke-created",
      output: "PNG",
      description: "Created by smoke through the WorkGraph OS skill store",
      keywords: ["smoke", "created"],
      capabilityType: "image_generation"
    })
  });
  assert(createdWorkGraphSkill.skill?.source === "workgraph-skill-store" && createdWorkGraphSkill.skill?.skillMdPath?.includes("smoke-created"), "WorkGraph OS skill store should create normalized Skill Objects");
  assert(createdWorkGraphSkill.workspace?.skills?.some((skill) => skill.command === "/smoke-created"), "WorkGraph OS skill store should persist created skills into the workspace");
  assert(createdWorkGraphSkill.objectIndex?.counts?.skill === 2, "WorkGraph OS skill store should update the skill object index");
  const workGraphRun = await request("/workgraph-os/run", { method: "POST", body: JSON.stringify({ nodeId: "node-smoke", mode: "node" }) });
  assert(workGraphRun.execution?.executor === "workgraph-os-backend", "WorkGraph OS should run nodes through the backend executor");
  assert(workGraphRun.routingDecision?.selectedModelId === "imgen", "WorkGraph OS backend executor should return a model routing decision");
  assert(String(workGraphRun.routingDecision?.reason).includes("skill") || String(workGraphRun.routingDecision?.reason).includes("node"), "WorkGraph OS routing decision should explain node/model selection");
  assert(workGraphRun.workspace?.jobs?.[0]?.executor === "workgraph-os-backend", "WorkGraph OS backend executor should persist job objects");
  assert(workGraphRun.workspace?.jobs?.[0]?.routingDecision?.selectedModelId === "imgen", "WorkGraph OS backend executor should persist job routing decisions");
  assert(workGraphRun.workspace?.results?.[0]?.sourceJobId === workGraphRun.execution?.jobId, "WorkGraph OS backend executor should persist linked result objects");
  assert(workGraphRun.workspace?.results?.[0]?.routingDecision?.route === "/v1/responses image_generation", "WorkGraph OS backend executor should persist result routing decisions");
  assert(workGraphRun.workspace?.memories?.[0]?.sourceId === "workflow-smoke", "WorkGraph OS backend executor should persist run memory objects");
  assert(workGraphRun.objectIndex?.counts?.result === 2, "WorkGraph OS backend executor should update the result object index");
  const workGraphHistory = await request("/workgraph-os/history");
  assert(workGraphHistory.entries?.length === 3, "WorkGraph OS history should include save, skill-create and run snapshots");
  assert(workGraphHistory.entries[0].counts?.result === 2, "WorkGraph OS run history should retain updated result counts");
  const workGraphHistoryByType = await request("/workgraph-os/history?type=memory");
  assert(workGraphHistoryByType.entries?.length === 3, "WorkGraph OS history should support type filtering");
  const workGraphHistoryDetail = await request(`/workgraph-os/history/${workGraphHistory.entries[0].id}`);
  assert(workGraphHistoryDetail.objects?.some((item) => item.id === `result:${workGraphRun.execution.resultId}`), "WorkGraph OS history detail should retain backend executor result objects");
  const workGraphSqliteSchema = await request("/workgraph-os/sqlite/schema");
  assert(workGraphSqliteSchema.ready === true && workGraphSqliteSchema.dialect === "sqlite", "WorkGraph OS SQLite schema should report export readiness");
  assert(workGraphSqliteSchema.tables.includes("wgos_objects") && workGraphSqliteSchema.tables.includes("wgos_edges") && workGraphSqliteSchema.tables.includes("wgos_history"), "WorkGraph OS SQLite schema should expose object, edge and history tables");
  const workGraphSqliteExport = await request("/workgraph-os/sqlite/export");
  const sqliteObjects = workGraphSqliteExport.tables.find((table) => table.name === "wgos_objects");
  const sqliteEdges = workGraphSqliteExport.tables.find((table) => table.name === "wgos_edges");
  const sqliteHistory = workGraphSqliteExport.tables.find((table) => table.name === "wgos_history");
  assert(sqliteObjects?.rows?.some((row) => row.id === "asset:mat-smoke"), "WorkGraph OS SQLite export should include indexed asset rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "goal:goal-smoke" && String(row.payload_json).includes("successCriteria")), "WorkGraph OS SQLite export should include structured goal payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "skill:skill-smoke" && String(row.payload_json).includes("skillMdPath")), "WorkGraph OS SQLite export should include standardized skill payload rows");
  assert(sqliteObjects?.rows?.some((row) => String(row.payload_json).includes("/smoke-created") && String(row.payload_json).includes("workgraph-skill-store")), "WorkGraph OS SQLite export should include skill-store created skill payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "model:imgen" && String(row.payload_json).includes("routingPolicy")), "WorkGraph OS SQLite export should include model routing payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "workflow:workflow-smoke" && String(row.payload_json).includes("reusable")), "WorkGraph OS SQLite export should include structured workflow payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "result:result-smoke" && String(row.payload_json).includes("canSaveAsMaterial")), "WorkGraph OS SQLite export should include structured result payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "feedback:fb-smoke" && String(row.payload_json).includes("memoryId")), "WorkGraph OS SQLite export should include linked feedback payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "memory:mem-smoke" && String(row.payload_json).includes("sourceType")), "WorkGraph OS SQLite export should include structured memory payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === `result:${workGraphRun.execution.resultId}` && String(row.payload_json).includes("workgraph-os-backend")), "WorkGraph OS SQLite export should include backend executor result rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === `result:${workGraphRun.execution.resultId}` && String(row.payload_json).includes("routingDecision")), "WorkGraph OS SQLite export should include result routing decision payload rows");
  assert(sqliteObjects?.rows?.some((row) => row.id === "node:node-smoke"), "WorkGraph OS SQLite export should include persisted node rows");
  assert(sqliteEdges?.rows?.some((row) => row.from_object_id === "workflow:workflow-smoke" && row.to_object_id === "asset:mat-smoke" && row.relation === "uses_asset"), "WorkGraph OS SQLite export should include workflow-to-asset graph edges");
  assert(sqliteEdges?.rows?.some((row) => row.from_object_id === "node:node-smoke" && row.to_object_id === "asset:mat-smoke" && row.relation === "uses_asset"), "WorkGraph OS SQLite export should include node-to-asset graph edges");
  assert(sqliteEdges?.rows?.some((row) => row.from_object_id === "feedback:fb-smoke" && row.to_object_id === "result:result-smoke" && row.relation === "comments_on"), "WorkGraph OS SQLite export should include feedback-to-result graph edges");
  assert(sqliteEdges?.rows?.some((row) => row.from_object_id === "memory:mem-smoke" && row.to_object_id === "feedback:fb-smoke" && row.relation === "remembers"), "WorkGraph OS SQLite export should include memory-to-feedback graph edges");
  assert(sqliteEdges?.rows?.some((row) => row.from_object_id === "workflow:workflow-smoke" && row.to_object_id === `result:${workGraphRun.execution.resultId}` && row.relation === "produces_result"), "WorkGraph OS SQLite export should include backend executor workflow-to-result edges");
  assert(sqliteHistory?.rows?.some((row) => row.id === workGraphHistory.entries[0].id), "WorkGraph OS SQLite export should include history rows");
  const workGraphPlan = await request("/workgraph-os/plan", {
    method: "POST",
    body: JSON.stringify({
      prompt: "用 XMANX 品牌素材规划一张新品发布海报 -> PNG",
      brandId: "brand_xmanx",
      activeModelId: "imgen"
    })
  });
  assert(workGraphPlan.source === "workgraph-workflow-planner", "WorkGraph OS should expose a backend workflow planner");
  assert(workGraphPlan.plan?.nodeIds?.includes("model-router") && workGraphPlan.plan?.nodeIds?.includes("review-memory"), "WorkGraph OS planner should generate auditable workflow node ids");
  assert(typeof workGraphPlan.plan?.createdSkillId === "string" && workGraphPlan.plan.createdSkillId.startsWith("skill-candidate-"), "WorkGraph OS planner should create candidate Skill Objects when no existing skill matches");
  assert(workGraphPlan.routingDecision?.selectedModelId === "imgen", "WorkGraph OS planner should include model routing decisions");
  assert(workGraphPlan.workspace?.nodes?.some((node) => node.id === "skill-search"), "WorkGraph OS planner should persist skill search nodes into the workspace");
  assert(workGraphPlan.workspace?.skills?.some((skill) => skill.id === workGraphPlan.plan.createdSkillId && skill.evolution?.status === "candidate"), "WorkGraph OS planner should persist candidate skills into the Skill Store");
  assert(workGraphPlan.objectIndex?.objects?.some((item) => item.id === `skill:${workGraphPlan.plan.createdSkillId}` && item.payload?.source === "workgraph-workflow-planner"), "WorkGraph OS planner should index planner-created Skill Objects");
  assert(workGraphPlan.objectIndex?.counts?.node >= 8, "WorkGraph OS planner should update the persisted node object index");

  const initial = await request("/workspace");
  assert(initial.brands.some((brand) => brand.id === "brand_xmanx" && brand.active), "XMANX should be the active default brand");
  assert(initial.templates.some((template) => template.id === "tpl_brandkit"), "brand kit template should exist");
  assert(initial.models[0]?.id === "vdamo-gpt-image-2", "default image model should be vdamo GPT Image 2");
  assert(initial.models.some((model) => model.id === "vdamo-gpt-image-1-5"), "model selector should expose VDAMO GPT Image 1.5 fallback");
  assert(initial.models.some((model) => model.id === "vdamo-gpt-5-4-mini" && model.type === "text"), "workspace should expose VDAMO text models for editor tools");
  assert(!initial.models.some((model) => model.id === "vdamo-gemini-2-5-flash-image"), "disabled Gemini image probes should not be selectable in the workspace");
  assert(!initial.models.some((model) => model.id === "yijiarj-nano-banana-2"), "legacy nano_banana_2 image route should not be selectable");
  assert(initial.models.some((model) => model.id === "yijiarj-grok-video-720p"), "model selector should expose verified yijiarj video model");
  assert(!initial.models.some((model) => model.id === "cliproxyapi-gpt-5"), "legacy cliproxyapi image routes should not be selectable");
  assert(typeof initial.ai?.imageGeneration?.model === "string" && initial.ai.imageGeneration.model.length > 0, "workspace should expose sanitized AI API status");

  const aiStatus = await request("/ai/status");
  assert(typeof aiStatus.imageGeneration.baseUrl === "string" && aiStatus.imageGeneration.baseUrl.includes("/v1"), "AI status should expose image generation base URL");
  assert(!("apiKey" in aiStatus.imageGeneration), "AI status must not expose secrets");
  assert(aiStatus.publicReference?.productionReady === false, "local smoke should mark public reference URLs as not production-ready by default");
  assert(typeof aiStatus.publicReference?.message === "string" && aiStatus.publicReference.message.length > 0, "AI status should explain public reference readiness");
  assert(aiStatus.launchReadiness?.productionReady === false, "local smoke should block launch readiness when video/public reference config is missing");
  assert(aiStatus.launchReadiness?.checks?.some((item) => item.id === "video-api" && item.ready === false), "launch readiness should require yijiarj video API configuration");
  assert(aiStatus.launchReadiness?.checks?.some((item) => item.id === "public-reference" && item.ready === false), "launch readiness should require public input_reference publishing");
  const aiDiagnostics = await request("/ai/diagnostics");
  assert(aiDiagnostics.runtime.endpoint.includes("/images/generations"), "AI diagnostics should expose the VDAMO image API endpoint");
  assert(
    normalizeOpenAiCompatibleBaseUrl("https://api.vdamo.com/v1/images/generations") === "https://api.vdamo.com/v1",
    "OpenAI-compatible base URL normalization should strip full image endpoint paths"
  );
  assert(
    normalizeOpenAiCompatibleBaseUrl("https://api.vdamo.com/v1/chat/completions") === "https://api.vdamo.com/v1",
    "OpenAI-compatible base URL normalization should strip full chat endpoint paths"
  );
  assert(aiDiagnostics.runtime.canAttemptGeneration === false, "local smoke disables image generation and should report that API generation cannot be attempted");
  assert(!("apiKey" in aiDiagnostics.imageGeneration), "AI diagnostics must not expose secrets");
  assert(aiDiagnostics.publicReference?.productionReady === false, "AI diagnostics should include non-production public reference readiness locally");
  assert(aiDiagnostics.launchReadiness?.summary?.includes("Launch blocked"), "AI diagnostics should explain launch blockers");
  const modelDiagnostics = await request("/ai/models/diagnostics");
  assert(modelDiagnostics.models.some((item) => item.id === "vdamo-gpt-image-2" && item.status === "recommended"), "model diagnostics should mark vdamo GPT Image 2 as the recommended image route");
  assert(modelDiagnostics.models.some((item) => item.id === "vdamo-gemini-2-5-flash-image" && item.status === "disabled"), "model diagnostics should retain disabled Gemini image probe results");
  assert(modelDiagnostics.models.some((item) => item.id === "yijiarj-veo-3-1-fast" && item.type === "video"), "model diagnostics should include switchable video candidates");
  assert(modelDiagnostics.models.some((item) => item.model === "veo_3_1-fast" && item.clipSeconds === 8), "veo_3_1-fast should be planned as an 8s fixed video model");
  assert(modelDiagnostics.models.some((item) => item.model === "grok-imagine-1.0-video-super" && item.clipSeconds === 10), "grok video super should remain planned as a 10s fixed video model");

  const invalidGenerate = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: "" })
  });
  const invalidGenerateBody = await invalidGenerate.json();
  assert(invalidGenerate.status === 400 && invalidGenerateBody.message === "Invalid request payload", "invalid payloads should return JSON 400 errors");
  const invalidCount = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: "invalid count", settings: { count: 7 } })
  });
  assert(invalidCount.status === 400, "invalid generation settings should return 400");
  const missingTask = await fetch(`${baseUrl}/tasks/not-found`, { headers: { Authorization: `Bearer ${token}` } });
  assert(missingTask.status === 404, "missing task should return 404");

  const brand = await request("/brands", {
    method: "POST",
    body: JSON.stringify({
      name: "XMANX Smoke",
      logoText: "XM",
      primaryColor: "#111827",
      accentColor: "#f97316",
      tone: "black orange launch visuals",
      market: "xmanx.com validation",
      slogan: "AI launch kit for xmanx.com",
      industry: "AI commerce operations",
      targetAudience: "brand operators and performance designers",
      brandStory: "A reusable brand brain for launch posters and canvas workflows.",
      ipName: "XM Smoke IP",
      ipDescription: "A direct AI assistant IP for campaign guidance.",
      logoUsage: "Keep the XM logo crisp with clear safe margin.",
      visualStyle: "black orange commercial product hierarchy",
      sceneKeywords: ["launch poster", "product hero"],
      forbiddenWords: ["fake logo", "messy layout"],
      assetRoles: [
        { role: "logo", title: "XM Smoke Logo", description: "Transparent logo for watermark and corner lockup.", color: "#111827" },
        { role: "ip", title: "XM Smoke IP", description: "Assistant character for brand maintenance.", color: "#f97316" },
        { role: "product", title: "Smoke Product", description: "Hero product reference.", color: "#f97316" }
      ],
      autoInject: true
    })
  });
  assert(brand.name === "XMANX Smoke", "brand creation failed");
  assert(brand.ipName === "XM Smoke IP" && brand.assetRoles.length === 3, "brand detail profile should be stored");

  const activeBrand = await request(`/brands/${brand.id}`, {
    method: "PATCH",
    body: JSON.stringify({ active: true, forbiddenWords: ["fake logo", "blurry product"] })
  });
  assert(activeBrand.active === true, "brand activation failed");
  assert(activeBrand.forbiddenWords.includes("blurry product"), "brand detail patch failed");

  const dapotBrand = await request("/brands", {
    method: "POST",
    body: JSON.stringify({
      name: "DAPOT",
      logoText: "DAPOT",
      primaryColor: "#E60012",
      accentColor: "#FFB400",
      tone: "Friendly, warm, helpful, professional, quick-response Thai local restaurant service tone. Default language is Thai.",
      market: "Thailand buffet hot pot restaurant, self-service dining, drinks, dessert, social food experience, Facebook and TikTok restaurant marketing",
      slogan: "Eat the World in One Hot Pot",
      industry: "Thailand buffet hot pot restaurant",
      targetAudience: "Thai young customers, students, office workers, couples, families, female customers, food lovers and social media users.",
      brandStory: "DAPOT is a new-generation hot pot brand under CHINDA HOTPOT with buffet sets, drinks, sauce station and social dining experiences.",
      ipName: "น้องดาพอต / Dapot Buddy",
      ipDescription: "A high-quality 3D cartoon female virtual store manager with brown hair, small golden bull horns, black DAPOT uniform, red apron and warm service personality.",
      logoUsage: "Use the DAPOT logo clearly on red, black, white or warm restaurant backgrounds. Do not blur, stretch, distort, recolor, crop or cover the logo.",
      visualStyle: "Clean commercial 3D cartoon visuals, modern Thai restaurant marketing style, red-black-gold brand color system, warm lighting and appetizing hot pot food photography.",
      sceneKeywords: ["hot pot restaurant", "buffet hot pot", "self-service food bar", "sauce station", "drink station", "TikTok cover", "Facebook ad", "LINE sticker"],
      forbiddenWords: ["blurred logo", "distorted logo", "wrong brand name", "wrong Thai spelling", "unreadable text", "competitor logo"],
      assetRoles: [
        { role: "logo", title: "DAPOT Logo", description: "red black gold restaurant logo", color: "#E60012" },
        { role: "ip", title: "Dapot Buddy", description: "3D cartoon virtual store manager", color: "#FFB400" },
        { role: "product", title: "Hot pot buffet", description: "299 399 499 buffet sets", color: "#E60012" }
      ],
      autoInject: true
    })
  });
  assert(dapotBrand.ipName.includes("Dapot Buddy") && dapotBrand.visualStyle.includes("red-black-gold"), "DAPOT detailed brand profile should be stored");
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({ title: "DAPOT Logo Image", type: "logo", brandId: dapotBrand.id, color: "#E60012", meta: "$logo · dapot logo image", imageUrl: "/brand-assets/generated/xmanx-logo.png" })
  });
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({ title: "DAPOT IP Image", type: "model", brandId: dapotBrand.id, color: "#FFB400", meta: "$ip · Dapot Buddy image", imageUrl: "/brand-assets/generated/xmanx-ip.png" })
  });
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({ title: "DAPOT Hot Pot Product", type: "product", brandId: dapotBrand.id, color: "#E60012", meta: "$product · hot pot buffet product image", imageUrl: "/brand-assets/generated/xmanx-product.png" })
  });
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({ title: "DAPOT Buffet Menu 299 399 499", type: "upload", brandId: dapotBrand.id, color: "#E60012", meta: "$menu.buffet · self-service buffet menu sets 299 399 499 drinks desserts sauce station", imageUrl: "/brand-assets/generated/xmanx-product.png" })
  });
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({ title: "DAPOT Custom Sauce Station", type: "upload", brandId: dapotBrand.id, color: "#FFB400", meta: "$dapot.special_sauce · custom edited qualified tag", imageUrl: "/brand-assets/generated/xmanx-storefront.png" })
  });
  const dapotRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "@imgen /生成海报 使用 $dapot $dapot.logo $dapot.ip $dapot.product $dapot.menu.buffet $dapot.special_sauce，显示 $copy.slogan -> JPG",
      brandId: dapotBrand.id,
      brandInject: true
    })
  });
  assert(dapotRefs.brandKey === "dapot", "brand key should prefer brand name over market first word");
  assert(["logo", "ip", "product", "menu"].every((role) => dapotRefs.imageReferences.some((reference) => reference.role === role && reference.imageUrl)), "$dapot.* references should resolve to real DAPOT logo/IP/product/menu image assets");
  assert(dapotRefs.imageReferences.some((reference) => reference.title === "DAPOT Custom Sauce Station"), "custom qualified asset tags like $dapot.special_sauce should resolve to the edited asset meta token");
  assert(dapotRefs.finalPrompt.includes("Eat the World in One Hot Pot") && dapotRefs.finalPrompt.includes("DAPOT"), "DAPOT resolved prompt should include brand text context");
  assert(dapotRefs.warnings.length === 0, `DAPOT CAL references should resolve without warnings: ${dapotRefs.warnings.join("; ")}`);
  const ratioParamRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "@imgen /生成视频 使用 $dapot.logo，为 DAPOT 生成 20 秒 9:16 促销短视频 语言: Thai -> mp4",
      brandId: dapotBrand.id,
      brandInject: false
    })
  });
  assert(!("9" in ratioParamRefs.params) && ratioParamRefs.params["语言"] === "Thai", "CAL parser should keep language params but not misread 9:16 aspect ratio as a numeric parameter");

  const asset = await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke Product",
      type: "product",
      brandId: brand.id,
      color: "#f97316",
      meta: "smoke asset",
      imageUrl: "/brand-assets/generated/xmanx-product.png"
    })
  });
  assert(asset.title === "Smoke Product", "asset creation failed");

  const updatedAsset = await request(`/assets/${asset.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Smoke Product Edited", meta: "smoke asset edited", type: "model" })
  });
  assert(updatedAsset.title === "Smoke Product Edited" && updatedAsset.meta === "smoke asset edited" && updatedAsset.type === "model", "asset edit should persist");

  await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke Logo Image",
      type: "logo",
      brandId: brand.id,
      color: "#111827",
      meta: "$logo · smoke logo image",
      imageUrl: "/brand-assets/generated/xmanx-logo.png"
    })
  });
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke IP Image",
      type: "model",
      brandId: brand.id,
      color: "#f97316",
      meta: "$ip · smoke IP image",
      imageUrl: "/brand-assets/generated/xmanx-ip.png"
    })
  });
  const uploadedBrandImage = await uploadAssetImage({
    title: "Smoke Supplemental Brand Upload",
    type: "upload",
    brandId: brand.id,
    color: "#64748b",
    meta: "$storefront · supplemental brand reference"
  });
  assert(uploadedBrandImage.brandId === brand.id && uploadedBrandImage.imageUrl?.startsWith("/generated/brand-assets/"), "binary brand upload should be stored as a generated file URL");
  const replacedBrandImage = await uploadAssetImage({
    assetId: uploadedBrandImage.id,
    title: "Smoke Supplemental Brand Upload Replaced",
    type: "upload",
    brandId: brand.id,
    color: "#64748b",
    meta: "$storefront · replaced brand reference"
  });
  assert(replacedBrandImage.id === uploadedBrandImage.id && replacedBrandImage.imageUrl !== uploadedBrandImage.imageUrl, "brand slot replacement should patch the existing asset image instead of creating a duplicate");
  const workspaceAfterBrandUpload = await request("/workspace");
  const reloadedBrandUpload = workspaceAfterBrandUpload.assets.find((item) => item.id === uploadedBrandImage.id);
  assert(reloadedBrandUpload?.imageUrl?.startsWith("/generated/brand-assets/") && reloadedBrandUpload.title.includes("Replaced"), "uploaded brand image should persist and reload through workspace");
  const uploadedImageResponse = await fetch(`${baseUrl}${reloadedBrandUpload.imageUrl}`);
  assert(uploadedImageResponse.ok && uploadedImageResponse.headers.get("content-type")?.includes("image"), "uploaded brand image URL should render as an image");

  const plannerPrompt = '@imgen /生成海报 使用 $model，显示 "会员免费锅底"，画面中心写 $copy.slogan，再加入 $copy.brand_name，主题 %高级感 尺寸: 1080x1350 -> 海报';
  const resolvedRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: plannerPrompt,
      brandId: brand.id,
      brandInject: true
    })
  });
  assert(resolvedRefs.imageReferences.some((reference) => reference.role === "model" && reference.imageUrl), "resolved CAL resources should expose concrete image references");
  assert(resolvedRefs.agents.includes("imgen"), "@imgen should be parsed as the image generation API agent");
  assert(resolvedRefs.textReferences.some((reference) => reference.key.endsWith(".copy.slogan") && reference.value === brand.slogan), "$copy.slogan should resolve to current brand slogan");
  assert(resolvedRefs.lockedTexts.includes("会员免费锅底") && resolvedRefs.tags.includes("高级感") && resolvedRefs.params["尺寸"] === "1080x1350", "CAL parser should extract locked text, tags and params");
  assert(resolvedRefs.prompt.includes(`"${brand.slogan}"`) && resolvedRefs.finalPrompt.includes("图片资源"), "resolved payload should expand text and keep image reference summary");

  const plannerPlan = await request("/ai/plan", {
    method: "POST",
    body: JSON.stringify({
      prompt: plannerPrompt,
      brandId: brand.id,
      brandInject: true,
      settings: { ratio: "4:5", count: 1, quality: "hd", strength: 70, duration: 0, contentLanguage: "zh-en" }
    })
  });
  assert(plannerPlan.version === "planner-plan/0.1" && plannerPlan.steps.length >= 5, "planner endpoint should return a multi-step plan");
  assert(plannerPlan.context.brandId === brand.id && plannerPlan.context.injected === true, "planner endpoint should preserve explicit brand injection context");
  assert(plannerPlan.steps.some((step) => step.stage === "generation" && /Generate/i.test(step.title)), "planner endpoint should emit generation steps");

  const canvasPlan = await request("/ai/canvas-plan", {
    method: "POST",
    body: JSON.stringify({
      prompt: plannerPrompt,
      brandId: brand.id,
      brandInject: true,
      settings: { ratio: "4:5", count: 1, quality: "hd", strength: 70, duration: 0, contentLanguage: "zh-en" }
    })
  });
  assert(canvasPlan.version === "canvas-plan/0.1" && canvasPlan.nodes.length >= plannerPlan.steps.length, "canvas-plan endpoint should expose graph nodes for planner steps");
  assert(canvasPlan.nodes.some((node) => node.stage === "generation") && canvasPlan.edges.length >= 3, "canvas-plan endpoint should expose planner graph connectivity");

  const workflowBridge = await request("/ai/workflow-bridge", {
    method: "POST",
    body: JSON.stringify({
      prompt: plannerPrompt,
      brandId: brand.id,
      brandInject: true,
      settings: { ratio: "4:5", count: 1, quality: "hd", strength: 70, duration: 0, contentLanguage: "zh-en" }
    })
  });
  assert(workflowBridge.plan?.version === "planner-plan/0.1" && workflowBridge.canvasPlan?.version === "canvas-plan/0.1", "workflow bridge should expose planner and canvas-plan payloads");
  assert(workflowBridge.workflowNodes.some((node) => node.id === "visual-draft"), "workflow bridge should map planner generation into the main workflow nodes");
  assert(workflowBridge.workflowNodes.some((node) => node.id === "visual-draft" && node.title && node.title !== "Image"), "workflow bridge should expose planner-derived generation node titles");
  assert(workflowBridge.workflowNodes.find((node) => node.id === "prompt")?.title !== "Prompt", "workflow bridge should override core node metadata with planner-aware titles");
  const prefixRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "同时参考 $logo 和 $logo.hero",
      brandId: brand.id,
      brandInject: false
    })
  });
  assert(prefixRefs.prompt.includes("参考图片") && prefixRefs.prompt.includes("$logo.hero"), "CAL token replacement should not let $logo corrupt $logo.hero");
  const unbrandedRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "参考 $logo 生成一张无品牌测试图",
      brandId: null,
      brandInject: false
    })
  });
  assert(unbrandedRefs.brandId === "" && unbrandedRefs.imageReferences.length === 0 && unbrandedRefs.warnings.some((warning) => warning.includes("当前项目未绑定品牌")), "brandId null should not fall back to the active brand for unqualified $ refs");
  const unbrandedOptimized = await request("/ai/transform-text", {
    method: "POST",
    body: JSON.stringify({
      text: "马",
      action: "optimize",
      brandId: null,
      outputTarget: "jpg",
      contentLanguage: "none"
    })
  });
  assert(!/XMANX|xmanx|AI launch kit/i.test(unbrandedOptimized.text), "brandId null prompt optimization should stay prompt-only and not inject the active brand");
  const explicitUnbrandedRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "参考 $xmanx.logo 和 $dapot.ip 生成一张跨品牌测试图，同时保留 $logo 未解析",
      brandId: null,
      brandInject: false
    })
  });
  assert(explicitUnbrandedRefs.imageReferences.some((reference) => reference.description.includes("xmanx.logo") && reference.role === "logo" && reference.imageUrl), "brandId null should still resolve explicit cross-brand $xmanx.logo refs");
  assert(explicitUnbrandedRefs.imageReferences.some((reference) => reference.description.includes("dapot.ip") && reference.role === "ip" && reference.imageUrl), "brandId null should still resolve explicit cross-brand $dapot.ip refs");
  assert(explicitUnbrandedRefs.prompt.includes("$logo") && explicitUnbrandedRefs.warnings.some((warning) => warning.includes("当前项目未绑定品牌") && warning.includes("$logo")), "brandId null should keep unqualified $logo unresolved without active-brand fallback");
  const storefrontRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "参考 $storefront 生成门店活动首图",
      brandId: brand.id,
      brandInject: false
    })
  });
  assert(storefrontRefs.imageReferences.some((reference) => reference.imageUrl === replacedBrandImage.imageUrl && reference.role === "storefront"), "$storefront should resolve to the uploaded brand slot image");

  const legacyRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "参考 @LOGO 和 @IP，标题用 @品牌，风格参考 @视觉风格",
      brandId: brand.id,
      brandInject: true
    })
  });
  assert(legacyRefs.imageReferences.some((reference) => reference.role === "logo" && reference.imageUrl), "legacy @LOGO should resolve to logo image reference");
  assert(legacyRefs.imageReferences.some((reference) => reference.role === "ip" && reference.imageUrl), "legacy @IP should resolve to IP image reference");
  assert(legacyRefs.textReferences.some((reference) => reference.key.endsWith(".copy.brand_name") && reference.value === brand.name), "legacy @品牌 should resolve to $copy.brand_name text reference");

  const emptyFrame = await request("/canvas/frames", {
    method: "POST",
    body: JSON.stringify({ brandId: brand.id })
  });
  assert(emptyFrame.workflowNodes.length === 0 && emptyFrame.outputs.length === 0 && emptyFrame.prompt === "", "new canvas should start from a truly empty frame");
  const unbrandedEmptyFrame = await request("/canvas/frames", {
    method: "POST",
    body: JSON.stringify({ title: "Unbranded Empty Canvas" })
  });
  assert(unbrandedEmptyFrame.brandId === "" && unbrandedEmptyFrame.brandName === "无品牌" && unbrandedEmptyFrame.workflowNodes.length === 0, "new canvas without an explicit brand should stay unbranded and empty");
  const emptyFrameSettings = await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({ settings: { ratio: "4:5", count: 1, quality: "hd", strength: 72, brandInject: true, contentLanguage: "zh-th" } })
  });
  assert(emptyFrameSettings.workflowNodes.length === 0, "settings changes on empty canvas must not inject default nodes");
  assert(emptyFrameSettings.settings.contentLanguage === "zh-th", "content language setting should persist on empty canvas");
  const emptyFrameLegacyCoreCleanup = await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      workflowNodes: [
        { id: "input-image", type: "image", title: "Reference", body: "", x: 0, y: 0 },
        { id: "brand", type: "brand", title: "Brand", body: "", parentId: "input-image", x: 260, y: 0 },
        { id: "prompt", type: "prompt", title: "Prompt", body: "", parentId: "brand", x: 520, y: 0 },
        { id: "output", type: "output", title: "Output", body: "", parentId: "prompt", x: 780, y: 0 }
      ],
      outputs: []
    })
  });
  assert(emptyFrameLegacyCoreCleanup.workflowNodes.length === 0, "legacy auto core nodes should be cleaned from empty canvases");

  const tempAsset = await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Temporary Cleanup Asset",
      type: "upload",
      brandId: brand.id,
      color: "#64748b",
      meta: "delete cleanup fixture",
      imageUrl: "data:image/svg+xml;base64,PHN2Zy8+"
    })
  });
  await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      workflowNodes: [{
        id: "node_asset_cleanup",
        type: "reference",
        title: "Cleanup Ref",
        body: "",
        refs: [
          { id: `asset_${tempAsset.id}_${Date.now().toString(36)}`, role: "upload", title: tempAsset.title, description: tempAsset.meta, color: tempAsset.color, imageUrl: tempAsset.imageUrl }
        ],
        x: 0,
        y: 0
      }]
    })
  });
  await request(`/assets/${tempAsset.id}`, { method: "DELETE" });
  const cleanupWorkspace = await request("/workspace");
  const cleanupFrame = cleanupWorkspace.frames.find((frame) => frame.id === emptyFrame.id);
  assert(cleanupFrame.workflowNodes.every((node) => !(node.refs ?? []).some((ref) => ref.id.startsWith(`asset_${tempAsset.id}`) || ref.imageUrl === tempAsset.imageUrl)), "asset deletion should clean derived canvas refs");

  const lifecycleBrand = await request("/brands", {
    method: "POST",
    body: JSON.stringify({
      name: "Lifecycle Smoke",
      logoText: "LS",
      primaryColor: "#111827",
      accentColor: "#22c55e",
      tone: "clean QA brand",
      market: "test"
    })
  });
  const lifecycleAsset = await request("/assets", {
    method: "POST",
    body: JSON.stringify({ title: "Lifecycle Logo", type: "logo", brandId: lifecycleBrand.id, color: "#22c55e", meta: "$logo lifecycle", imageUrl: "/brand-assets/generated/xmanx-logo.png" })
  });
  const archivedBrand = await request(`/brands/${lifecycleBrand.id}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true })
  });
  assert(archivedBrand.archived === true && archivedBrand.active === false, "brand archive should deactivate the brand");
  const deletedBrand = await request(`/brands/${lifecycleBrand.id}`, { method: "DELETE" });
  assert(deletedBrand.ok === true && deletedBrand.removedAssets >= 1, "brand deletion should remove associated assets");
  const afterBrandDelete = await request("/workspace");
  assert(!afterBrandDelete.brands.some((item) => item.id === lifecycleBrand.id), "deleted brand should be removed from workspace");
  assert(!afterBrandDelete.assets.some((item) => item.id === lifecycleAsset.id), "brand deletion should remove associated assets from workspace");

  const plainImageNode = {
    id: "node_plain_horse",
    type: "image",
    title: "Image",
    body: "马",
    preview: "#f97316",
    refs: [],
    x: 120,
    y: 160,
    w: 250,
    h: 300
  };
  const frameWithPlainNode = await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      settings: { ratio: "1:1", count: 1, quality: "hd", strength: 70, brandInject: false },
      workflowNodes: [plainImageNode]
    })
  });
  assert(frameWithPlainNode.workflowNodes.length === 1 && frameWithPlainNode.workflowNodes[0].body === "马", "plain prompt image node should stay on empty canvas");
  const plainGeneratedNode = await request(`/canvas/frames/${emptyFrame.id}/nodes/${plainImageNode.id}/generate`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "马",
      modelId: "vdamo-gpt-image-2",
      settings: { ratio: "1:1", count: 1, quality: "hd", strength: 70, brandInject: false }
    })
  });
  assert(plainGeneratedNode.node.body.startsWith("马\n模型:"), "plain prompt generation should not prepend brand workflow context");
  assert(!plainGeneratedNode.node.body.includes("XMANX") && !plainGeneratedNode.node.body.includes("xmanx.com"), "plain prompt generation should not include XMANX unless referenced");
  assert(plainGeneratedNode.node.refs?.[0]?.imageUrl?.startsWith("data:image/svg+xml") || plainGeneratedNode.node.refs?.[0]?.imageUrl?.startsWith("/generated/"), "generated image node should keep a displayable image on canvas");
  const invalidImageModel = await fetch(`${baseUrl}/canvas/frames/${emptyFrame.id}/nodes/${plainImageNode.id}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: "马", modelId: "yijiarj-grok-video-720p" })
  });
  assert(invalidImageModel.status === 400, "image node generation should reject non-image models");
  const plainAudioNode = {
    id: "node_plain_audio",
    type: "audio",
    title: "Audio",
    body: "simple beat",
    parentId: plainImageNode.id,
    preview: "#7c3aed",
    x: 420,
    y: 160,
    w: 230,
    h: 238
  };
  await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({ workflowNodes: [plainGeneratedNode.node, plainAudioNode] })
  });
  const plainAudioGenerated = await request(`/canvas/frames/${emptyFrame.id}/nodes/${plainAudioNode.id}/generate-audio`, {
    method: "POST",
    body: JSON.stringify({ prompt: "simple beat", model: "gpt-5.4-mini", settings: { mode: "配乐", duration: "15s", scene: "广告短视频", loop: false, translate: false } })
  });
  assert(/品牌约束:\s*无品牌/.test(plainAudioGenerated.audioPlan), `unbranded audio nodes should stay unbranded: ${plainAudioGenerated.audioPlan}`);
  assert(!plainAudioGenerated.audioPlan.includes("XMANX") && !plainAudioGenerated.audioPlan.includes("xmanx.com"), "unbranded audio nodes should not inject XMANX unless referenced");

  const promptOnlyGenerated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: "@imgen /生成海报 马 -> 图片",
      mode: "magic",
      modelId: "vdamo-gpt-image-2",
      brandId: null,
      brandInject: false,
      settings: { ratio: "1:1", count: 1, quality: "hd", strength: 70, duration: 0, brandInject: false },
      x: 180,
      y: 180
    })
  });
  const promptOnlyCompleted = await waitForTask(promptOnlyGenerated.taskId);
  const promptOnlyRefs = promptOnlyCompleted.frame.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [];
  assert(promptOnlyCompleted.frame.brandId === "" && promptOnlyCompleted.frame.brandInjected === false, "plain one-line generation should remain unbranded");
  assert(promptOnlyRefs.length === 0, "plain one-line generation should not attach XMANX refs when no brand is selected or mentioned");
  assert(!promptOnlyCompleted.frame.finalPrompt.includes("XMANX") && !promptOnlyCompleted.frame.finalPrompt.includes("xmanx.com"), "plain one-line final prompt should not contain hidden XMANX context");
  assert(promptOnlyCompleted.frame.workflowNodes.find((node) => node.id === "prompt")?.title === "Interpret intent", "main generate flow should apply planner metadata to core prompt node");
  assert(promptOnlyCompleted.frame.workflowNodes.some((node) => node.type === "output" && /Package|输出/.test(node.title)), "main generate flow should use planner-derived output nodes instead of default generic output naming");

  const inferredBrandGenerated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: "为 xmanx 生成一个 5.1 促销海报",
      mode: "magic",
      modelId: "vdamo-gpt-image-2",
      settings: { ratio: "4:5", count: 1, quality: "hd", strength: 70, duration: 0 },
      x: 260,
      y: 200
    })
  });
  const inferredBrandCompleted = await waitForTask(inferredBrandGenerated.taskId);
  const inferredRefs = inferredBrandCompleted.frame.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [];
  assert(inferredBrandCompleted.frame.brandId === brand.id && inferredBrandCompleted.frame.brandInjected === true, "natural language one-line generation should infer and inject XMANX");
  assert(inferredRefs.length >= 3 && inferredRefs.every((ref) => ref.imageUrl), "inferred brand workflow should place concrete brand images on canvas");
  assert(inferredBrandCompleted.frame.workflowNodes.some((node) => node.id === "prompt" && node.body.includes("5.1")), "one-line generation should create a full workflow prompt node");

  const pngOutputGenerated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: "为 xmanx 生成 5.1 活动竖屏 PNG",
      mode: "magic",
      modelId: "vdamo-gpt-image-2",
      outputTarget: "png",
      orientation: "portrait",
      settings: { ratio: "9:16", count: 1, quality: "hd", strength: 70, duration: 0, contentLanguage: "zh-th" },
      x: 280,
      y: 220
    })
  });
  const pngOutputCompleted = await waitForTask(pngOutputGenerated.taskId);
  assert(pngOutputCompleted.frame.outputs.some((output) => output.kind === "image" && output.title.includes("PNG")), "PNG output target should create a PNG-labeled image output");
  assert(pngOutputCompleted.frame.settings.ratio === "9:16", "PNG preset ratio should persist to workflow settings");
  assert(pngOutputCompleted.frame.settings.contentLanguage === "zh-th" && pngOutputCompleted.frame.prompt.includes("Chinese + Thai"), "workflow optimizer should keep selected content language in CAL prompt");

  const multiOutputGenerated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: "@imgen /生成海报 使用 $logo $ip $product，为 xmanx 生成 5.1 活动教材和短视频 -> pdf 和 mp4",
      mode: "magic",
      modelId: "vdamo-gpt-image-2",
      settings: { ratio: "16:9", count: 1, quality: "hd", strength: 70, duration: 8 },
      x: 300,
      y: 240
    })
  });
  const multiOutputCompleted = await waitForTask(multiOutputGenerated.taskId);
  assert(multiOutputCompleted.task.progress === 100 && multiOutputCompleted.frame.progress === 100, "multi-output workflow should finish at 100%, not stay at 96%");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id === "visual-draft" && /Generate/i.test(node.title)), "multi-output workflow should keep planner-driven visual draft node for shared generation");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.type === "process" && node.title.includes("PDF")), "planner-driven workflow should add a PDF process node before output packaging");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.type === "script" && /Generate MP4|视频脚本/i.test(node.title)), "planner-driven workflow should add a video script/generation branch for mp4 outputs");
  assert(multiOutputCompleted.frame.outputs.some((output) => output.kind === "document" && output.title.includes("PDF")), "CAL -> pdf should create a document output");
  assert(multiOutputCompleted.frame.outputs.some((output) => output.kind === "document" && output.fileUrl?.endsWith(".pdf")), "CAL -> pdf should generate a downloadable PDF artifact");
  const pdfOutput = multiOutputCompleted.frame.outputs.find((output) => output.kind === "document");
  const pdfResponse = await fetch(`${baseUrl}${pdfOutput.fileUrl}`);
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  assert(pdfResponse.ok && pdfResponse.headers.get("content-type")?.includes("application/pdf"), "PDF artifact should download as application/pdf");
  assert(pdfBuffer.subarray(0, 4).toString() === "%PDF" && pdfBuffer.includes(Buffer.from("/Subtype /Image")), "PDF artifact should be a real image-composed PDF, not a PNG preview");
  assert(pdfOutput.copy.includes("PDF 已合成"), "PDF output should tell users that canvas images were composed into the PDF");
  assert(multiOutputCompleted.frame.outputs.some((output) => output.kind === "video" && output.title.includes("MP4")), "CAL -> mp4 should create a video output");
  assert(multiOutputCompleted.frame.outputs.every((output) => output.imageUrl && (output.copy.includes("预览") || output.kind === "image" || output.fileUrl || output.videoId || output.videoUrl)), "every workflow output should have a visible preview or concrete artifact status");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id.startsWith("doc-pdf") && node.type === "process"), "CAL -> pdf should create an editable document/text node");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id.startsWith("video-mp4") && node.type === "video"), "CAL -> mp4 should create a video generation node");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id === "visual-draft" && node.refs?.some((ref) => ref.imageUrl)), "multi-output workflow should place a visible visual draft on the canvas");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id === "visual-draft" && node.body.startsWith("CAL: @imgen")), "visual draft should expose the executable CAL line to users");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id === "output-pdf" && node.refs?.some((ref) => ref.imageUrl)), "PDF output node should show a preview reference");
  assert(multiOutputCompleted.frame.workflowNodes.some((node) => node.id === "output-mp4" && node.refs?.some((ref) => ref.imageUrl)), "MP4 output node should show a preview reference");
  assert(multiOutputCompleted.frame.outputs.some((output) => output.kind === "video" && /MP4|视频/.test(output.copy)), "MP4 output should record video execution status");
  assert(multiOutputCompleted.frame.steps.some((step) => step.includes("PDF") && step.includes("MP4")), "workflow steps should mention requested PDF and MP4 outputs");
  const longVideoGenerated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: "@imgen /生成视频 使用 $logo $ip，为 xmanx 生成 20 秒品牌短视频 -> mp4",
      mode: "magic",
      modelId: "vdamo-gpt-image-2",
      outputTarget: "mp4",
      orientation: "landscape",
      settings: { ratio: "16:9", count: 1, quality: "hd", strength: 70, duration: 20, contentLanguage: "zh-en" },
      x: 320,
      y: 260
    })
  });
  const longVideoCompleted = await waitForTask(longVideoGenerated.taskId);
  const segmentNodes = longVideoCompleted.frame.workflowNodes.filter((node) => node.type === "video" && node.id.includes("-seg-"));
  const composeGraphNode = longVideoCompleted.frame.workflowNodes.find((node) => node.type === "compose" && node.id.startsWith("compose-mp4"));
  const scriptGraphNode = longVideoCompleted.frame.workflowNodes.find((node) => node.type === "script" && node.id.startsWith("script-mp4"));
  assert(segmentNodes.length >= 2, "20s MP4 workflow should create at least two video segment nodes");
  assert(scriptGraphNode && segmentNodes.every((node) => node.parentId === scriptGraphNode.id), "video segments should fan out from the script node instead of chaining segment to segment");
  assert(composeGraphNode?.inputIds?.length === segmentNodes.length && composeGraphNode.inputIds.every((id) => segmentNodes.some((node) => node.id === id)), "compose node should explicitly merge all video segment inputs");
  const mp4OutputNode = await request(`/canvas/frames/${multiOutputCompleted.frame.id}/nodes/output-mp4/generate-video`, {
    method: "POST",
    body: JSON.stringify({ prompt: "刷新 MP4 输出任务", model: "grok-imagine-1.0-video-super-720p", settings: { mode: "图生视频", ratio: "16:9 · 720P", duration: "5s", sound: true, translate: false, contentLanguage: "zh-th" } })
  });
  assert(mp4OutputNode.node.id === "output-mp4" && mp4OutputNode.node.type === "output", "MP4 output node generation should keep the node as an output node");
  assert(mp4OutputNode.frame.outputs.some((output) => output.kind === "video" && /执行状态|视频任务|MP4/.test(output.copy)), "MP4 output node should update the video output status instead of calling image generation");
  assert(mp4OutputNode.videoPlan.includes("Video language: Chinese + Thai") && mp4OutputNode.videoPlan.includes("语言: Chinese + Thai"), "video generation prompt should carry content language");
  assert(mp4OutputNode.videoPlan.includes("Storyboard plan") && mp4OutputNode.videoPlan.includes("首帧") && mp4OutputNode.videoPlan.includes("关键帧") && mp4OutputNode.videoPlan.includes("引用素材"), "MP4 output plan should expose first-frame, keyframe and reference-image continuity controls");

  const beforeRerunWorkspace = await request("/workspace");
  const beforeRerunFrameCount = beforeRerunWorkspace.frames.length;
  const rerun = await request(`/canvas/frames/${multiOutputCompleted.frame.id}/run`, {
    method: "POST",
    body: JSON.stringify({
      modelId: "vdamo-gpt-image-2",
      settings: { ratio: "16:9", count: 1, quality: "hd", strength: 72, duration: 8, contentLanguage: "zh-th" }
    })
  });
  assert(rerun.frame.id === multiOutputCompleted.frame.id && rerun.task.frameId === multiOutputCompleted.frame.id, "current workflow rerun should keep the existing canvas frame id");
  const rerunCompleted = await waitForTask(rerun.taskId);
  const afterRerunWorkspace = await request("/workspace");
  assert(afterRerunWorkspace.frames.length === beforeRerunFrameCount, "current workflow rerun must not create a new project/canvas");
  assert(rerunCompleted.frame.outputs.some((output) => output.kind === "document" && output.fileUrl?.startsWith("/generated/") && output.fileUrl.endsWith(".pdf")), "rerun PDF output should remain a real downloadable PDF");
  assert(rerunCompleted.frame.workflowNodes.some((node) => node.id === "output-pdf" && node.refs?.some((ref) => ref.role === "document-preview" && ref.imageUrl)), "rerun PDF node should keep a document-preview image ref");

  const generated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: '@imgen /生成海报 使用 $model $logo，显示 $copy.slogan，为 xmanx.com 黑橙色运动鞋生成首发海报，主题 %新品上市',
      mode: "magic",
      modelId: "vdamo-gpt-image-2",
      brandId: brand.id,
      brandInject: true,
      settings: { ratio: "4:5", count: 2, quality: "hd", strength: 66, duration: 0, brandInject: true },
      x: 360,
      y: 220
    })
  });
  assert(generated.credits < login.user.credits, "credits should be deducted");

  const completed = await waitForTask(generated.taskId);
  assert(completed.frame.progress === 100, "completed frame should reach 100%");
  assert(completed.frame.modelName === "VDAMO · GPT Image 2", "selected VDAMO image model should be stored on the frame");
  assert(completed.frame.brandId === brand.id && completed.frame.brandInjected === true, "generated frame should store brand injection state");
  assert(completed.frame.brandContext.includes("XM Smoke IP"), "brand context should include IP details");
  assert(completed.frame.finalPrompt.includes("$copy.brand_name XMANX Smoke") && completed.frame.finalPrompt.includes("【本次任务】"), "final prompt should include code-style organized brand context");
  assert(completed.frame.finalPrompt.includes("【资源解析】") && completed.frame.finalPrompt.includes("AI launch kit for xmanx.com"), "final prompt should resolve CAL image refs and text refs");
  assert(completed.frame.workflowNodes?.some((node) => node.type === "prompt" && node.body.includes("xmanx.com")), "workflow should expose the prompt node");
  assert(completed.frame.workflowNodes?.some((node) => node.type === "image"), "workflow should expose an image input node");
  const inputRefs = completed.frame.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [];
  assert(inputRefs.length >= 1 && inputRefs.every((ref) => ref.imageUrl), "workflow should auto-build concrete image references only");
  assert(!completed.frame.workflowNodes.some((node) => node.id?.startsWith("ref-")), "workflow should keep brand references grouped in one multi-image node by default");
  assert(completed.frame.steps.some((step) => step.includes("XMANX Smoke")), "Brand Agent should inject active brand");

  const editedWorkflowNodes = completed.frame.workflowNodes.map((node) => (
    node.id === "input-image"
      ? { ...node, title: "可编辑参考图", body: "可编辑参考图：Logo / IP / 模特 / 批量商品素材", preview: "#22c55e", x: 88, y: 188, w: 286, h: 248, edgeOffsetY: 37, refs: [...node.refs, { id: "ref_smoke_model", role: "model", title: "Smoke 模特参考", description: "用于测试多图参考编辑", color: "#22c55e", imageUrl: "data:image/svg+xml;base64,PHN2Zy8+" }, { id: "ref_smoke_png_upload", role: "reference", title: "Smoke PNG Upload", description: "用于测试节点上传图落盘", color: "#0ea5e9", imageUrl: `data:image/png;base64,${tinyPngBase64}` }] }
      : node.id === "brand"
        ? { ...node, body: `${completed.frame.brandContext}\n项目微调：本批图片强调绿色上线活动。` }
        : node
  ));
  editedWorkflowNodes.splice(1, 0, {
    id: "node_smoke_reference",
    type: "reference",
    title: "新增参考节点",
    body: "插入在商品和品牌之间的补充参考。",
    preview: "#22c55e",
    x: 310,
    y: 500
  });
  editedWorkflowNodes.push(
    { id: "node_smoke_text", type: "process", title: "文本故事", body: "把首发海报拆成三幕故事", parentId: "prompt", preview: "#2563eb", x: 590, y: 500 },
    { id: "node_smoke_script", type: "script", title: "脚本", body: "黑橙运动鞋 10 秒短片", parentId: "node_smoke_text", preview: "#f97316", x: 860, y: 500 },
    { id: "node_smoke_video", type: "video", title: "视频", body: "把脚本生成产品短视频", parentId: "node_smoke_script", preview: "#111827", x: 1130, y: 500 },
    { id: "node_smoke_compose", type: "compose", title: "视频合成", body: "合成多个视频节点", parentId: "node_smoke_video", preview: "#0f766e", x: 1400, y: 500 },
    { id: "node_smoke_audio", type: "audio", title: "音频", body: "生成科技感节奏配乐", parentId: "node_smoke_video", preview: "#7c3aed", x: 1400, y: 650 }
  );
  const editedOutputs = completed.frame.outputs.map((output, index) => index === 0 ? { ...output, title: "首屏主图", copy: "用于 xmanx.com 首页首屏，保留 Logo 安全边距" } : output);

  const savedWorkflow = await request(`/canvas/frames/${generated.frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      brandContext: editedWorkflowNodes.find((node) => node.id === "brand").body,
      workflowNodes: editedWorkflowNodes,
      outputs: editedOutputs,
      modelId: "vdamo-gpt-image-1",
      settings: { ratio: "16:9", width: 1280, height: 720, count: 4, quality: "ultra", strength: 88, duration: 5, brandInject: true, contentLanguage: "en-th" }
    })
  });
  assert(savedWorkflow.modelId === "vdamo-gpt-image-1" && savedWorkflow.modelName.includes("GPT Image 1"), "model switch should persist");
  assert(savedWorkflow.brandId === brand.id, `workflow save should keep selected brand: ${savedWorkflow.brandId} !== ${brand.id}`);
  assert(savedWorkflow.settings.ratio === "16:9" && savedWorkflow.settings.width === 1280 && savedWorkflow.settings.height === 720 && savedWorkflow.settings.quality === "ultra" && savedWorkflow.settings.strength === 88 && savedWorkflow.settings.contentLanguage === "en-th", "generation parameters, custom dimensions and content language should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").body.includes("可编辑参考图"), "reference node edits should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").refs.some((reference) => reference.id === "ref_smoke_model"), "multi image reference edits should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").refs.some((reference) => reference.id === "ref_smoke_model" && reference.imageUrl?.startsWith("data:image")), "uploaded reference image data should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").refs.some((reference) => reference.id === "ref_smoke_png_upload" && reference.imageUrl?.startsWith("/generated/brand-assets/")), "uploaded PNG node reference should be materialized to a file URL before saving");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").x === 88, "node drag positions should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").w === 286 && savedWorkflow.workflowNodes.find((node) => node.id === "input-image").h === 248, "node resize dimensions should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").edgeOffsetY === 37, "line drag offsets should persist");
  assert(savedWorkflow.workflowNodes.some((node) => node.id === "node_smoke_reference" && node.type === "reference"), "inserted workflow nodes should persist");
  for (const type of ["process", "script", "video", "compose", "audio"]) {
    assert(savedWorkflow.workflowNodes.some((node) => node.type === type), `${type} node should persist`);
  }
  assert(savedWorkflow.brandContext.includes("绿色上线活动"), "brand context workflow edit should persist");
  assert(savedWorkflow.outputs[0].title === "首屏主图", "output node edits should persist");

  const textNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_text/generate-text`, {
    method: "POST",
    body: JSON.stringify({ prompt: "写一段兔兔赛跑的故事剧情", model: "gpt-5.4-mini", translate: false, contentLanguage: "en-th" })
  });
  assert(textNode.node.type === "process" && !textNode.text.includes("| 镜号 |"), "text node should generate editable text, not storyboard table");
  assert(textNode.text.includes("English + Thai"), "text generation should carry selected content language");

  const legacyTextModeNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_text/generate-text`, {
    method: "POST",
    body: JSON.stringify({ prompt: "用普通文本解释 DAPOT 的品牌语气", model: "gpt-5.4-mini", translate: false, mode: "text" })
  });
  assert(legacyTextModeNode.node.type === "process" && legacyTextModeNode.mode === "story", "legacy text mode should normalize to editable story text");

  const scriptNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_script/generate-script`, {
    method: "POST",
    body: JSON.stringify({ prompt: "生成三镜头分镜表格", model: "gpt-5.4-mini", translate: false })
  });
  assert(scriptNode.script.includes("| 镜号 |") && scriptNode.node.type === "script", "script node should generate storyboard table");

  const videoNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_video/generate-video`, {
    method: "POST",
    body: JSON.stringify({ prompt: "保存文生视频配置", model: "grok-imagine-1.0-video-super-720p", settings: { mode: "文生视频", ratio: "9:16 · 720P", duration: "5s", sound: true, translate: false } })
  });
  assert(videoNode.videoPlan.includes("视频类型: 图生视频") && videoNode.node.type === "video", "canvas video node should use image-to-video when visual references or first frames exist");
  assert(videoNode.videoPlan.includes("Storyboard plan") && videoNode.videoPlan.includes("关键帧") && videoNode.videoPlan.includes("引用素材"), "video node should create a duration-aware storyboard and keyframe plan with reference controls");
  assert(videoNode.videoPlan.includes("最终成片 5s") && videoNode.videoPlan.includes("固定单次输出 10s") && videoNode.videoPlan.includes("后裁切"), "5s final video should be planned as a 10s model clip followed by trimming");
  assert(!videoNode.videoPlan.includes("720P · 5s"), "video plan should not mix final duration into the ratio selector");
  assert(videoNode.videoPlan.includes("分镜板:"), "video node should expose storyboard-board generation status before image-to-video execution");

  const composeNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_compose/generate-compose`, {
    method: "POST",
    body: JSON.stringify({ prompt: "合成 20 秒品牌短视频，统一每段旁白和转场", settings: { duration: "20s", ratio: "9:16 · 720P", contentLanguage: "zh-en", transition: "节奏点硬切 + 轻淡入淡出", audioMode: "分段旁白统一混音" } })
  });
  assert(composeNode.composePlan.includes("分段策略") && composeNode.composePlan.includes("配音规则") && composeNode.segments.length === 2, "compose node should create a multi-segment edit plan with per-segment voice/audio rules");
  assert(composeNode.segmentPlan?.every((segment) => segment.modelSeconds === 10) && composeNode.composePlan.includes("S1 成片10s/模型10s"), "compose node should expose fixed 10s model clip planning");
  assert(composeNode.composeVerification?.continuityChecks?.some((line) => line.includes("连续性校验")) && composeNode.composePlan.includes("合成校验"), "compose node should surface continuity verification in the plan");

  const smokeVideoA = await createSmokeVideo("smoke-a.mp4", "red");
  const smokeVideoB = await createSmokeVideo("smoke-b.mp4", "blue");
  if (smokeVideoA && smokeVideoB) {
    const composeFrameWithVideos = {
      ...composeNode.frame,
      workflowNodes: [
        ...composeNode.frame.workflowNodes.map((node) => {
          if (node.id === "node_smoke_video") return { ...node, videoId: "smoke-a", videoUrl: smokeVideoA };
          if (node.id === "node_smoke_compose") {
            return {
              ...node,
              inputIds: ["node_smoke_video", "node_smoke_video_b"],
              refs: [
                ...(node.refs ?? []),
                { id: "smoke_video_a", role: "generated-video", title: "历史视频 A", description: "smoke local mp4", color: "#ef4444", imageUrl: smokeVideoA },
                { id: "smoke_video_b", role: "generated-video", title: "历史视频 B", description: "smoke local mp4", color: "#3b82f6", imageUrl: smokeVideoB }
              ]
            };
          }
          return node;
        }),
        { id: "node_smoke_video_b", type: "video", title: "Smoke video B", body: "第二段 smoke MP4", parentId: "node_smoke_script", videoId: "smoke-b", videoUrl: smokeVideoB, preview: "#3b82f6" }
      ]
    };
    await request(`/canvas/frames/${generated.frame.id}`, {
      method: "PATCH",
      body: JSON.stringify({ workflowNodes: composeFrameWithVideos.workflowNodes })
    });
    const mergedComposeNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_compose/generate-compose`, {
      method: "POST",
      body: JSON.stringify({ prompt: "用历史生成视频裁切合并 5 秒成片", settings: { duration: "5s", ratio: "16:9 · 720P", contentLanguage: "zh-en", transition: "硬切", audioMode: "统一混音" } })
    });
    assert(mergedComposeNode.mergedUrl?.startsWith("/generated/") && mergedComposeNode.composePlan.includes("已用 ffmpeg 完成裁切/合成"), "compose node should trim and merge historical generated MP4 files into a final local MP4");
    assert(mergedComposeNode.composeVerification?.ok === true && mergedComposeNode.composeVerification?.materializedSegments >= 1, "compose node should return explicit successful verification for the merged MP4 branch");
    const staleStatusOutputs = longVideoCompleted.frame.outputs.map((output) => output.kind === "video"
      ? { ...output, videoUrl: smokeVideoA, copy: `${output.copy} · 本地 MP4 文件无有效视频内容，已恢复为等待状态。` }
      : output);
    await request(`/canvas/frames/${longVideoCompleted.frame.id}`, {
      method: "PATCH",
      body: JSON.stringify({ outputs: staleStatusOutputs })
    });
    const cleanedVideoWorkspace = await request("/workspace");
    const cleanedVideoFrame = cleanedVideoWorkspace.frames.find((frame) => frame.id === longVideoCompleted.frame.id);
    const cleanedVideoOutput = cleanedVideoFrame.outputs.find((output) => output.kind === "video");
    assert(cleanedVideoOutput?.videoUrl === smokeVideoA && !cleanedVideoOutput.copy.includes("本地 MP4 文件无有效视频内容"), "valid local MP4 outputs should remove stale invalid-video status notes on workspace reload");
    optionalChecks.push("compose-local-mp4");
    optionalChecks.push("compose-verification");
    optionalChecks.push("video-status-cleanup");
  } else {
    optionalChecks.push("compose-local-mp4-skipped-no-ffmpeg");
  }

  const audioNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_audio/generate-audio`, {
    method: "POST",
    body: JSON.stringify({ prompt: "生成科技感节奏配乐", model: "gpt-5.4-mini", settings: { mode: "配乐", duration: "15s", scene: "广告短视频", loop: false, translate: false } })
  });
  assert(audioNode.audioPlan.includes("音频类型: 配乐") && audioNode.node.type === "audio", "audio node should save generation plan");

  const moved = await request(`/canvas/frames/${generated.frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({ x: 480, y: 260, brandInject: false })
  });
  assert(moved.x === 480 && moved.y === 260, "frame position should persist");
  assert(moved.brandId === brand.id, `frame should keep selected brand after updates: ${moved.brandId} !== ${brand.id}`);
  assert(moved.brandInjected === false && moved.brandContext === "", "brand injection toggle should hide full brand context");
  const movedInputRefs = moved.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [];
  assert(movedInputRefs.length > 0 && movedInputRefs.some((ref) => ["logo", "model"].includes(ref.role)) && movedInputRefs.some((ref) => ref.id === "ref_smoke_png_upload"), "brand-off workflow should keep explicit CAL references plus user-added canvas uploads, not the whole hidden brand package");
  assert(moved.finalPrompt.includes("AI launch kit for xmanx.com") && !moved.finalPrompt.includes("$copy.brand_name XMANX Smoke"), `resource references should still resolve without full brand context injection: ${moved.finalPrompt}`);

  const after = await request("/workspace");
  const migratedEmptyFrame = after.frames.find((frame) => frame.id === emptyFrame.id);
  const reloadedSavedFrame = after.frames.find((frame) => frame.id === generated.frame.id);
  const reloadedInputRefs = reloadedSavedFrame?.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [];
  assert(reloadedInputRefs.some((ref) => ref.id === "ref_smoke_png_upload" && ref.imageUrl?.startsWith("/generated/brand-assets/")), "materialized uploaded PNG reference should survive workspace reload without base64");
  assert(migratedEmptyFrame?.workflowNodes.some((node) => node.id === plainImageNode.id && node.refs?.length), "workspace should keep generated image nodes on canvas");
  assert(after.assets.length === initial.assets.length + 11, "only manually created brand materials should be added to assets");
  assert(after.frames[0].status === "success", "latest frame should be successful");

  const exported = await request("/workspace/export");
  assert(exported.domain === "xmanx.com", "workspace export should include production domain");
  assert(Array.isArray(exported.workspace?.brands) && exported.workspace.brands.length > 0, "workspace export should include brands");
  assert(Array.isArray(exported.workspace?.frames) && exported.workspace.frames.length > 0, "workspace export should include frames");
  assert(exported.workspace.frames.some((frame) => frame.id === generated.frame.id), "workspace export should include the generated smoke frame");

  console.log(JSON.stringify({
    ok: true,
    checked: ["auth-gate", "login", "bad-login", "json-validation", "api-boundaries", "demo-credit-refill", "brand", "brand-lifecycle", "dapot-brand-profile", "brand-image-upload", "brand-image-replace", "asset", "asset-edit", "asset-delete-cleanup", "ai-status", "ai-diagnostics", "model-diagnostics", "resolve-references", "custom-qualified-asset-tag", "cal-token-boundary", "legacy-reference-alias", "content-language", "model", "model-type-guard", "parameters", "workflow-nodes", "workflow-upload-materialization", "workflow-rerun", "node-resize", "line-offset", "output-presets", "pdf-artifact", "video-output-node", "text", "legacy-text-mode", "script", "video", "compose", "audio", "generate", "task", "canvas", "export", "export-structure", ...optionalChecks],
    latestFrame: after.frames[0].title,
    credits: after.user.credits
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(tempDir, { recursive: true, force: true });
}
