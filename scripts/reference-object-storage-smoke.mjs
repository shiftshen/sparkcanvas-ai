import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4303;
const backendRoot = path.join(root, "backend");
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-object-ref-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");
const providerSeenReferences = [];
const uploadRequests = [];
const fakeMp4 = Buffer.concat([
  Buffer.from("00000020667479706d703432000000006d7034326d70343169736f6d", "hex"),
  Buffer.alloc(2048, 1)
]);
let objectStorageMode = "safe";
let providerVideoMode = "safe";
const requestTimeoutMs = 30000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withRequestTimeout(label, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureBackendBuilt() {
  const result = spawnSync("npm", ["run", "build", "--workspace", "backend"], {
    cwd: root,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`backend build failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function stopChildProcess(child) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("close", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!settled) {
        try { child.kill("SIGKILL"); } catch {}
        finish();
      }
    }, 2000);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); } catch {}
    try { if (typeof server.closeIdleConnections === "function") server.closeIdleConnections(); } catch {}
    server.close(() => finish());
    setTimeout(() => finish(), 2000);
  });
}

const objectStorageServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/objects/reference") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      const filename = String(req.headers["x-sparkcanvas-filename"] ?? "uploaded.png");
      uploadRequests.push({
        authorization: req.headers.authorization ?? "",
        contentType: req.headers["content-type"] ?? "",
        filename,
        sourceUrl: req.headers["x-sparkcanvas-source-url"] ?? "",
        size: bytes.length
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        objectUrl: objectStorageMode === "unsafe"
          ? `http://127.0.0.1/published/${filename}`
          : `${objectStorageBaseUrl}/published/${filename}`,
        location: `${objectStorageBaseUrl}/published/${filename}`
      }));
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});
await new Promise((resolve) => objectStorageServer.listen(0, "127.0.0.1", resolve));
const objectStoragePort = objectStorageServer.address().port;
const objectStorageBaseUrl = `http://127.0.0.1:${objectStoragePort}`;

const providerServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/videos") {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        providerSeenReferences.push(payload.input_reference ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "object-storage-video-id", video_url: `${providerBaseUrl}/temporary-provider-url.mp4` }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "bad json" }));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/temporary-provider-url.mp4") {
    if (providerVideoMode === "hang") {
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.end(fakeMp4);
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});
await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
const providerPort = providerServer.address().port;
const providerBaseUrl = `http://127.0.0.1:${providerPort}`;

function startBackendServer() {
  const server = spawn("node", ["dist/server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SPARKCANVAS_DATA_FILE: dataFile,
      SPARKCANVAS_GENERATED_DIR: generatedDir,
      SPARKCANVAS_REFERENCE_PUBLICATION_PROVIDER: "object-storage",
      SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL: `${objectStorageBaseUrl}/objects/reference`,
      SPARKCANVAS_REFERENCE_OBJECT_STORAGE_TOKEN: "object-storage-token",
      VIDEO_GEN_BASE_URL: `${providerBaseUrl}/v1`,
      VIDEO_GEN_KEY: "fake-video-key",
      VIDEO_GEN_MODEL: "grok-imagine-1.0-video-super",
      SPARKCANVAS_DISABLE_IMAGE_GEN: "1",
      SPARKCANVAS_DEBUG_VIDEO_SMOKE: "1",
      IMAGE_GEN_KEY: "",
      YIJIARJ_API_KEY: "",
      WORKFLOW_VIDEO_CREATE_TIMEOUT_MS: "5000",
      AI_REQUEST_TIMEOUT_MS: "5000",
      SPARKCANVAS_VIDEO_DOWNLOAD_TIMEOUT_MS: "1200"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
  return { server, getServerLog: () => serverLog };
}

async function waitForServer(getServerLog) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await withRequestTimeout("GET /health", (signal) => fetch(`${baseUrl}/health`, { signal }));
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Server did not become ready.\n${getServerLog()}`);
}

async function request(hostBaseUrl, pathname, options = {}, token = "") {
  return withRequestTimeout(`${options.method ?? "GET"} ${pathname}`, async (signal) => {
    const response = await fetch(`${hostBaseUrl}${pathname}`, {
      ...options,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {})
      }
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${body}`);
    return body ? JSON.parse(body) : {};
  });
}

