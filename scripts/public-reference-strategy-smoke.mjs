import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4299;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-public-ref-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");

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

  console.log(JSON.stringify({
    ok: true,
    checked: ["public-reference-strategy-unpublished-without-base-url", "public-reference-provider-defaults-to-public-base-url"],
    publicReference
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(tempDir, { recursive: true, force: true });
}
