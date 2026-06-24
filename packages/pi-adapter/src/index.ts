import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export type PiSkillSource = "pi-skill-fs" | "data-skill-store";

export type PiSkillAdapterConfig = {
  piDir: string;
  skillDataDir: string;
  now?: () => string;
};

export type PiSkillFileTree = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: PiSkillFileTree[];
};

export type PiSkillFile = {
  path: string;
  content: string;
};

export type PiSkillDetail = {
  source: "pi-adapter";
  skill: Record<string, unknown>;
  folder: string;
  piDir: string;
  mirrorDir: string;
  tree: PiSkillFileTree[];
  files: PiSkillFile[];
  onlineSearch: {
    status: "planned";
    disabled: true;
    message: string;
  };
};

export type PiSessionRecord = {
  id: string;
  executionId: string;
  workflowId: string;
  nodeId: string;
  skillId: string;
  resultId: string;
  promptRecordId: string;
  status: string;
  createdAt: string;
  input: unknown;
  output: unknown;
};

export type PiExecutionContext = {
  source: "pi-adapter";
  goal: string;
  workflowId: string;
  node: unknown;
  brand: unknown;
  assets: unknown[];
  skill: unknown;
  modelPolicy: unknown;
  promptRecord: unknown;
  localPaths: {
    piDir: string;
    skillDir: string;
    mirrorSkillDir: string;
    sessionsDir: string;
  };
};

function currentIso(config: PiSkillAdapterConfig) {
  return config.now?.() ?? new Date().toISOString();
}

export function piSkillSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    || "skill";
}

export function safePiSkillRelativePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function objectField(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;
  return (input as Record<string, unknown>)[key];
}

