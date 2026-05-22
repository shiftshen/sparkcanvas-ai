import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const backendPort = 4298;
const backendUrl = `http://localhost:${backendPort}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-video-url-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");
const fakeMp4 = Buffer.concat([
  Buffer.from("00000020667479706d703432000000006d7034326d70343169736f6d", "hex"),
  Buffer.alloc(2048, 1)
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const videoApi = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/videos") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "fake-video-direct-url",
      video_url: `${videoApiUrl}/temporary-provider-url.mp4`
    }));
    return;
  }
  if (req.method === "GET" && req.url === "/temporary-provider-url.mp4") {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.end(fakeMp4);
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});

await new Promise((resolve) => videoApi.listen(0, "127.0.0.1", resolve));
const videoApiPort = videoApi.address().port;
const videoApiUrl = `http://127.0.0.1:${videoApiPort}`;

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    PORT: String(backendPort),
    SPARKCANVAS_DATA_FILE: dataFile,
    SPARKCANVAS_GENERATED_DIR: generatedDir,
    VIDEO_GEN_BASE_URL: `${videoApiUrl}/v1`,
    VIDEO_GEN_KEY: "fake-video-key",
    VIDEO_GEN_MODEL: "veo_3_1-fast",
    IMAGE_GEN_KEY: "",
    YIJIARJ_API_KEY: "",
    WORKFLOW_VIDEO_CREATE_TIMEOUT_MS: "5000",
    AI_REQUEST_TIMEOUT_MS: "5000"
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
    body: JSON.stringify({ brandId: null, title: "Video URL materialization smoke" })
  });
  await request(`/canvas/frames/${frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      workflowNodes: [{
        id: "node_video_materialize",
        type: "video",
        title: "Provider video URL",
        body: "Generate text-to-video without local references.",
        preview: "#111827",
        x: 160,
        y: 160,
        w: 260,
        h: 180
      }]
    })
  });

  const result = await request(`/canvas/frames/${frame.id}/nodes/node_video_materialize/generate-video`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "Generate a five second product motion test without references.",
      model: "veo_3_1-fast",
      settings: { mode: "文生视频", ratio: "16:9 · 720P", duration: "8s", sound: false, translate: false }
    })
  });

  assert(result.videoUrl?.startsWith("/generated/"), `expected local generated video URL, got ${result.videoUrl}`);
  assert(!result.videoUrl.includes("temporary-provider-url"), "provider URL should not be stored as the final video URL");
  const localVideoPath = path.join(generatedDir, result.videoUrl.replace(/^\/generated\//, ""));
  const info = await stat(localVideoPath);
  assert(info.size === fakeMp4.length, `materialized MP4 size mismatch: ${info.size}`);
  assert(result.node.videoUrl === result.videoUrl, "node should store the local materialized video URL");

  console.log(JSON.stringify({
    ok: true,
    checked: ["video-provider-url-materialized"],
    videoUrl: result.videoUrl,
    bytes: info.size
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  videoApi.close();
  await rm(tempDir, { recursive: true, force: true });
}
