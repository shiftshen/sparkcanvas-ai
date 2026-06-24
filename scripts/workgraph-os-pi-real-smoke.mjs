// Gated real pi-web e2e smoke. Skips cleanly when no pi-web is reachable (CI and
// most envs), so it is safe to run anywhere. When pi-web IS reachable it drives a
// real bridge attempt and asserts the HONEST contract: the run either completes as
// a real pi-web execution (executor=pi-web, output present) or falls back to a
// clearly-simulated run whose reason references pi-web. Never asserts a paid turn
// must succeed (pi-web turns can be slow), only that the bridge behaves honestly.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const piBase = process.env.WGOS_PIWEB_BASE_URL || "http://127.0.0.1:30141";
const model = process.env.WGOS_PIWEB_MODEL || "gpt-5.4-mini";
const provider = process.env.WGOS_PIWEB_PROVIDER || "vdamo";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reachable() {
  try {
    const response = await fetch(`${piBase}/api/models`, { signal: AbortSignal.timeout(2500) });
    const contentType = response.headers.get("content-type") || "";
    return response.ok && contentType.includes("application/json");
  } catch {
    return false;
  }
}

if (!(await reachable())) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: `pi-web not reachable at ${piBase}`, checked: [] }));
  process.exit(0);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "wgos-pi-real-"));
const piCwd = mkdtempSync(path.join(os.tmpdir(), "wgos-pi-cwd-"));
const port = 4240 + Math.floor((Date.now() % 50));
const base = `http://127.0.0.1:${port}`;
const tsxBin = path.resolve("backend/node_modules/.bin/tsx");

const server = spawn(tsxBin, ["backend/src/server.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    WGOS_PIWEB_ENABLED: "auto",
    WGOS_PIWEB_BASE_URL: piBase,
    WGOS_PIWEB_PROVIDER: provider,
    WGOS_PIWEB_MODEL: model,
    WGOS_PIWEB_CWD: piCwd,
    WGOS_PIWEB_TIMEOUT_MS: "8000",
    WGOS_OUTPUT_WATCH: "off",
    WORKGRAPH_OS_DATA_FILE: path.join(tmp, "wgos.json"),
    WORKGRAPH_OS_HISTORY_FILE: path.join(tmp, "history.json"),
    WORKGRAPH_OS_DB_FILE: path.join(tmp, "db.sqlite"),
    WORKGRAPH_OS_PI_DIR: path.join(tmp, ".pi"),
    WORKGRAPH_OS_SKILL_DIR: path.join(tmp, "skills"),
    WORKGRAPH_OS_ASSET_DIR: path.join(tmp, "assets"),
    WORKGRAPH_OS_OUTPUT_DIR: path.join(tmp, "out"),
    SPARKCANVAS_DATA_FILE: path.join(tmp, "spark.json")
  },
  stdio: "ignore"
});

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function cleanup() {
  try { server.kill("SIGKILL"); } catch {}
  rmSync(tmp, { recursive: true, force: true });
  rmSync(piCwd, { recursive: true, force: true });
}

try {
  // wait for health
  let up = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) { up = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(up, "backend did not start");

  const status = await request("/workgraph-os/pi/status");
  assert(status.source === "pi-web-bridge" && status.reachable === true, "pi/status should report pi-web reachable in this gated run");

  await request("/workgraph-os/workspace", {
    method: "PUT",
    body: JSON.stringify({
      version: 1, id: "w", prompt: "reply OK", activeBrandId: "", activeModelId: "", selectedIds: [],
      activeMaterialId: "", activeSkillId: "", activeNodeId: "",
      materials: [], skills: [], models: [],
      nodes: [{ id: "workflow-runner", title: "R", type: "skill_execute", body: "Reply with exactly: OK", status: "ready" }],
      edges: [], jobs: [], results: [], feedback: [], memories: [], executionLog: [], promptRecords: []
    })
  });

  // Real bridge attempt (auto). Honest outcome required, not a guaranteed paid success.
  const run = await request("/workgraph-os/run", { method: "POST", body: JSON.stringify({ nodeId: "workflow-runner", bridge: "auto" }) });
  const bridge = run.bridge || {};
  const realPi = bridge.outcome === "pi-web" && bridge.simulated === false && String(run.result?.output || "").trim().length > 0;
  const honestFallback = bridge.outcome === "simulated" && bridge.simulated === true && /pi-web/i.test(String(bridge.reason || ""));
  assert(realPi || honestFallback, `bridge outcome not honest: ${JSON.stringify(bridge)}`);

  console.log(JSON.stringify({
    ok: true,
    skipped: false,
    outcome: bridge.outcome,
    realPi,
    honestFallback,
    reason: bridge.reason,
    checked: ["pi-web-reachable", "pi-status", "real-bridge-attempt", "honest-outcome"]
  }, null, 2));
  cleanup();
  process.exit(0);
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