async function createVideoNode(hostBaseUrl, token, frameTitle) {
  const frame = await request(hostBaseUrl, "/canvas/frames", {
    method: "POST",
    body: JSON.stringify({ brandId: null, title: frameTitle })
  }, token);

  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7A1sAAAAASUVORK5CYII=";
  await request(hostBaseUrl, `/canvas/frames/${frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      workflowNodes: [{
        id: "node_video_object_storage",
        type: "video",
        title: "Object storage video node",
        body: "Publish first frame through object storage provider",
        preview: "#111827",
        x: 120,
        y: 120,
        w: 260,
        h: 180,
        refs: [{
          id: "ref_object_storage_first_frame",
          role: "first-frame",
          title: "Object Storage First Frame",
          description: "Generated first frame for object-storage publication smoke",
          color: "#111827",
          imageUrl: `data:image/png;base64,${tinyPngBase64}`
        }]
      }]
    })
  }, token);

  return frame;
}

let exitCode = 0;
let server;
try {
  await ensureBackendBuilt();
  const backendRuntime = startBackendServer();
  server = backendRuntime.server;
  await waitForServer(backendRuntime.getServerLog);
  const login = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  const token = login.token;

  const aiStatus = await request(baseUrl, "/ai/status", {}, token);
  assert(aiStatus.publicReference?.publicationProvider === "object-storage", `expected object-storage provider, got ${aiStatus.publicReference?.publicationProvider}`);
  assert(aiStatus.publicReference?.publicationStrategy === "direct-external", `expected direct-external strategy, got ${aiStatus.publicReference?.publicationStrategy}`);
  assert(aiStatus.publicReference?.configured === true, "expected object-storage provider configured");

  objectStorageMode = "safe";
  const frame = await createVideoNode(baseUrl, token, "Object storage reference publish smoke");
  const result = await request(baseUrl, `/canvas/frames/${frame.id}/nodes/node_video_object_storage/generate-video`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "Generate a short product motion test using the uploaded first frame reference.",
      model: "grok-imagine-1.0-video-super",
      settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
    })
  }, token);

  assert(typeof result.videoPlan === "string" && /首帧:/.test(result.videoPlan), `expected video plan to include first-frame status, got ${result.videoPlan}`);
  assert(result.videoId === "object-storage-video-id", `expected mocked provider video id, got ${result.videoId}`);
  const persistedFirstFrame = result.node?.refs?.find((reference) => reference.role === "first-frame")?.imageUrl ?? "";
  assert(String(persistedFirstFrame).startsWith("/generated/brand-assets/"), `expected generated first frame persisted locally, got ${persistedFirstFrame}`);
  const uploadRequest = uploadRequests[0] ?? null;
  const providerReference = providerSeenReferences[0] ?? "";
  if (uploadRequest) {
    assert(uploadRequest.authorization === "Bearer object-storage-token", `expected object storage auth token, got ${uploadRequest.authorization}`);
    assert(uploadRequest.contentType === "image/png", `expected image/png upload, got ${uploadRequest.contentType}`);
    assert(String(uploadRequest.sourceUrl).startsWith("/generated/brand-assets/"), `expected generated local source URL, got ${uploadRequest.sourceUrl}`);
    assert(uploadRequest.size > 50, `expected uploaded image bytes, got ${uploadRequest.size}`);
  }
  if (providerReference && uploadRequest) {
    assert(providerReference === `${objectStorageBaseUrl}/published/${uploadRequest.filename}`, `expected provider to receive uploaded object URL, got ${providerReference}`);
  }

  providerVideoMode = "hang";
  const timeoutFrame = await createVideoNode(baseUrl, token, "Object storage stalled provider URL smoke");
  const stalledResult = await request(baseUrl, `/canvas/frames/${timeoutFrame.id}/nodes/node_video_object_storage/generate-video`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "Generate a short product motion test using a provider URL that never finishes downloading.",
      model: "grok-imagine-1.0-video-super",
      settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
    })
  }, token);
  assert(!stalledResult.videoUrl, `expected stalled provider download to avoid final videoUrl, got ${stalledResult.videoUrl}`);
  assert(/video download timed out after|执行状态: 视频生成请求失败/i.test(stalledResult.videoPlan), `expected stalled provider timeout diagnostics, got ${stalledResult.videoPlan}`);
  providerVideoMode = "safe";

  const prodPort = 4304;
  const prodBaseUrl = `http://localhost:${prodPort}`;
  const prodServer = spawn("node", ["dist/server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(prodPort),
      SPARKCANVAS_DATA_FILE: path.join(tempDir, "sparkcanvas-production.json"),
      SPARKCANVAS_GENERATED_DIR: path.join(tempDir, "generated-production"),
      SPARKCANVAS_AUTH_TOKEN: "prod-object-token",
      SPARKCANVAS_ADMIN_ACCOUNT: "admin@example.com",
      SPARKCANVAS_ADMIN_PASSWORD: "prod-object-password",
      SPARKCANVAS_REFERENCE_PUBLICATION_PROVIDER: "object-storage",
      SPARKCANVAS_REFERENCE_OBJECT_STORAGE_UPLOAD_URL: `${objectStorageBaseUrl}/objects/reference`,
      SPARKCANVAS_REFERENCE_OBJECT_STORAGE_TOKEN: "object-storage-token",
      VIDEO_GEN_BASE_URL: `${providerBaseUrl}/v1`,
      VIDEO_GEN_KEY: "fake-video-key",
      VIDEO_GEN_MODEL: "grok-imagine-1.0-video-super",
      SPARKCANVAS_DISABLE_IMAGE_GEN: "1",
      SPARKCANVAS_DEBUG_VIDEO_SMOKE: "1",
      WORKFLOW_VIDEO_CREATE_TIMEOUT_MS: "5000",
      AI_REQUEST_TIMEOUT_MS: "5000",
      SPARKCANVAS_VIDEO_DOWNLOAD_TIMEOUT_MS: "1200"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let prodLog = "";
  prodServer.stdout.on("data", (chunk) => { prodLog += chunk.toString(); });
  prodServer.stderr.on("data", (chunk) => { prodLog += chunk.toString(); });

  const waitForProdServer = async () => {
    const started = Date.now();
    while (Date.now() - started < 8000) {
      try {
        const response = await withRequestTimeout("GET /health (prod)", (signal) => fetch(`${prodBaseUrl}/health`, { signal }));
        if (response.ok) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    throw new Error(`Production object-storage smoke server did not become ready.\n${prodLog}`);
  };

  try {
    await waitForProdServer();
    const prodLogin = await request(prodBaseUrl, "/auth/login", {
      method: "POST",
      headers: { Origin: "https://xmanx.com" },
      body: JSON.stringify({ account: "admin@example.com", password: "prod-object-password" })
    });
    const prodToken = prodLogin.token;
    objectStorageMode = "unsafe";
    const providerCountBefore = providerSeenReferences.length;
    const prodFrame = await createVideoNode(prodBaseUrl, prodToken, "Object storage production unsafe URL smoke");
    const prodGenerate = await withRequestTimeout("POST generate-video (prod object-storage)", (signal) => fetch(`${prodBaseUrl}/canvas/frames/${prodFrame.id}/nodes/node_video_object_storage/generate-video`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://xmanx.com",
        Authorization: `Bearer ${prodToken}`
      },
      body: JSON.stringify({
        prompt: "Generate a short product motion test using the uploaded first frame reference.",
        model: "grok-imagine-1.0-video-super",
        settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
      })
    }));
    const prodErrorText = await prodGenerate.text();
    assert(prodGenerate.status === 500, `expected production unsafe object storage rejection, got ${prodGenerate.status} ${prodErrorText}`);
    assert(/input_reference|object-storage-non-production-url|provider: object-storage|失败原因: object-storage-non-production-url|公网图片链接|发布策略/i.test(prodErrorText), `expected unsafe object storage rejection details, got ${prodErrorText}`);
    assert(providerSeenReferences.length === providerCountBefore, "provider should not receive a request when object-storage returns a non-production URL");
  } finally {
    await stopChildProcess(prodServer);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: ["object-storage-provider-configured", "object-storage-first-frame-persisted", "object-storage-stalled-video-download-times-out-diagnostically", "production-object-storage-rejects-non-https-public-url"],
    providerReference,
    uploadRequest
  }, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await stopChildProcess(server);
  await closeServer(providerServer);
  await closeServer(objectStorageServer);
  await rm(tempDir, { recursive: true, force: true });
  process.exit(exitCode);
}