function objectString(input: unknown, key: string, fallback = "") {
  const value = objectField(input, key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectStringArray(input: unknown, key: string) {
  const value = objectField(input, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

export function piSkillFolderName(input: unknown, fallbackIndex = 0) {
  const pathValue = safePiSkillRelativePath(objectString(input, "skillMdPath", ""));
  if (pathValue) {
    const parts = pathValue.split("/");
    const skillIndex = parts.findIndex((part) => part === "skills");
    if (skillIndex >= 0 && parts[skillIndex + 1]) return piSkillSlug(parts[skillIndex + 1]);
    if (parts.length > 1) return piSkillSlug(parts[parts.length - 2]);
  }
  return piSkillSlug(objectString(input, "command", "") || objectString(input, "title", `skill-${fallbackIndex + 1}`));
}

export function piSkillRelativePath(input: unknown, fallbackIndex = 0) {
  return `skills/${piSkillFolderName(input, fallbackIndex)}/SKILL.md`;
}

export function piSkillDiskDirs(config: PiSkillAdapterConfig, input: unknown, fallbackIndex = 0) {
  const folder = piSkillFolderName(input, fallbackIndex);
  return [
    path.join(config.piDir, "skills", folder),
    path.join(config.skillDataDir, folder)
  ];
}

function piSkillFileSpec(skill: Record<string, unknown>) {
  const command = objectString(skill, "command", "/skill");
  const title = objectString(skill, "title", "Skill");
  const output = objectString(skill, "output", "PNG");
  const description = objectString(skill, "description", "由 WorkGraph OS 管理的 Pi Skill。");
  const capabilityType = objectString(skill, "capabilityType", "custom");
  const runtime = objectString(skill, "runtime", "pi-skill");
  const keywords = objectStringArray(skill, "keywords");
  const slug = piSkillFolderName(skill);
  const json = {
    id: objectString(skill, "id", `skill-${slug}`),
    title,
    command,
    output,
    description,
    capabilityType,
    runtime,
    keywords,
    version: objectString(skill, "version", "0.1.0"),
    status: objectString(objectField(skill, "evolution"), "status", "created")
  };
  return {
    "SKILL.md": [
      `# ${title}`,
      "",
      `Command: \`${command}\``,
      `Output: \`${output}\``,
      "",
      description,
      "",
      "## Inputs",
      "- Goal Object",
      "- Brand Object",
      "- Asset Objects",
      "- ModelPolicy",
      "",
      "## Run Contract",
      "Return ResultObject, ExecutionLog entries, and preview-ready output data.",
      "",
      "## Safety",
      "Do not overwrite user assets. Keep API keys in environment variables."
    ].join("\n"),
    "skill.json": `${JSON.stringify(json, null, 2)}\n`,
    "scripts/run.ts": [
      "export async function run(input: unknown) {",
      "  return {",
      `    skill: ${JSON.stringify(command)},`,
      "    status: \"planned\",",
      "    input",
      "  };",
      "}",
      ""
    ].join("\n"),
    "resources/guide.md": [
      `# ${title} Guide`,
      "",
      "Use this guide to keep prompts, model routing, brand constraints, and output validation explicit.",
      ""
    ].join("\n"),
    "examples/input.json": `${JSON.stringify({ goal: "给 DAPOT 做一条泰国年轻女性喜欢的新店开业 TikTok 视频", brandId: "brand_dapot", command }, null, 2)}\n`,
    "examples/output.json": `${JSON.stringify({ resultType: output, status: "preview", logs: [] }, null, 2)}\n`
  };
}

export async function ensurePiAdapterSystem(config: PiSkillAdapterConfig) {
  await mkdir(path.join(config.piDir, "skills"), { recursive: true });
  await mkdir(path.join(config.piDir, "sessions"), { recursive: true });
  await mkdir(config.skillDataDir, { recursive: true });
  const agentsPath = path.join(config.piDir, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    await writeFile(agentsPath, [
      "# WorkGraph OS Pi Adapter",
      "",
      "Pi executes skills. WorkGraph OS owns goals, graph state, assets, brand context, routing, results, logs, feedback, and memory.",
      "",
      "Rules:",
      "- Read Goal, Brand, Asset, Skill, ModelPolicy, and PromptRecord before execution.",
      "- Return ResultObject and ExecutionLog records.",
      "- Write Pi session records into `.pi/sessions` so WorkGraph OS can trace execution back to Pi.",
      "- Never overwrite user data or secrets.",
      ""
    ].join("\n"));
  }
  const systemPath = path.join(config.piDir, "SYSTEM.md");
  if (!existsSync(systemPath)) {
    await writeFile(systemPath, [
      "# WorkGraph OS System",
      "",
      "Local-first AI work graph runtime. Skills live in `.pi/skills` and mirror metadata into `data/skills`.",
      ""
    ].join("\n"));
  }
}

export async function buildPiExecutionContext(config: PiSkillAdapterConfig, input: {
  goal: string;
  workflowId: string;
  node: unknown;
  brand: unknown;
  assets: unknown[];
  skill: Record<string, unknown> | null;
  modelPolicy: unknown;
  promptRecord: unknown;
}) {
  await ensurePiAdapterSystem(config);
  if (input.skill) await ensurePiSkillFiles(config, input.skill);
  const skillDir = input.skill ? piSkillDiskDirs(config, input.skill)[0] : path.join(config.piDir, "skills");
  const mirrorSkillDir = input.skill ? piSkillDiskDirs(config, input.skill)[1] : config.skillDataDir;
  return {
    source: "pi-adapter" as const,
    goal: input.goal,
    workflowId: input.workflowId,
    node: input.node,
    brand: input.brand,
    assets: input.assets,
    skill: input.skill,
    modelPolicy: input.modelPolicy,
    promptRecord: input.promptRecord,
    localPaths: {
      piDir: config.piDir,
      skillDir,
      mirrorSkillDir,
      sessionsDir: path.join(config.piDir, "sessions")
    }
  };
}

export async function ensurePiSkillFiles(config: PiSkillAdapterConfig, skill: Record<string, unknown>, fallbackIndex = 0) {
  await ensurePiAdapterSystem(config);
  const specs = piSkillFileSpec(skill);
  for (const dir of piSkillDiskDirs(config, skill, fallbackIndex)) {
    for (const [relativePath, content] of Object.entries(specs)) {
      const filePath = path.join(dir, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      if (!existsSync(filePath)) await writeFile(filePath, content);
    }
    await mkdir(path.join(dir, "logs"), { recursive: true });
    await mkdir(path.join(dir, "versions"), { recursive: true });
  }
}

export async function writePiSkillFileToDirs(config: PiSkillAdapterConfig, skill: Record<string, unknown>, relativePath: string, content: string) {
  const safePath = safePiSkillRelativePath(relativePath);
  if (!safePath) throw new Error("Invalid Skill file path");
  for (const dir of piSkillDiskDirs(config, skill)) {
    const filePath = path.join(dir, safePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

export async function appendPiSkillLog(config: PiSkillAdapterConfig, skill: Record<string, unknown>, logName: string, payload: unknown) {
  const safeName = piSkillSlug(logName).slice(0, 80) || "skill-log";
  const createdAt = currentIso(config);
  const payloadObject = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { payload };
  const content = `${JSON.stringify({ createdAt, ...payloadObject }, null, 2)}\n`;
  for (const dir of piSkillDiskDirs(config, skill)) {
    const filePath = path.join(dir, "logs", `${createdAt.replace(/[:.]/g, "-")}-${safeName}.json`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

export async function snapshotPiSkillVersion(config: PiSkillAdapterConfig, skill: Record<string, unknown>, reason: string) {
  const createdAt = currentIso(config);
  const files = ["SKILL.md", "skill.json", "resources/guide.md", "examples/input.json", "examples/output.json"];
  for (const dir of piSkillDiskDirs(config, skill)) {
    const snapshotDir = path.join(dir, "versions", createdAt.replace(/[:.]/g, "-"));
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(path.join(snapshotDir, "version.json"), `${JSON.stringify({ createdAt, reason }, null, 2)}\n`);
    for (const relativePath of files) {
      try {
        const content = await readFile(path.join(dir, relativePath), "utf8");
        const outPath = path.join(snapshotDir, safePiSkillRelativePath(relativePath));
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, content);
      } catch {
        // Missing optional files are skipped in the version snapshot.
      }
    }
  }
  return createdAt;
}

export async function readPiSkillJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function applyPiSkillOptimization(config: PiSkillAdapterConfig, skill: Record<string, unknown>, prompt: string) {
  await ensurePiSkillFiles(config, skill);
  const createdAt = await snapshotPiSkillVersion(config, skill, prompt);
  const primaryDir = piSkillDiskDirs(config, skill)[0];
  const currentSkillMd = await readFile(path.join(primaryDir, "SKILL.md"), "utf8").catch(() => "");
  const currentGuide = await readFile(path.join(primaryDir, "resources", "guide.md"), "utf8").catch(() => "");
  const skillJsonPath = path.join(primaryDir, "skill.json");
  const currentJson = await readPiSkillJson(skillJsonPath);
  const version = objectString(currentJson, "version", objectString(skill, "version", "0.1.0"));
  const nextVersion = version.replace(/(\d+)$/, (value) => String(Number(value) + 1));
  const marker = `\n\n## Optimization ${createdAt}\n${prompt}\n\nAcceptance: review diff, preserve previous version, record execution log.\n`;
  const nextSkillMd = currentSkillMd.includes(prompt) ? currentSkillMd : `${currentSkillMd.trimEnd()}${marker}`;
  const nextGuide = currentGuide.includes(prompt) ? currentGuide : `${currentGuide.trimEnd()}\n\n## Optimization Notes\n- ${prompt}\n`;
  const nextJson = {
    ...currentJson,
    version: nextVersion,
    updatedAt: currentIso(config),
    optimizationHistory: [
      ...(Array.isArray(currentJson.optimizationHistory) ? currentJson.optimizationHistory : []),
      { createdAt, prompt, previousVersion: version, version: nextVersion }
    ].slice(-20)
  };
  await writePiSkillFileToDirs(config, skill, "SKILL.md", `${nextSkillMd.trimEnd()}\n`);
  await writePiSkillFileToDirs(config, skill, "resources/guide.md", `${nextGuide.trimEnd()}\n`);
  await writePiSkillFileToDirs(config, skill, "skill.json", `${JSON.stringify(nextJson, null, 2)}\n`);
  await appendPiSkillLog(config, skill, "optimization-applied", {
    action: "skill.optimize.apply",
    prompt,
    previousVersion: version,
    version: nextVersion
  });
  return { createdAt, previousVersion: version, version: nextVersion };
}

export async function scanPiSkillDir(root: string, source: PiSkillSource, normalizeSkill?: (input: unknown, index?: number) => Record<string, unknown>) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const skills: Record<string, unknown>[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const json = await readPiSkillJson(path.join(dir, "skill.json"));
      const title = objectString(json, "title", entry.name);
      const command = objectString(json, "command", `/${entry.name}`);
      const skill = {
        ...json,
        id: objectString(json, "id", `skill-${entry.name}`),
        title,
        command,
        source,
        skillMdPath: `skills/${entry.name}/SKILL.md`,
        filesystem: {
          root,
          dir,
          folder: entry.name,
          source
        }
      };
      skills.push(normalizeSkill ? normalizeSkill(skill, skills.length) : skill);
    }
    return skills;
  } catch {
    return [];
  }
}

export async function piSkillFileTree(dir: string, root = dir): Promise<PiSkillFileTree[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const visible = entries.filter((entry) => !entry.name.startsWith(".")).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const tree: PiSkillFileTree[] = [];
    for (const entry of visible) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        tree.push({ name: entry.name, path: relativePath, type: "directory", children: await piSkillFileTree(absolutePath, root) });
      } else {
        const info = await stat(absolutePath);
        tree.push({ name: entry.name, path: relativePath, type: "file", size: info.size });
      }
    }
    return tree;
  } catch {
    return [];
  }
}

export async function buildPiSkillDetail(config: PiSkillAdapterConfig, skill: Record<string, unknown>) {
  await ensurePiSkillFiles(config, skill);
  const folder = piSkillFolderName(skill);
  const dir = path.join(config.piDir, "skills", folder);
  const filePaths = ["SKILL.md", "skill.json", "resources/guide.md", "examples/input.json", "examples/output.json"];
  const files: PiSkillFile[] = [];
  for (const relativePath of filePaths) {
    try {
      files.push({ path: relativePath, content: await readFile(path.join(dir, relativePath), "utf8") });
    } catch {
      // Missing optional files are represented by the file tree.
    }
  }
  return {
    source: "pi-adapter" as const,
    skill,
    folder,
    piDir: dir,
    mirrorDir: path.join(config.skillDataDir, folder),
    tree: await piSkillFileTree(dir),
    files,
    onlineSearch: {
      status: "planned" as const,
      disabled: true,
      message: "Online skill search is reserved for a later phase; local Pi/data skills are active now."
    }
  };
}

export async function writePiSessionRecord(config: PiSkillAdapterConfig, session: PiSessionRecord) {
  await ensurePiAdapterSystem(config);
  const safeId = piSkillSlug(session.id || session.executionId || "session");
  const sessionDir = path.join(config.piDir, "sessions", safeId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "session.json"), `${JSON.stringify(session, null, 2)}\n`);
  await writeFile(path.join(sessionDir, "input.json"), `${JSON.stringify(session.input ?? {}, null, 2)}\n`);
  await writeFile(path.join(sessionDir, "output.json"), `${JSON.stringify(session.output ?? {}, null, 2)}\n`);
  await writeFile(path.join(sessionDir, "README.md"), [
    `# Pi Session ${session.id}`,
    "",
    `Execution: ${session.executionId}`,
    `Workflow: ${session.workflowId}`,
    `Node: ${session.nodeId}`,
    `Skill: ${session.skillId}`,
    `Result: ${session.resultId}`,
    `PromptRecord: ${session.promptRecordId}`,
    ""
  ].join("\n"));
  return {
    id: session.id,
    dir: sessionDir,
    sessionJson: path.join(sessionDir, "session.json"),
    inputJson: path.join(sessionDir, "input.json"),
    outputJson: path.join(sessionDir, "output.json")
  };
}

export async function readPiSessionRecord(config: PiSkillAdapterConfig, sessionId: string) {
  const safeId = piSkillSlug(sessionId);
  const filePath = path.join(config.piDir, "sessions", safeId, "session.json");
  return JSON.parse(await readFile(filePath, "utf8")) as PiSessionRecord;
}

export async function listPiSessionRecords(config: PiSkillAdapterConfig, limit = 20) {
  await ensurePiAdapterSystem(config);
  const sessionsDir = path.join(config.piDir, "sessions");
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const records = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const sessionJson = path.join(sessionsDir, entry.name, "session.json");
      try {
        const record = JSON.parse(await readFile(sessionJson, "utf8")) as PiSessionRecord;
        return {
          id: record.id,
          executionId: record.executionId,
          workflowId: record.workflowId,
          nodeId: record.nodeId,
          skillId: record.skillId,
          resultId: record.resultId,
          promptRecordId: record.promptRecordId,
          status: record.status,
          createdAt: record.createdAt,
          sessionJson
        };
      } catch {
        return null;
      }
    }));
  return records
    .filter((record): record is NonNullable<typeof record> => Boolean(record))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);
}

