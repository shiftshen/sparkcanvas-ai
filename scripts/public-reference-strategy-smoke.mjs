import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4299;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-public-ref-"));
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
        res.end(JSON.stringify({ id: "public-base-video-id", video_url: "http://127.0.0.1/temporary-provider-url.mp4" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "bad json" }));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/temporary-provider-url.mp4") {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.end(Buffer.from("00000020667479706d703432000000006d7034326d70343169736f6d", "hex"));
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
    PORT: String(port),
    SPARKCANVAS_DATA_FILE: dataFile,
    SPARKCANVAS_GENERATED_DIR: generatedDir,
    SPARKCANVAS_DISABLE_IMAGE_GEN: "1"
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

try {
  await waitForServer();
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  assert(login.ok, `login failed: ${login.status}`);
  const { token } = await login.json();

  const workspace = await fetch(`${baseUrl}/workspace`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert(workspace.ok, `workspace failed: ${workspace.status}`);
  const payload = await workspace.json();
  const publicReference = payload.ai?.publicReference;

  assert(publicReference?.publicationStrategy === "unpublished", `expected unpublished strategy, got ${publicReference?.publicationStrategy}`);
  assert(publicReference?.publicationProvider === "public-base-url", `expected default provider, got ${publicReference?.publicationProvider}`);
  assert(publicReference?.configured === false, "expected unconfigured public reference base");
  assert(publicReference?.productionReady === false, "expected non-production-ready status without public base URL");

  const prodPort = 4305;
  const prodBaseUrl = `http://localhost:${prodPort}`;
  const prodServer = spawn("node", ["dist/server.js"], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(prodPort),
      SPARKCANVAS_DATA_FILE: path.join(tempDir, "sparkcanvas-production.json"),
      SPARKCANVAS_GENERATED_DIR: path.join(tempDir, "generated-production"),
      SPARKCANVAS_AUTH_TOKEN: "prod-public-base-token",
      SPARKCANVAS_ADMIN_ACCOUNT: "admin@example.com",
      SPARKCANVAS_ADMIN_PASSWORD: "prod-public-base-password",
      SPARKCANVAS_DISABLE_IMAGE_GEN: "1",
      VIDEO_GEN_BASE_URL: `${providerBaseUrl}/v1`,
      VIDEO_GEN_KEY: "fake-video-key",
      VIDEO_GEN_MODEL: "grok-imagine-1.0-video-super",
      AI_REQUEST_TIMEOUT_MS: "5000",
      WORKFLOW_VIDEO_CREATE_TIMEOUT_MS: "5000"
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
    throw new Error(`Production public-base smoke server did not become ready.\n${prodLog}`);
  };

  try {
    await waitForProdServer();
    const prodLogin = await fetch(`${prodBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://xmanx.com" },
      body: JSON.stringify({ account: "admin@example.com", password: "prod-public-base-password" })
    });
    if (!prodLogin.ok) {
      throw new Error(`production login failed: ${prodLogin.status} ${await prodLogin.text()}`);
    }
    const { token: prodToken } = await prodLogin.json();

    const createFrame = await fetch(`${prodBaseUrl}/canvas/frames`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://xmanx.com",
        Authorization: `Bearer ${prodToken}`
      },
      body: JSON.stringify({ brandId: null, title: "Public base production external URL smoke" })
    });
    if (!createFrame.ok) {
      throw new Error(`production frame create failed: ${createFrame.status} ${await createFrame.text()}`);
    }
    const frame = await createFrame.json();

    const patchFrame = await fetch(`${prodBaseUrl}/canvas/frames/${frame.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://xmanx.com",
        Authorization: `Bearer ${prodToken}`
      },
      body: JSON.stringify({
        workflowNodes: [{
          id: "node_video_public_base_external_url",
          type: "video",
          title: "Public base external URL node",
          body: "Reject unsafe external reference URL in production",
          preview: "#111827",
          x: 120,
          y: 120,
          w: 260,
          h: 180,
          refs: [{
            id: "ref_public_base_external_http",
            role: "first-frame",
            title: "Unsafe External First Frame",
            description: "Non-HTTPS external URL should be rejected in production",
            color: "#111827",
            imageUrl: "http://127.0.0.1/unsafe-first-frame.png"
          }]
        }]
      })
    });
    if (!patchFrame.ok) {
      throw new Error(`production frame patch failed: ${patchFrame.status} ${await patchFrame.text()}`);
    }

    const providerCountBefore = providerSeenReferences.length;
    const generate = await fetch(`${prodBaseUrl}/canvas/frames/${frame.id}/nodes/node_video_public_base_external_url/generate-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://xmanx.com",
        Authorization: `Bearer ${prodToken}`
      },
      body: JSON.stringify({
        prompt: "Generate a short product motion test using the external first frame reference.",
        model: "grok-imagine-1.0-video-super",
        settings: { mode: "图生视频", ratio: "9:16 · 720P", duration: "10s", sound: false, translate: false }
      })
    });
    const errorText = await generate.text();
    assert(generate.status === 500, `expected production external URL rejection, got ${generate.status} ${errorText}`);
    assert(/input_reference|public-base-url-non-production-url|provider: public-base-url|失败原因: public-base-url-non-production-url|公网图片链接|发布策略/i.test(errorText), `expected unsafe external URL rejection details, got ${errorText}`);
    assert(providerSeenReferences.length === providerCountBefore, "provider should not receive a request when public-base-url resolves to a non-production external URL");
  } finally {
    await stopChildProcess(prodServer);
  }

  console.log(JSON.stringify({
    ok: true,
    checked: ["public-reference-strategy-unpublished-without-base-url", "public-reference-provider-defaults-to-public-base-url", "production-public-base-url-rejects-unsafe-external-url"],
    publicReference
  }, null, 2));
} finally {
  await stopChildProcess(server);
  await new Promise((resolve) => providerServer.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
}
