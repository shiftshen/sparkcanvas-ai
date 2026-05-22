import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4300;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-upload-ref-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");
const providerSeenReferences = [];
const uploadRequests = [];
const fakeMp4 = Buffer.concat([
  Buffer.from("00000020667479706d703432000000006d7034326d70343169736f6d", "hex"),
  Buffer.alloc(2048, 1)
]);
let uploadMode = "safe";
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

const uploadServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/upload/reference") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      uploadRequests.push({
        authorization: req.headers.authorization ?? "",
        contentType: req.headers["content-type"] ?? "",
        filename: req.headers["x-sparkcanvas-filename"] ?? "",
        sourceUrl: req.headers["x-sparkcanvas-source-url"] ?? "",
        size: bytes.length
      });
      const filename = String(req.headers["x-sparkcanvas-filename"] ?? "uploaded.png");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        url: uploadMode === "unsafe"
          ? `http://127.0.0.1/published/${filename}`
          : `${uploadBaseUrl}/published/${filename}`,
        publicUrl: `${uploadBaseUrl}/published/${filename}`,
        objectUrl: `${uploadBaseUrl}/published/${filename}`
      }));
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});
await new Promise((resolve) => uploadServer.listen(0, "127.0.0.1", resolve));
const uploadPort = uploadServer.address().port;
const uploadBaseUrl = `http://127.0.0.1:${uploadPort}`;

const providerServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/videos") {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        providerSeenReferences.push(payload.input_reference ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "upload-service-video-id", video_url: `${providerBaseUrl}/temporary-provider-url.mp4` }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "bad json" }));
      }
    });
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
await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
const providerPort = providerServer.address().port;
const providerBaseUrl = `http://127.0.0.1:${providerPort}`;

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    PORT: String(port),
    SPARKCANVAS_DATA_FILE: dataFile,
    SPARKCANVAS_GENERATED_DIR: generatedDir,
    SPARKCANVAS_REFERENCE_PUBLICATION_PROVIDER: "upload-service",
    SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL: `${uploadBaseUrl}/upload/reference`,
    SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_TOKEN: "upload-service-token",
    VIDEO_GEN_BASE_URL: `${providerBaseUrl}/v1`,
    VIDEO_GEN_KEY: "fake-video-key",
    VIDEO_GEN_MODEL: "grok-imagine-1.0-video-super",
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

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Server did not become ready.\n${serverLog}`);
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

async function requestRaw(hostBaseUrl, pathname, options = {}, token = "") {
  return withRequestTimeout(`${options.method ?? "GET"} ${pathname}`, (signal) => fetch(`${hostBaseUrl}${pathname}`, {
    ...options,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  }));
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
        id: "node_video_upload_service",
        type: "video",
        title: "Upload service video node",
        body: "Publish first frame through upload service stub",
        preview: "#111827",
        x: 120,
        y: 120,
        w: 260,
        h: 180,
        refs: [{
          id: "ref_upload_service_first_frame",
          role: "first-frame",
          title: "Upload Service First Frame",
          description: "Generated first frame for upload-service publication smoke",
          color: "#111827",
          imageUrl: `data:image/png;base64,${tinyPngBase64}`
        }]
      }]
    })
  }, token);

  return frame;
}

let exitCode = 0;
let token = "";
try {
  await waitForServer();
  const login = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  token = login.token;

  const aiStatus = await request(baseUrl, "/ai/status", {}, token);
  assert(aiStatus.publicReference?.publicationProvider === "upload-service-stub", `expected upload-service provider, got ${aiStatus.publicReference?.publicationProvider}`);
  assert(aiStatus.publicReference?.publicationStrategy === "direct-external", `expected direct-external strategy, got ${aiStatus.publicReference?.publicationStrategy}`);
  assert(aiStatus.publicReference?.configured === true, "expected upload-service provider configured");

  uploadMode = "safe";
  const frame = await createVideoNode(baseUrl, token, "Upload service reference publish smoke");
  const result = await request(baseUrl, `/canvas/frames/${frame.id}/nodes/node_video_upload_service/generate-video`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "Generate a short product motion test using the uploaded first frame reference.",
      model: "grok-imagine-1.0-video-super",
      settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
    })
  }, token);

  assert(typeof result.videoPlan === "string" && result.videoPlan.includes("首帧: 已提交给视频模型"), "expected video plan to confirm first-frame submission");
  assert(result.videoId === "upload-service-video-id", `expected mocked provider video id, got ${result.videoId}`);
  const persistedFirstFrame = result.node?.refs?.find((reference) => reference.role === "first-frame")?.imageUrl ?? "";
  assert(String(persistedFirstFrame).startsWith("/generated/brand-assets/"), `expected generated first frame persisted locally, got ${persistedFirstFrame}`);
  const uploadRequest = uploadRequests[0] ?? null;
  const providerReference = providerSeenReferences[0] ?? "";
  if (uploadRequest) {
    assert(uploadRequest.authorization === "Bearer upload-service-token", `expected upload auth token, got ${uploadRequest.authorization}`);
    assert(uploadRequest.contentType === "image/png", `expected image/png upload, got ${uploadRequest.contentType}`);
    assert(String(uploadRequest.sourceUrl).startsWith("/generated/brand-assets/"), `expected generated local source URL, got ${uploadRequest.sourceUrl}`);
    assert(uploadRequest.size > 50, `expected uploaded image bytes, got ${uploadRequest.size}`);
  }
  if (providerReference && uploadRequest) {
    assert(providerReference === `${uploadBaseUrl}/published/${uploadRequest.filename}`, `expected provider to receive uploaded URL, got ${providerReference}`);
  }

  const prodPort = 4302;
  const prodBaseUrl = `http://localhost:${prodPort}`;
  const prodServer = spawn("node", ["dist/server.js"], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(prodPort),
      SPARKCANVAS_DATA_FILE: path.join(tempDir, "sparkcanvas-production.json"),
      SPARKCANVAS_GENERATED_DIR: path.join(tempDir, "generated-production"),
      SPARKCANVAS_AUTH_TOKEN: "prod-upload-token",
      SPARKCANVAS_ADMIN_ACCOUNT: "admin@example.com",
      SPARKCANVAS_ADMIN_PASSWORD: "prod-upload-password",
      SPARKCANVAS_REFERENCE_PUBLICATION_PROVIDER: "upload-service",
      SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_URL: `${uploadBaseUrl}/upload/reference`,
      SPARKCANVAS_REFERENCE_UPLOAD_SERVICE_TOKEN: "upload-service-token",
      VIDEO_GEN_BASE_URL: `${providerBaseUrl}/v1`,
      VIDEO_GEN_KEY: "fake-video-key",
      VIDEO_GEN_MODEL: "grok-imagine-1.0-video-super",
      WORKFLOW_VIDEO_CREATE_TIMEOUT_MS: "5000",
      AI_REQUEST_TIMEOUT_MS: "5000"
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
        const response = await fetch(`${prodBaseUrl}/health`);
        if (response.ok) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    throw new Error(`Production upload-service smoke server did not become ready.\n${prodLog}`);
  };

  try {
    await waitForProdServer();
    const prodLogin = await request(prodBaseUrl, "/auth/login", {
      method: "POST",
      headers: { Origin: "https://xmanx.com" },
      body: JSON.stringify({ account: "admin@example.com", password: "prod-upload-password" })
    });
    const prodToken = prodLogin.token;

    const directExternalFrame = await request(prodBaseUrl, "/canvas/frames", {
      method: "POST",
      headers: { Origin: "https://xmanx.com" },
      body: JSON.stringify({ brandId: null, title: "Upload service production external URL smoke" })
    }, prodToken);
    await request(prodBaseUrl, `/canvas/frames/${directExternalFrame.id}`, {
      method: "PATCH",
      headers: { Origin: "https://xmanx.com" },
      body: JSON.stringify({
        workflowNodes: [{
          id: "node_video_upload_service_external_url",
          type: "video",
          title: "Upload service external URL node",
          body: "Reject unsafe external reference URL in production",
          preview: "#111827",
          x: 120,
          y: 120,
          w: 260,
          h: 180,
          refs: [{
            id: "ref_upload_service_external_http",
            role: "first-frame",
            title: "Unsafe External First Frame",
            description: "Non-HTTPS external URL should be rejected in production",
            color: "#111827",
            imageUrl: "http://127.0.0.1/unsafe-first-frame.png"
          }]
        }]
      })
    }, prodToken);
    const directExternalGenerate = await requestRaw(prodBaseUrl, `/canvas/frames/${directExternalFrame.id}/nodes/node_video_upload_service_external_url/generate-video`, {
      method: "POST",
      headers: { Origin: "https://xmanx.com" },
      body: JSON.stringify({
        prompt: "Generate a short product motion test using the uploaded first frame reference.",
        model: "grok-imagine-1.0-video-super",
        settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
      })
    }, prodToken);
    const directExternalErrorText = await directExternalGenerate.text();
    assert(directExternalGenerate.status === 500, `expected production external URL rejection, got ${directExternalGenerate.status} ${directExternalErrorText}`);
    assert(/input_reference|upload-service-non-production-url|公网图片链接|发布策略/i.test(directExternalErrorText), `expected unsafe external URL rejection details, got ${directExternalErrorText}`);

    uploadMode = "unsafe";
    const providerCountBefore = providerSeenReferences.length;
    const prodFrame = await createVideoNode(prodBaseUrl, prodToken, "Upload service production unsafe URL smoke");
    const prodGenerate = await requestRaw(prodBaseUrl, `/canvas/frames/${prodFrame.id}/nodes/node_video_upload_service/generate-video`, {
      method: "POST",
      headers: { Origin: "https://xmanx.com" },
      body: JSON.stringify({
        prompt: "Generate a short product motion test using the uploaded first frame reference.",
        model: "grok-imagine-1.0-video-super",
        settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
      })
    }, prodToken);
    const prodErrorText = await prodGenerate.text();
    assert(prodGenerate.status === 500, `expected production unsafe upload rejection, got ${prodGenerate.status} ${prodErrorText}`);
    assert(/input_reference|upload-service-non-production-url|公网图片链接|发布策略/i.test(prodErrorText), `expected unsafe upload rejection details, got ${prodErrorText}`);
    assert(providerSeenReferences.length === providerCountBefore, "provider should not receive a request when upload-service returns a non-production URL");
  } finally {
    await stopChildProcess(prodServer);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: ["upload-service-provider-configured", "upload-service-first-frame-persisted", "production-upload-service-rejects-unsafe-external-url", "production-upload-service-rejects-non-https-public-url"],
    providerReference,
    uploadRequest
  }, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await stopChildProcess(server);
  await closeServer(providerServer);
  await closeServer(uploadServer);
  await rm(tempDir, { recursive: true, force: true });
  process.exit(exitCode);
}
