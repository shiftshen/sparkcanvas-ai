import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const backendPort = 4299;
const backendUrl = `http://localhost:${backendPort}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-compose-failure-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    PORT: String(backendPort),
    SPARKCANVAS_DATA_FILE: dataFile,
    SPARKCANVAS_GENERATED_DIR: generatedDir,
    VIDEO_GEN_KEY: "",
    IMAGE_GEN_KEY: "",
    YIJIARJ_API_KEY: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

async function request(pathname, options = {}) {
  const response = await fetch(`${backendUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${body}`);
  return body ? JSON.parse(body) : {};
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Server did not become ready.\n${serverLog}`);
}

let token = "";
try {
  await waitForServer();
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  token = login.token;

  const frame = await request("/canvas/frames", {
    method: "POST",
    body: JSON.stringify({ brandId: null, title: "Compose failure smoke" })
  });

  await request(`/canvas/frames/${frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      workflowNodes: [
        {
          id: "node_smoke_video_only_one",
          type: "video",
          title: "Only one historical clip",
          body: "Single clip should be insufficient for a 20s merge plan.",
          preview: "#111827",
          x: 120,
          y: 120,
          videoUrl: "https://provider.example/only-one.mp4"
        },
        {
          id: "node_smoke_compose_failure",
          type: "compose",
          title: "Compose failure smoke",
          body: "Expect surfaced failure details.",
          preview: "#0f766e",
          x: 420,
          y: 120,
          inputIds: ["node_smoke_video_only_one"]
        }
      ]
    })
  });

  const result = await request(`/canvas/frames/${frame.id}/nodes/node_smoke_compose_failure/generate-compose`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "合成 20 秒长视频并暴露片段不足失败原因",
      model: "grok-imagine-1.0-video-super",
      settings: { duration: "20s", ratio: "9:16 · 720P", contentLanguage: "zh-en", transition: "硬切", audioMode: "统一混音" }
    })
  });

  assert(!result.mergedUrl, "compose failure smoke should not produce a mergedUrl when only one segment is available");
  assert(result.composeVerification?.ok === false, "compose failure smoke should expose composeVerification.ok=false");
  assert(result.composeVerification?.failureReason === "insufficient-video-urls", `unexpected failure reason: ${result.composeVerification?.failureReason}`);
  assert(result.composeVerification?.requiredSegments === 2 && result.composeVerification?.sourceCount === 1, "compose failure smoke should report required/source segment counts");
  assert(result.composePlan.includes("片段不足") && result.composePlan.includes("合成校验"), "compose plan should surface the insufficient-segment failure in user-facing text");

  console.log(JSON.stringify({
    ok: true,
    checked: ["compose-failure-surfacing"],
    failureReason: result.composeVerification.failureReason,
    requiredSegments: result.composeVerification.requiredSegments,
    sourceCount: result.composeVerification.sourceCount
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(tempDir, { recursive: true, force: true });
}
