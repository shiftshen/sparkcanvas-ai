import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4201;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-prod-smoke-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
const generatedDir = path.join(tempDir, "generated");

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
    SPARKCANVAS_DISABLE_IMAGE_GEN: "1",
    SPARKCANVAS_AUTH_TOKEN: "prod-smoke-token",
    SPARKCANVAS_ADMIN_ACCOUNT: "admin@example.com",
    SPARKCANVAS_ADMIN_PASSWORD: "prod-smoke-password",
    SPARKCANVAS_ALLOWED_ORIGINS: "https://xmanx.com,https://www.xmanx.com"
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

  const generatedWithoutToken = await fetch(`${baseUrl}/generated/private.txt`, {
    headers: { Origin: "https://xmanx.com" }
  });
  assert(generatedWithoutToken.status === 401, "production generated files must require auth");

  const generatedWithToken = await fetch(`${baseUrl}/generated/private.txt`, {
    headers: { Authorization: "Bearer prod-smoke-token", Origin: "https://xmanx.com" }
  });
  const generatedText = await generatedWithToken.text();
  assert(generatedWithToken.ok && generatedText === "sparkcanvas private generated file", "production generated files should be readable with auth");

  const evilOrigin = await fetch(`${baseUrl}/workspace`, {
    headers: { Authorization: "Bearer prod-smoke-token", Origin: "https://evil.example" }
  });
  assert(evilOrigin.status >= 500 || !evilOrigin.headers.get("access-control-allow-origin"), "production CORS must not allow arbitrary origins");

  console.log(JSON.stringify({
    ok: true,
    checked: ["production-demo-login-disabled", "production-admin-login", "production-token-auth", "production-generated-file-auth", "production-cors-origin-filter"]
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(tempDir, { recursive: true, force: true });
}
