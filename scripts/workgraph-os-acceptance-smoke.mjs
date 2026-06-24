import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4298;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "workgraph-os-acceptance-"));
const workGraphOsDbFile = path.join(tempDir, "data", "db", "workgraph-os.sqlite");
let token = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    PORT: String(port),
    SPARKCANVAS_DATA_FILE: path.join(tempDir, "sparkcanvas.json"),
    WORKGRAPH_OS_DATA_FILE: path.join(tempDir, "workgraph-os.json"),
    WORKGRAPH_OS_HISTORY_FILE: path.join(tempDir, "workgraph-os-history.json"),
    WORKGRAPH_OS_DB_FILE: workGraphOsDbFile,
    WORKGRAPH_OS_SNAPSHOT_FILE: path.join(tempDir, "data", "workgraph-os-object-snapshots.json"),
    WORKGRAPH_OS_PI_DIR: path.join(tempDir, ".pi"),
    WORKGRAPH_OS_GOAL_DIR: path.join(tempDir, "data", "goals"),
    WORKGRAPH_OS_SKILL_DIR: path.join(tempDir, "data", "skills"),
    WORKGRAPH_OS_ASSET_DIR: path.join(tempDir, "data", "assets"),
    WORKGRAPH_OS_BRAND_DIR: path.join(tempDir, "data", "brands"),
    WORKGRAPH_OS_RESULT_DIR: path.join(tempDir, "data", "results"),
    WORKGRAPH_OS_OUTPUT_DIR: path.join(tempDir, "data", "outputs"),
    WORKGRAPH_OS_LOG_DIR: path.join(tempDir, "data", "logs"),
    WORKGRAPH_OS_WORKFLOW_DIR: path.join(tempDir, "data", "workflows"),
    WORKGRAPH_OS_NODE_DIR: path.join(tempDir, "data", "nodes"),
    WORKGRAPH_OS_PROMPT_DIR: path.join(tempDir, "data", "prompts"),
    WORKGRAPH_OS_FEEDBACK_DIR: path.join(tempDir, "data", "feedback"),
    WORKGRAPH_OS_MEMORY_DIR: path.join(tempDir, "data", "memory"),
    WORKGRAPH_OS_MODEL_DIR: path.join(tempDir, "data", "models"),
    SPARKCANVAS_DISABLE_IMAGE_GEN: "1",
    VIDEO_GEN_BASE_URL: "https://api.yijiarj.cn/v1",
    VIDEO_GEN_KEY: "acceptance-real-yijia-key-must-stay-blocked",
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
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`server did not start\n${serverLog}`);
}