// Pi-web bridge: real HTTP execution against a local `@agegr/pi-web` instance
// (default port 30141). Modes: "auto" tries pi-web and falls back to the
// simulated runtime when unreachable; "on" requires pi-web; "off" never calls it.

export type PiWebBridgeMode = "auto" | "on" | "off";

export type PiWebBridgeConfig = {
  baseUrl: string;
  mode: PiWebBridgeMode;
  timeoutMs: number;
  // Working directory pi-web runs the agent in. Required by POST /api/agent/new.
  cwd?: string;
  // Optional pi-web provider/modelId (e.g. "vdamo" / "gpt-5.4-mini").
  provider?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
};

export type PiWebProbeResult = {
  enabled: boolean;
  reachable: boolean;
  baseUrl: string;
  mode: PiWebBridgeMode;
  version: string;
  reason: string;
};

export type PiWebRunRequest = {
  sessionId: string;
  goal: string;
  prompt: string;
  output: string;
  files: string[];
  skill?: { id: string; command: string } | null;
  modelPolicy?: unknown;
  metadata?: Record<string, unknown>;
};

export type PiWebRunResult = {
  ok: boolean;
  reachable: boolean;
  status: string;
  output: string;
  preview: string;
  artifactPaths: string[];
  piSessionId: string;
  raw: unknown;
  reason: string;
};

