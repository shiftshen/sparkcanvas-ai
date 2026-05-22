import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4201;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-prod-smoke-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");
const providerSeenReferences = [];

const providerServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/videos") {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        providerSeenReferences.push(payload.input_reference ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "prod-smoke-video-id", video_url: "https://provider.example/fake.mp4" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "bad json" }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/publish") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: "http://127.0.0.1/published/unsafe.png" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});
await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
const providerPort = providerServer.address().port;
const providerBaseUrl = `http://127.0.0.1:${providerPort}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    SPARKCANVAS_DATA_FILE: dataFile,
    SPARKCANVAS_GENERATED_DIR: generatedDir,
    SPARKCANVAS_AUTH_TOKEN: "prod-smoke-token",
    SPARKCANVAS_ADMIN_ACCOUNT: "admin@example.com",
    SPARKCANVAS_ADMIN_PASSWORD: "prod-smoke-password",
    SPARKCANVAS_ALLOWED_ORIGINS: "https://xmanx.com,https://www.xmanx.com",
    SPARKCANVAS_PUBLIC_BASE_URL: "https://xmanx.com",
    VIDEO_GEN_BASE_URL: `${providerBaseUrl}/v1`,
    VIDEO_GEN_KEY: "prod-smoke-video-key",
    VIDEO_GEN_MODEL: "grok-imagine-1.0-video-super",
    VIDEO_STRICT_FIRST_FRAME_FALLBACK: "0",
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
  throw new Error(`Production server did not become ready.\n${serverLog}`);
}

try {
  await mkdir(generatedDir, { recursive: true });
  await writeFile(path.join(generatedDir, "private.txt"), "sparkcanvas private generated file");
  await waitForServer();

  const demoLogin = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://xmanx.com" },
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  assert(demoLogin.status === 401, "production must not accept the public demo login");

  const adminLogin = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://xmanx.com" },
    body: JSON.stringify({ account: "admin@example.com", password: "prod-smoke-password" })
  });
  assert(adminLogin.ok, `production admin login failed: ${adminLogin.status}`);
  const loginPayload = await adminLogin.json();
  assert(loginPayload.token === "prod-smoke-token", "production login should return configured auth token");

  const workspace = await fetch(`${baseUrl}/workspace`, {
    headers: { Authorization: "Bearer prod-smoke-token", Origin: "https://xmanx.com" }
  });
  assert(workspace.ok, `production workspace auth failed: ${workspace.status}`);
  const workspacePayload = await workspace.json();
  assert(workspacePayload.ai?.publicReference?.productionReady === true, "production workspace should surface public reference readiness");

  const aiStatus = await fetch(`${baseUrl}/ai/status`, {
    headers: { Authorization: "Bearer prod-smoke-token", Origin: "https://xmanx.com" }
  });
  assert(aiStatus.ok, `production ai status failed: ${aiStatus.status}`);
  const aiStatusPayload = await aiStatus.json();
  assert(aiStatusPayload.publicReference?.productionReady === true, "AI status should mark public reference URLs production-ready");

  const generatedWithoutToken = await fetch(`${baseUrl}/generated/private.txt`, {
    headers: { Origin: "https://xmanx.com" }
  });
  assert(generatedWithoutToken.status === 401, "production generated files must require auth");

  const generatedWithToken = await fetch(`${baseUrl}/generated/private.txt`, {
    headers: { Authorization: "Bearer prod-smoke-token", Origin: "https://xmanx.com" }
  });
  const generatedText = await generatedWithToken.text();
  assert(generatedWithToken.ok && generatedText === "sparkcanvas private generated file", "production generated files should be readable with auth");

  const frame = await fetch(`${baseUrl}/canvas/frames`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer prod-smoke-token",
      Origin: "https://xmanx.com"
    },
    body: JSON.stringify({ brandId: null, title: "Prod smoke reference upload" })
  });
  assert(frame.ok, `production frame create failed: ${frame.status}`);
  const framePayload = await frame.json();

  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7A1sAAAAASUVORK5CYII=";
  const patchFrame = await fetch(`${baseUrl}/canvas/frames/${framePayload.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer prod-smoke-token",
      Origin: "https://xmanx.com"
    },
    body: JSON.stringify({
      workflowNodes: [{
        id: "node_video_prod_smoke",
        type: "video",
        title: "Prod smoke video node",
        body: "Verify signed public first-frame URL",
        preview: "#111827",
        x: 120,
        y: 120,
        w: 260,
        h: 180,
        refs: [{
          id: "ref_prod_smoke_first_frame",
          role: "first-frame",
          title: "Prod Smoke First Frame",
          description: "Stored generated first frame for signed URL testing",
          color: "#111827",
          imageUrl: `data:image/png;base64,${tinyPngBase64}`
        }]
      }]
    })
  });
  assert(patchFrame.ok, `production frame patch failed: ${patchFrame.status}`);

  const generateVideo = await fetch(`${baseUrl}/canvas/frames/${framePayload.id}/nodes/node_video_prod_smoke/generate-video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer prod-smoke-token",
      Origin: "https://xmanx.com"
    },
    body: JSON.stringify({
      prompt: "Generate a short product motion test with the supplied first frame.",
      model: "grok-imagine-1.0-video-super",
      settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
    })
  });
  assert(generateVideo.ok, `production generate-video failed: ${generateVideo.status} ${await generateVideo.text()}`);
  assert(providerSeenReferences.length === 1, `expected exactly one provider request, got ${providerSeenReferences.length}`);
  const providerReference = providerSeenReferences[0];
  assert(providerReference.startsWith(`https://xmanx.com/generated/brand-assets/`), `expected public generated first-frame URL, got ${providerReference}`);
  assert(providerReference.includes("token=prod-smoke-token"), `expected signed generated first-frame URL, got ${providerReference}`);

  const unsafeUpload = await fetch(`${providerBaseUrl}/publish`, { method: "POST" });
  assert(unsafeUpload.ok, `unsafe upload probe failed: ${unsafeUpload.status}`);
  const unsafePayload = await unsafeUpload.json();
  assert(String(unsafePayload.url).startsWith("http://127.0.0.1/"), `expected unsafe probe to return non-https url, got ${unsafePayload.url}`);

  const evilOrigin = await fetch(`${baseUrl}/workspace`, {
    headers: { Authorization: "Bearer prod-smoke-token", Origin: "https://evil.example" }
  });
  assert(evilOrigin.status >= 500 || !evilOrigin.headers.get("access-control-allow-origin"), "production CORS must not allow arbitrary origins");

  console.log(JSON.stringify({
    ok: true,
    checked: ["production-demo-login-disabled", "production-admin-login", "production-token-auth", "production-generated-file-auth", "production-video-input-reference-signed-url", "production-cors-origin-filter", "production-upload-service-url-sanity"],
    providerReference
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  providerServer.close();
  await rm(tempDir, { recursive: true, force: true });
}