try {
  await waitForServer();
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  token = login.token;

  const prompt = "给 DAPOT 做一条泰国年轻女性喜欢的新店开业 TikTok 视频";
  const brands = await request("/workgraph-os/brands");
  assert(brands.brands?.some((brand) => brand.id === "brand_dapot" && String(brand.context).includes("Eat the World in One Hot Pot")), "acceptance should load persisted DAPOT brand context");

  await request("/workgraph-os/workspace", {
    method: "PUT",
    body: JSON.stringify({
      version: 1,
      prompt,
      activeBrandId: "brand_dapot",
      activeModelId: "vdamo-gpt-image-2",
      selectedIds: [],
      activeMaterialId: "",
      materials: [],
      skills: [],
      nodes: [],
      workflow: {
        id: "workflow-acceptance",
        title: "Acceptance workflow",
        goalId: "goal-acceptance",
        version: "0.1.0",
        status: "ready",
        reusable: true,
        prompt,
        nodeIds: [],
        edgeIds: [],
        selectedMaterialIds: [],
        skillIds: [],
        modelIds: ["vdamo-gpt-image-2"],
        resultIds: [],
        runCount: 0
      },
      goal: {
        id: "goal-acceptance",
        title: "DAPOT TikTok opening video",
        rawInput: prompt,
        normalizedIntent: prompt,
        goalType: "video_generation",
        brandId: "brand_dapot",
        outputTarget: "mp4",
        constraints: ["Thai young female audience", "preview-only first phase"],
        successCriteria: ["visible graph", "previewable video plan", "traceable feedback memory"]
      },
      jobs: [],
      results: [],
      feedback: [],
      memories: [],
      executionLog: []
    })
  });

  const plan = await request("/workgraph-os/plan", {
    method: "POST",
    body: JSON.stringify({ prompt, brandId: "dapot", activeModelId: "vdamo-gpt-image-2" })
  });
  const nodeTypes = new Set((plan.workspace?.nodes ?? []).map((node) => node.type));
  ["goal", "brand_context", "asset_search", "skill_search", "skill_create", "prompt_generate", "model_select", "skill_execute", "video_generate", "preview", "human_review", "feedback", "archive"].forEach((type) => {
    assert(nodeTypes.has(type), `acceptance graph should include ${type}`);
  });
  assert(plan.plan?.brandId === "brand_dapot", "acceptance planner should resolve DAPOT from the natural-language goal");
  assert(String(plan.workspace?.nodes?.find((node) => node.id === "brand-context")?.body).includes("DAPOT"), "acceptance planner should put DAPOT context into the graph");
  assert(plan.workspace?.nodes?.some((node) => node.id === "result-generator" && node.type === "video_generate" && String(node.body).includes("不请求付费视频接口")), "acceptance video graph should be preview-only");
  assert(plan.workspace?.skills?.some((skill) => String(skill.id).startsWith("skill-candidate-") && skill.evolution?.status === "candidate"), "acceptance planner should create a draft candidate Skill when needed");

  const skillId = plan.plan.createdSkillId;
  const skillDetail = await request(`/workgraph-os/skills/${skillId}`);
  assert(skillDetail.files?.some((file) => file.path === "SKILL.md"), "acceptance should expose SKILL.md");
  assert(skillDetail.files?.some((file) => file.path === "skill.json"), "acceptance should expose skill.json");
  assert(skillDetail.files?.some((file) => file.path === "resources/guide.md"), "acceptance should expose guide.md");
  assert(skillDetail.files?.some((file) => file.path === "examples/input.json"), "acceptance should expose examples/input.json");
  assert(skillDetail.files?.some((file) => file.path === "examples/output.json"), "acceptance should expose examples/output.json");
  assert(skillDetail.onlineSearch?.disabled === true && skillDetail.onlineSearch?.status === "planned", "acceptance online Skill search should be planned/disabled");

  const optimization = await request(`/workgraph-os/skills/${skillId}/optimize`, {
    method: "POST",
    body: JSON.stringify({ prompt: "把 DAPOT TikTok 视频分镜、泰语文案、画面提示词验收标准写清楚" })
  });
  assert(optimization.status === "preview" && optimization.writesFiles === false && String(optimization.diffPreview).includes("Proposed Optimization"), "acceptance Skill optimization should preview a diff without writing files");
  const applied = await request(`/workgraph-os/skills/${skillId}/optimize/apply`, {
    method: "POST",
    body: JSON.stringify({ prompt: "把 DAPOT TikTok 视频分镜、泰语文案、画面提示词验收标准写清楚" })
  });
  assert(applied.applied?.createdAt && applied.applied?.previousVersion && applied.applied?.version, "acceptance Skill optimization should report a version snapshot before writing");
  assert(JSON.stringify(applied.detail?.tree ?? []).includes("versions"), "acceptance Skill optimization should expose version snapshots in the Skill tree");

  await request("/workgraph-os/workspace", {
    method: "PUT",
    body: JSON.stringify({
      ...plan.workspace,
      nodes: plan.workspace.nodes.map((node) => node.id === "workflow-runner"
        ? { ...node, params: { ratio: "9:16", duration: "12s", quality: "1080p" } }
        : node),
      updatedAt: new Date().toISOString()
    })
  });
  const run = await request("/workgraph-os/run", {
    method: "POST",
    body: JSON.stringify({ nodeId: "workflow-runner", mode: "node" })
  });
  assert(run.execution?.executor === "workgraph-skill-runtime", "acceptance should execute through local Skill runtime");
  assert(run.routingDecision?.selectedModelId === "yijiarj-grok-video-super", "acceptance MP4 node should route to yijiarj video model");
  assert(run.executionLog?.some((entry) => entry.step === "execute" && entry.payload?.previewOnly === true && String(entry.message).includes("no paid yijia request")), "acceptance run must be preview-only and avoid paid yijia request");
  assert(String(run.result?.output).includes("TikTok Opening Video Plan") && String(run.result?.output).includes("Thai-first Copy"), "acceptance run should produce a previewable TikTok video plan");
  assert(String(run.result?.output).includes("ratio 9:16") && String(run.result?.output).includes("duration 12s") && String(run.result?.output).includes("quality 1080p"), "acceptance preview should reflect node module parameters");
  assert(run.result?.brandId === "brand_dapot" && run.result?.skillId === skillId && run.result?.promptRecordId === run.promptRecord?.id, "acceptance ResultObject should trace brand, skill and prompt");
  assert(run.promptRecord?.nodeParams?.ratio === "9:16" && run.result?.trace?.nodeParams?.quality === "1080p", "acceptance PromptRecord and Result trace should preserve node module parameters");
  assert(run.piSession?.sessionJson && existsSync(run.piSession.sessionJson), "acceptance run should write a Pi session record");
  assert(run.result?.piSessionId === run.piSession.id && run.result?.trace?.piSessionId === run.piSession.id, "acceptance ResultObject should trace the Pi session id");
  assert(run.artifacts?.resultJson && existsSync(run.artifacts.resultJson) && run.artifacts?.logsJsonl && existsSync(run.artifacts.logsJsonl), "acceptance ResultObject and logs should be written to data directories");
  const piSessionJson = JSON.parse(readFileSync(run.piSession.sessionJson, "utf8"));
  assert(piSessionJson.executionId === run.execution.id && piSessionJson.resultId === run.execution.resultId && piSessionJson.promptRecordId === run.promptRecord.id, "acceptance Pi session should link execution, result and PromptRecord");
  assert(String(piSessionJson.output?.output).includes("TikTok Opening Video Plan"), "acceptance Pi session should capture preview output");
  assert(String(piSessionJson.output?.output).includes("quality 1080p"), "acceptance Pi session should capture parameterized preview output");

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
  assert(feedback.memory?.reusable === true && String(feedback.memory?.body).includes("这个太廉价"), "acceptance feedback should write reusable memory");
  assert(feedback.appliedLearning?.brandForbiddenWords?.some((item) => String(item).includes("这个太廉价")), "acceptance feedback should update DAPOT forbidden learning");
  assert(feedback.workspace?.results?.some((result) => result.id === run.execution.resultId && result.trace?.feedbackIds?.includes(feedback.feedback.id)), "acceptance feedback should link back to ResultObject trace");

  const sqliteExport = await request("/workgraph-os/sqlite/export");
  const sqliteObjects = sqliteExport.tables.find((table) => table.name === "wgos_objects");
  const sqliteEdges = sqliteExport.tables.find((table) => table.name === "wgos_edges");
  assert(sqliteObjects?.rows?.some((row) => row.id === `result:${run.execution.resultId}` && String(row.payload_json).includes("brand_dapot")), "acceptance SQLite should persist traceable ResultObject");
  assert(sqliteEdges?.rows?.some((row) => row.from_object_id === `feedback:${feedback.feedback.id}` && row.to_object_id === `result:${run.execution.resultId}`), "acceptance SQLite should persist feedback-to-result trace");
  assert(readFileSync(run.artifacts.logsJsonl, "utf8").includes("Preview-only"), "acceptance logs artifact should record preview-only execution");
  const snapshotManifest = JSON.parse(readFileSync(path.join(tempDir, "data", "workgraph-os-object-snapshots.json"), "utf8"));
  const snapshotTypes = ["goals", "brands", "assets", "skills", "models", "workflows", "nodes", "results", "feedback", "memory", "prompts", "logs", "db"];
  assert(snapshotTypes.every((type) => snapshotManifest.directories?.[type]), "acceptance data snapshot manifest should list every WorkGraph core data directory");
  assert(readFileSync(path.join(tempDir, "data", "results", `_index.json`), "utf8").includes(run.execution.resultId), "acceptance data/results should mirror ResultObject index");
  assert(readFileSync(path.join(tempDir, "data", "feedback", `_index.json`), "utf8").includes(feedback.feedback.id), "acceptance data/feedback should mirror FeedbackObject index");
  assert(readFileSync(path.join(tempDir, "data", "prompts", `_index.json`), "utf8").includes(run.promptRecord.id), "acceptance data/prompts should mirror PromptRecord index");
  assert(readFileSync(path.join(tempDir, "data", "nodes", `_index.json`), "utf8").includes("workflow-runner"), "acceptance data/nodes should mirror WorkflowNode objects");

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "dapot-natural-language-goal",
      "canonical-workgraph-nodes",
      "skill-files-visible",
      "skill-optimization-preview-and-apply",
      "preview-only-video-run",
      "pi-session-trace",
      "result-trace",
      "feedback-memory-learning",
      "sqlite-trace",
      "data-object-snapshots"
    ],
    resultId: run.execution.resultId,
    skillId
  }, null, 2));
} finally {
  server.kill();
  await rm(tempDir, { recursive: true, force: true });
}