export function resolvePiWebBridgeMode(value: string | undefined): PiWebBridgeMode {
  const normalized = (value ?? "auto").trim().toLowerCase();
  return normalized === "on" || normalized === "off" ? normalized : "auto";
}

// Keep bridge reasons short and free of HTML/control characters so log stores
// and JSON responses stay clean when a non-pi-web server answers on the port.
export function sanitizePiWebReason(value: string) {
  const collapsed = value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  if (/<!doctype|<html/i.test(collapsed)) return "(non-JSON HTML response)";
  return collapsed.length > 180 ? collapsed.slice(0, 180) + "..." : collapsed;
}

function piWebFetch(config: PiWebBridgeConfig) {
  return config.fetchImpl ?? globalThis.fetch;
}

async function piWebRequest(config: PiWebBridgeConfig, route: string, init: RequestInit, timeoutMs: number) {
  const fetchImpl = piWebFetch(config);
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}${route}`, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) }
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// List models a live pi-web instance currently exposes (GET /api/models). Used
// for live model capability probing. Returns an empty list when unreachable.
export async function listPiWebModels(config: PiWebBridgeConfig): Promise<Array<{ id: string; provider: string; name: string }>> {
  if (config.mode === "off") return [];
  try {
    const response = await piWebRequest(config, "/api/models", { method: "GET" }, Math.min(config.timeoutMs, 3000));
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return [];
    const payload = await response.json() as Record<string, unknown>;
    const list = Array.isArray(payload.modelList) ? payload.modelList : [];
    return list
      .map((item) => ({
        id: objectString(item, "id", ""),
        provider: objectString(item, "provider", ""),
        name: objectString(item, "name", objectString(item, "id", ""))
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

export async function probePiWebBridge(config: PiWebBridgeConfig): Promise<PiWebProbeResult> {
  const base = { baseUrl: config.baseUrl, mode: config.mode, version: "" };
  if (config.mode === "off") {
    return { ...base, enabled: false, reachable: false, reason: "pi-web bridge disabled (WGOS_PIWEB_ENABLED=off)" };
  }
  try {
    const response = await piWebRequest(config, "/api/models", { method: "GET" }, Math.min(config.timeoutMs, 2500));
    // A real pi-web API answers /api/models with JSON. Any other server on the
    // port (e.g. an unrelated Next.js app returning HTML) is not pi-web.
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) {
      return { ...base, enabled: true, reachable: false, reason: `pi-web not detected on port (status ${response.status}, content-type ${contentType || "unknown"})` };
    }
    let version = "";
    try {
      const payload = await response.json() as Record<string, unknown>;
      version = typeof payload.version === "string" ? payload.version : "";
    } catch {
      return { ...base, enabled: true, reachable: false, reason: "pi-web /api/models returned invalid JSON" };
    }
    return { ...base, enabled: true, reachable: true, version, reason: "pi-web reachable" };
  } catch (error) {
    return { ...base, enabled: true, reachable: false, reason: `pi-web unreachable: ${sanitizePiWebReason((error as Error).message)}` };
  }
}

export async function runPiWebSession(config: PiWebBridgeConfig, request: PiWebRunRequest): Promise<PiWebRunResult> {
  const fail = (reason: string, reachable: boolean): PiWebRunResult => ({
    ok: false,
    reachable,
    status: "error",
    output: "",
    preview: "",
    artifactPaths: [],
    piSessionId: "",
    raw: null,
    reason
  });
  if (config.mode === "off") return fail("pi-web bridge disabled (WGOS_PIWEB_ENABLED=off)", false);
  const cwd = config.cwd ?? process.cwd();
  try {
    // pi-web (>=0.6) starts an agent turn with POST /api/agent/new. `cwd` is
    // required; provider/modelId/thinkingLevel are pulled out and the remaining
    // body is forwarded to the coding-agent session as the user message.
    const response = await piWebRequest(config, "/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        cwd,
        provider: config.provider,
        modelId: config.modelId,
        type: "message",
        message: request.prompt,
        files: request.files,
        metadata: { ...(request.metadata ?? {}), goal: request.goal, output: request.output, skill: request.skill }
      })
    }, config.timeoutMs);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return fail(`pi-web /api/agent/new responded ${response.status}${body ? `: ${sanitizePiWebReason(body)}` : ""}`, response.status < 500);
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      return fail("pi-web /api/agent/new returned non-JSON output", true);
    }
    const piSessionId = objectString(payload, "sessionId", request.sessionId);
    if (payload.success === false || !piSessionId) {
      return fail(`pi-web /api/agent/new did not start a session: ${sanitizePiWebReason(JSON.stringify(payload).slice(0, 180))}`, true);
    }
    // Collect the agent turn output from the SSE event stream. Only a terminal
    // event with returned output counts as a completed run; otherwise we report
    // the run as dispatched-but-unconfirmed and the caller stays simulated.
    const collected = await collectPiWebEvents(config, piSessionId);
    if (!collected.terminal) {
      return fail(`pi-web session ${piSessionId} dispatched but returned no terminal output within ${config.timeoutMs}ms`, true);
    }
    return {
      ok: !collected.error,
      reachable: true,
      status: collected.error ? "error" : "done",
      output: collected.output,
      preview: collected.output,
      artifactPaths: collected.files,
      piSessionId,
      raw: { start: payload, events: collected.eventCount },
      reason: collected.error ? "pi-web reported execution failure" : "pi-web execution complete"
    };
  } catch (error) {
    const reason = (error as Error).name === "AbortError"
      ? `pi-web execution timed out after ${config.timeoutMs}ms`
      : `pi-web unreachable: ${sanitizePiWebReason((error as Error).message)}`;
    return fail(reason, false);
  }
}

// Read the pi-web agent SSE stream (GET /api/agent/[id]/events) until a terminal
// event or timeout. Defensive parsing: pi-web forwards raw coding-agent events,
// so we accumulate any text-like fields and detect file artifacts and terminal
// signals without depending on the exact event schema.
async function collectPiWebEvents(config: PiWebBridgeConfig, sessionId: string) {
  const result = { terminal: false, error: false, output: "", files: [] as string[], eventCount: 0 };
  const fetchImpl = piWebFetch(config);
  if (typeof fetchImpl !== "function") return result;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const textParts: string[] = [];
  const files = new Set<string>();
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/api/agent/${encodeURIComponent(sessionId)}/events`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
      signal: controller.signal
    });
    if (!response.ok || !response.body) return result;
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json || json === "[DONE]") { if (json === "[DONE]") result.terminal = true; continue; }
        let event: Record<string, unknown>;
        try { event = JSON.parse(json) as Record<string, unknown>; } catch { continue; }
        result.eventCount += 1;
        const type = objectString(event, "type", "");
        for (const key of ["text", "content", "message", "delta", "output"]) {
          const value2 = objectField(event, key);
          if (typeof value2 === "string" && value2.trim()) textParts.push(value2);
        }
        for (const key of ["path", "file"]) {
          const value2 = objectString(event, key, "");
          if (value2) files.add(value2);
        }
        for (const value2 of objectStringArray(event, "files")) files.add(value2);
        if (/error|failed/i.test(type)) result.error = true;
        if (/complete|completed|done|finished|idle|turn_end|turn_complete|result|stopped|end/i.test(type)) {
          result.terminal = true;
          break;
        }
      }
      if (result.terminal) break;
    }
    reader.cancel().catch(() => {});
  } catch {
    // Stream aborted or pi-web closed the connection; fall through with what we have.
  } finally {
    clearTimeout(timer);
  }
  result.output = textParts.join("").trim();
  result.files = Array.from(files);
  return result;
}
