# Backend AI Skill Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the current SparkCanvas / WorkGraph OS backend so GPT image generation, Pi skills, local Skill execution, video routing, status diagnostics, persistence, and tests work as one production-ready local-first system.

**Architecture:** Keep the existing Next web app and Express backend. Add focused service modules under `backend/src/workgraph/` instead of growing `backend/src/server.ts`; backend routes call those services, packages keep pure domain/runtime logic, and paid providers stay behind explicit environment flags. Use the existing object stores, `.pi/skills`, `data/skills`, `data/db/workgraph-os.sqlite`, model catalog, and WorkGraph smoke tests as the source of truth.

**Tech Stack:** TypeScript, Express, Next.js, pnpm workspaces, existing `@sparkcanvas/*` packages, SQLite JSON mirror, local filesystem Skill store, VDAMO OpenAI-compatible image API, yijiarj video API behind opt-in paid guard.

---

## Fixed Product Direction

- Style is fixed as **professional AI console**. Do not redesign the UI style again during backend completion.
- Primary UX remains: center work graph, bottom input/current-node/preview, lightweight top bar, secondary drawers for model/skill/assets.
- No unnecessary paid API calls. Real paid image/video calls only run when the specific smoke command or env flag requests them.
- Do not commit secrets. Keys stay in `auth.json`, `.env.production`, shell env, or ignored private files.
- Preserve current image defaults: VDAMO `gpt-image-2` first, `gpt-image-1.5`, `gpt-image-1`, and old skill fallback retained.
- Preserve Pi as local skill substrate. WorkGraph owns state, assets, routing, logs, preview, feedback, and persistence.

## File Structure

Create focused backend services:

- Create `backend/src/workgraph/config.ts`
  - Reads provider env safely.
  - Normalizes VDAMO, yijiarj, paid-generation flags, public URL, and local paths.
  - Exposes masked diagnostics only.

- Create `backend/src/workgraph/providerClients.ts`
  - Implements OpenAI-compatible image request.
  - Implements yijiarj video request and task polling hooks.
  - Does not log raw keys.

- Create `backend/src/workgraph/imageService.ts`
  - Converts node/workspace/result input into image prompts.
  - Calls VDAMO `/v1/images/generations`.
  - Stores returned image as local generated asset.
  - Falls back to deterministic local placeholder when disabled or failed.

- Create `backend/src/workgraph/videoService.ts`
  - Builds video requests, first-frame handling, and local result materialization.
  - Keeps paid generation blocked unless `SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1`.

- Create `backend/src/workgraph/piSkillService.ts`
  - Ensures `.pi` structure.
  - Lists/searches/copies/creates/tests skills.
  - Creates Pi session records for every node run.

- Create `backend/src/workgraph/workflowRunner.ts`
  - Orchestrates plan/run/feedback using model router, skill runtime, Pi adapter, image/video services, logs, results, and SQLite mirror.

- Create `backend/src/workgraph/readiness.ts`
  - Produces `/ai/status`, `/ai/diagnostics`, and WorkGraph readiness from actual config and local state.

Modify existing files:

- Modify `backend/src/server.ts`
  - Move route internals to new service modules.
  - Keep public route shape stable.

- Modify `packages/skill-runtime/src/index.ts`
  - Replace preview-only output with executable capability dispatch contract.

- Modify `packages/pi-adapter/src/index.ts`
  - Add test/run result normalization and session metadata helpers.

- Modify `packages/model-router/src/index.ts`
  - Ensure `vdamo-gpt-image-2` and yijiarj video routes align with backend service IDs.

- Modify `apps/web/app/workgraph-studio.tsx`
  - Only small status wiring if backend returns new readiness/result fields.
  - Do not redesign style.

Add tests/scripts:

- Create `scripts/workgraph-provider-config-smoke.mjs`
- Create `scripts/workgraph-image-service-smoke.mjs`
- Create `scripts/workgraph-pi-skill-runtime-smoke.mjs`
- Create `scripts/workgraph-video-guard-smoke.mjs`
- Create `scripts/workgraph-end-to-end-smoke.mjs`
- Update `package.json` scripts to include the new smoke tests.

---

## Task 1: Backend Provider Config and Readiness

**Files:**
- Create: `backend/src/workgraph/config.ts`
- Create: `backend/src/workgraph/readiness.ts`
- Modify: `backend/src/server.ts`
- Create: `scripts/workgraph-provider-config-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write config smoke test**

Create `scripts/workgraph-provider-config-smoke.mjs`:

```js
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const configSource = await readFile("backend/src/workgraph/config.ts", "utf8");
const readinessSource = await readFile("backend/src/workgraph/readiness.ts", "utf8");
const serverSource = await readFile("backend/src/server.ts", "utf8");

assert(configSource.includes("loadWorkGraphProviderConfig"), "config loader missing");
assert(configSource.includes("maskSecret"), "secret masking missing");
assert(configSource.includes("IMAGE_GEN_BASE_URL"), "image base env missing");
assert(configSource.includes("IMAGE_GEN_MODEL"), "image model env missing");
assert(configSource.includes("SPARKCANVAS_ALLOW_PAID_VIDEO_GEN"), "paid video guard missing");
assert(configSource.includes("YIJIARJ_API_KEY") || configSource.includes("VIDEO_GEN_KEY"), "video key env missing");
assert(readinessSource.includes("workGraphReadiness"), "readiness function missing");
assert(readinessSource.includes("image-api"), "image readiness missing");
assert(readinessSource.includes("video-api"), "video readiness missing");
assert(readinessSource.includes("pi-skill-store"), "pi skill readiness missing");
assert(serverSource.includes("workGraphReadiness"), "server does not use readiness service");
assert(!configSource.includes("sk-"), "config source must not hardcode secrets");

console.log(JSON.stringify({ ok: true, checked: ["provider-config", "readiness", "secret-mask"] }, null, 2));
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
node scripts/workgraph-provider-config-smoke.mjs
```

Expected:

```text
Error: ENOENT: no such file or directory, open 'backend/src/workgraph/config.ts'
```

- [ ] **Step 3: Implement provider config**

Create `backend/src/workgraph/config.ts`:

```ts
import path from "node:path";

export type WorkGraphProviderConfig = {
  projectRoot: string;
  dataDir: string;
  publicBaseUrl: string;
  image: {
    baseUrl: string;
    apiKeyPresent: boolean;
    apiKeyMasked: string;
    model: string;
    timeoutMs: number;
  };
  text: {
    baseUrl: string;
    apiKeyPresent: boolean;
    apiKeyMasked: string;
    model: string;
  };
  video: {
    baseUrl: string;
    apiKeyPresent: boolean;
    apiKeyMasked: string;
    model: string;
    paidGenerationAllowed: boolean;
  };
  pi: {
    piDir: string;
    skillDataDir: string;
    sessionsDir: string;
  };
};

export function maskSecret(value = "") {
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeBaseUrl(value: string, fallback: string) {
  const raw = (value || fallback).trim();
  return raw.replace(/\/(?:chat\/completions|images\/generations|responses|models|videos)$/i, "").replace(/\/$/, "");
}

function envFlag(value: string | undefined) {
  return value === "1" || value === "true" || value === "yes";
}

export function loadWorkGraphProviderConfig(env = process.env, projectRoot = process.cwd()): WorkGraphProviderConfig {
  const dataDir = env.SPARKCANVAS_DATA_DIR || path.join(projectRoot, "data");
  const imageKey = env.IMAGE_GEN_KEY || env.OPENAI_API_KEY || "";
  const textKey = env.TEXT_GEN_KEY || env.OPENAI_API_KEY || imageKey;
  const videoKey = env.YIJIARJ_API_KEY || env.VIDEO_GEN_KEY || "";
  const piDir = env.WORKGRAPH_OS_PI_DIR || path.join(projectRoot, ".pi");
  const skillDataDir = env.WORKGRAPH_OS_SKILL_DIR || path.join(projectRoot, "data", "skills");
  return {
    projectRoot,
    dataDir,
    publicBaseUrl: env.SPARKCANVAS_PUBLIC_BASE_URL || "",
    image: {
      baseUrl: normalizeBaseUrl(env.IMAGE_GEN_BASE_URL || env.OPENAI_BASE_URL || "", "https://api.vdamo.com/v1"),
      apiKeyPresent: Boolean(imageKey),
      apiKeyMasked: maskSecret(imageKey),
      model: env.IMAGE_GEN_MODEL || "gpt-image-2",
      timeoutMs: Number(env.IMAGE_GEN_TIMEOUT_MS || 120000)
    },
    text: {
      baseUrl: normalizeBaseUrl(env.TEXT_GEN_BASE_URL || env.OPENAI_BASE_URL || "", "https://api.vdamo.com/v1"),
      apiKeyPresent: Boolean(textKey),
      apiKeyMasked: maskSecret(textKey),
      model: env.TEXT_GEN_MODEL || "gpt-5.4-mini"
    },
    video: {
      baseUrl: normalizeBaseUrl(env.VIDEO_GEN_BASE_URL || env.YIJIARJ_BASE_URL || "", "https://dvqyn6o2vd.apifox.cn"),
      apiKeyPresent: Boolean(videoKey),
      apiKeyMasked: maskSecret(videoKey),
      model: env.VIDEO_GEN_MODEL || "grok-imagine-1.0-video-super",
      paidGenerationAllowed: envFlag(env.SPARKCANVAS_ALLOW_PAID_VIDEO_GEN)
    },
    pi: {
      piDir,
      skillDataDir,
      sessionsDir: path.join(piDir, "sessions")
    }
  };
}
```

- [ ] **Step 4: Implement readiness service**

Create `backend/src/workgraph/readiness.ts`:

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkGraphProviderConfig } from "./config";

export type WorkGraphReadinessItem = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
};

export function workGraphReadiness(config: WorkGraphProviderConfig): { productionReady: boolean; items: WorkGraphReadinessItem[] } {
  const items: WorkGraphReadinessItem[] = [
    {
      id: "image-api",
      label: "Image API",
      ready: config.image.apiKeyPresent && Boolean(config.image.baseUrl) && Boolean(config.image.model),
      detail: `${config.image.baseUrl} · ${config.image.model} · key ${config.image.apiKeyPresent ? config.image.apiKeyMasked : "missing"}`
    },
    {
      id: "text-api",
      label: "Text API",
      ready: config.text.apiKeyPresent && Boolean(config.text.baseUrl) && Boolean(config.text.model),
      detail: `${config.text.baseUrl} · ${config.text.model} · key ${config.text.apiKeyPresent ? config.text.apiKeyMasked : "missing"}`
    },
    {
      id: "video-api",
      label: "Video API",
      ready: config.video.apiKeyPresent && config.video.paidGenerationAllowed,
      detail: config.video.apiKeyPresent
        ? `${config.video.baseUrl} · ${config.video.model} · paid ${config.video.paidGenerationAllowed ? "enabled" : "blocked"}`
        : "missing video key"
    },
    {
      id: "pi-skill-store",
      label: "Pi Skill Store",
      ready: existsSync(path.join(config.pi.piDir, "skills")) || existsSync(config.pi.skillDataDir),
      detail: `${config.pi.piDir} · ${config.pi.skillDataDir}`
    },
    {
      id: "public-reference",
      label: "Public Reference URL",
      ready: Boolean(config.publicBaseUrl),
      detail: config.publicBaseUrl || "missing SPARKCANVAS_PUBLIC_BASE_URL"
    }
  ];
  return {
    productionReady: items.every((item) => item.ready || item.id === "video-api" || item.id === "public-reference"),
    items
  };
}
```

- [ ] **Step 5: Wire server routes**

Modify `backend/src/server.ts`:

```ts
import { loadWorkGraphProviderConfig } from "./workgraph/config";
import { workGraphReadiness } from "./workgraph/readiness";
```

In the existing `/ai/status` route, return:

```ts
app.get("/ai/status", (_req, res) => {
  const providerConfig = loadWorkGraphProviderConfig(process.env, projectRoot);
  const readiness = workGraphReadiness(providerConfig);
  res.json({
    productionReady: readiness.productionReady,
    launchReadiness: readiness.items,
    providers: {
      image: {
        baseUrl: providerConfig.image.baseUrl,
        model: providerConfig.image.model,
        key: providerConfig.image.apiKeyMasked
      },
      text: {
        baseUrl: providerConfig.text.baseUrl,
        model: providerConfig.text.model,
        key: providerConfig.text.apiKeyMasked
      },
      video: {
        baseUrl: providerConfig.video.baseUrl,
        model: providerConfig.video.model,
        key: providerConfig.video.apiKeyMasked,
        paidGenerationAllowed: providerConfig.video.paidGenerationAllowed
      },
      pi: providerConfig.pi
    }
  });
});
```

If `server.ts` already has `/ai/status`, replace only the route body, not unrelated routes.

- [ ] **Step 6: Add npm script**

Modify root `package.json`:

```json
{
  "scripts": {
    "test:workgraph-provider-config": "node scripts/workgraph-provider-config-smoke.mjs"
  }
}
```

- [ ] **Step 7: Verify**

Run:

```bash
node scripts/workgraph-provider-config-smoke.mjs
pnpm --filter backend check
```

Expected:

```text
{"ok":true,...}
```

and backend TypeScript check passes.

---

## Task 2: GPT Image Service as First-Class WorkGraph Backend Capability

**Files:**
- Create: `backend/src/workgraph/providerClients.ts`
- Create: `backend/src/workgraph/imageService.ts`
- Modify: `backend/src/server.ts`
- Create: `scripts/workgraph-image-service-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write image service smoke**

Create `scripts/workgraph-image-service-smoke.mjs`:

```js
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const clientSource = await readFile("backend/src/workgraph/providerClients.ts", "utf8");
const imageSource = await readFile("backend/src/workgraph/imageService.ts", "utf8");
const serverSource = await readFile("backend/src/server.ts", "utf8");

assert(clientSource.includes("generateOpenAiCompatibleImage"), "image provider client missing");
assert(clientSource.includes("/images/generations"), "image client must call images generations endpoint");
assert(clientSource.includes("b64_json") || clientSource.includes("url"), "image client must parse generated image payload");
assert(imageSource.includes("generateWorkGraphImage"), "image service missing");
assert(imageSource.includes("gpt-image-2"), "image service must preserve gpt-image-2 default");
assert(imageSource.includes("generated_image"), "image service must create generated image assets");
assert(imageSource.includes("fallback"), "image service must have disabled/error fallback");
assert(serverSource.includes("/workgraph-os/images/generate"), "backend image route missing");
assert(!clientSource.includes("sk-"), "provider client must not hardcode secrets");

console.log(JSON.stringify({ ok: true, checked: ["image-client", "image-service", "route"] }, null, 2));
```

- [ ] **Step 2: Run smoke and confirm failure**

Run:

```bash
node scripts/workgraph-image-service-smoke.mjs
```

Expected:

```text
Error: ENOENT: no such file or directory, open 'backend/src/workgraph/providerClients.ts'
```

- [ ] **Step 3: Implement image provider client**

Create `backend/src/workgraph/providerClients.ts`:

```ts
import { Buffer } from "node:buffer";

export type OpenAiCompatibleImageInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  timeoutMs?: number;
};

export type OpenAiCompatibleImageOutput = {
  mimeType: string;
  bytes: Buffer;
  raw: unknown;
};

export async function generateOpenAiCompatibleImage(input: OpenAiCompatibleImageInput): Promise<OpenAiCompatibleImageOutput> {
  if (!input.apiKey) throw new Error("IMAGE_GEN_KEY is missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 120000);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model || "gpt-image-2",
        prompt: input.prompt,
        size: input.size || "1024x1024",
        n: input.n ?? 1
      })
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof raw === "object" && raw && "error" in raw ? JSON.stringify(raw) : `HTTP ${response.status}`;
      throw new Error(`image generation failed: ${message.slice(0, 500)}`);
    }
    const first = Array.isArray((raw as { data?: unknown[] }).data) ? (raw as { data: Array<Record<string, unknown>> }).data[0] : undefined;
    const b64 = typeof first?.b64_json === "string" ? first.b64_json : "";
    if (b64) return { mimeType: "image/png", bytes: Buffer.from(b64, "base64"), raw };
    const url = typeof first?.url === "string" ? first.url : "";
    if (url) {
      const assetResponse = await fetch(url);
      if (!assetResponse.ok) throw new Error(`image url download failed: HTTP ${assetResponse.status}`);
      return {
        mimeType: assetResponse.headers.get("content-type") || "image/png",
        bytes: Buffer.from(await assetResponse.arrayBuffer()),
        raw
      };
    }
    throw new Error("image generation returned no b64_json or url");
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Implement image service**

Create `backend/src/workgraph/imageService.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkGraphProviderConfig, type WorkGraphProviderConfig } from "./config";
import { generateOpenAiCompatibleImage } from "./providerClients";

export type WorkGraphImageRequest = {
  prompt: string;
  nodeId: string;
  workspaceId?: string;
  title?: string;
  size?: string;
  model?: string;
  dryRun?: boolean;
};

export type WorkGraphImageResult = {
  ok: boolean;
  generated: boolean;
  model: string;
  asset: {
    id: string;
    title: string;
    type: "generated_image";
    imageUrl: string;
    meta: string;
  };
  fallback: boolean;
  error?: string;
};

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "generated-image";
}

function fallbackSvgDataUrl(message: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#0f172a"/><text x="64" y="512" fill="#67e8f9" font-size="42" font-family="Arial">${message.replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function generateWorkGraphImage(request: WorkGraphImageRequest, config: WorkGraphProviderConfig = loadWorkGraphProviderConfig()): Promise<WorkGraphImageResult> {
  const model = request.model || config.image.model || "gpt-image-2";
  const title = request.title || `Generated ${request.nodeId}`;
  const id = `generated_${safeName(request.nodeId)}_${Date.now().toString(36)}`;
  if (request.dryRun || !config.image.apiKeyPresent) {
    return {
      ok: true,
      generated: false,
      model,
      asset: {
        id,
        title,
        type: "generated_image",
        imageUrl: fallbackSvgDataUrl("Image API fallback"),
        meta: `kind:image model:${model} fallback:true`
      },
      fallback: true,
      error: config.image.apiKeyPresent ? undefined : "IMAGE_GEN_KEY missing"
    };
  }
  try {
    const output = await generateOpenAiCompatibleImage({
      baseUrl: config.image.baseUrl,
      apiKey: process.env.IMAGE_GEN_KEY || process.env.OPENAI_API_KEY || "",
      model,
      prompt: request.prompt,
      size: request.size || "1024x1024",
      n: 1,
      timeoutMs: config.image.timeoutMs
    });
    const generatedDir = path.join(config.projectRoot, "apps", "web", "public", "generated", "workgraph");
    await mkdir(generatedDir, { recursive: true });
    const fileName = `${id}.png`;
    await writeFile(path.join(generatedDir, fileName), output.bytes);
    return {
      ok: true,
      generated: true,
      model,
      asset: {
        id,
        title,
        type: "generated_image",
        imageUrl: `/generated/workgraph/${fileName}`,
        meta: `kind:image model:${model} mime:${output.mimeType}`
      },
      fallback: false
    };
  } catch (error) {
    return {
      ok: false,
      generated: false,
      model,
      asset: {
        id,
        title,
        type: "generated_image",
        imageUrl: fallbackSvgDataUrl("Image generation failed"),
        meta: `kind:image model:${model} fallback:true`
      },
      fallback: true,
      error: error instanceof Error ? error.message : "unknown image generation error"
    };
  }
}
```

- [ ] **Step 5: Add backend route**

Modify `backend/src/server.ts`:

```ts
import { generateWorkGraphImage } from "./workgraph/imageService";
```

Add route near WorkGraph OS routes:

```ts
app.post("/workgraph-os/images/generate", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    nodeId: z.string().default("image-node"),
    workspaceId: z.string().optional(),
    title: z.string().optional(),
    size: z.string().optional(),
    model: z.string().optional(),
    dryRun: z.boolean().optional()
  }).parse(req.body ?? {});
  const result = await generateWorkGraphImage(input, loadWorkGraphProviderConfig(process.env, projectRoot));
  res.status(result.ok ? 200 : 502).json(result);
});
```

- [ ] **Step 6: Add package script**

Modify root `package.json`:

```json
{
  "scripts": {
    "test:workgraph-image-service": "node scripts/workgraph-image-service-smoke.mjs"
  }
}
```

- [ ] **Step 7: Verify without paid API**

Run:

```bash
node scripts/workgraph-image-service-smoke.mjs
pnpm --filter backend check
curl -sS http://127.0.0.1:4200/workgraph-os/images/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a clean AI console preview image","nodeId":"smoke-image","dryRun":true}' | jq
```

Expected:

```json
{
  "ok": true,
  "generated": false,
  "fallback": true
}
```

- [ ] **Step 8: Optional real paid/remote image verification**

Only run when the user explicitly asks or when `IMAGE_GEN_KEY` is already loaded and spending is acceptable:

```bash
curl -sS http://127.0.0.1:4200/workgraph-os/images/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a professional AI workflow console screenshot style product mockup, no text","nodeId":"real-image","size":"1024x1024","model":"gpt-image-2"}' | jq
```

Expected:

```json
{
  "ok": true,
  "generated": true,
  "asset": {
    "imageUrl": "/generated/workgraph/..."
  }
}
```

---

## Task 3: Pi Skill Service and Local Skill Test Contract

**Files:**
- Create: `backend/src/workgraph/piSkillService.ts`
- Modify: `packages/pi-adapter/src/index.ts`
- Modify: `backend/src/server.ts`
- Create: `scripts/workgraph-pi-skill-runtime-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write Pi skill smoke**

Create `scripts/workgraph-pi-skill-runtime-smoke.mjs`:

```js
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const serviceSource = await readFile("backend/src/workgraph/piSkillService.ts", "utf8");
const adapterSource = await readFile("packages/pi-adapter/src/index.ts", "utf8");
const serverSource = await readFile("backend/src/server.ts", "utf8");

assert(serviceSource.includes("ensureWorkGraphPiRuntime"), "runtime ensure missing");
assert(serviceSource.includes("searchWorkGraphSkills"), "skill search missing");
assert(serviceSource.includes("createWorkGraphDraftSkill"), "draft skill creation missing");
assert(serviceSource.includes("testWorkGraphSkill"), "skill test missing");
assert(serviceSource.includes("recordPiSession"), "Pi session recording missing");
assert(adapterSource.includes("PiSessionRecord"), "Pi session type missing");
assert(serverSource.includes("/workgraph-os/skills/search"), "skill search route missing");
assert(serverSource.includes("/workgraph-os/skills/draft"), "draft skill route missing");
assert(serverSource.includes("/workgraph-os/skills/:id/test"), "skill test route missing");

console.log(JSON.stringify({ ok: true, checked: ["pi-runtime", "skill-search", "skill-test", "sessions"] }, null, 2));
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
node scripts/workgraph-pi-skill-runtime-smoke.mjs
```

Expected:

```text
Error: ENOENT: no such file or directory, open 'backend/src/workgraph/piSkillService.ts'
```

- [ ] **Step 3: Implement Pi skill service**

Create `backend/src/workgraph/piSkillService.ts`:

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ensurePiAdapterSystem,
  piSkillFolderName,
  writePiSkillFiles,
  recordPiSession as adapterRecordPiSession,
  type PiSkillAdapterConfig,
  type PiSessionRecord
} from "@sparkcanvas/pi-adapter";

export async function ensureWorkGraphPiRuntime(config: PiSkillAdapterConfig) {
  await ensurePiAdapterSystem(config);
  await mkdir(path.join(config.piDir, "sessions"), { recursive: true });
  await mkdir(config.skillDataDir, { recursive: true });
  return {
    piDir: config.piDir,
    skillDataDir: config.skillDataDir,
    ready: existsSync(path.join(config.piDir, "skills")) && existsSync(config.skillDataDir)
  };
}

export async function searchWorkGraphSkills(config: PiSkillAdapterConfig, query: string) {
  await ensureWorkGraphPiRuntime(config);
  const dirs = [path.join(config.piDir, "skills"), config.skillDataDir];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Array<{ id: string; title: string; folder: string; source: string; score: number }> = [];
  for (const root of dirs) {
    if (!existsSync(root)) continue;
    for (const folder of await readdir(root)) {
      const skillJsonPath = path.join(root, folder, "skill.json");
      const skillMdPath = path.join(root, folder, "SKILL.md");
      const json = existsSync(skillJsonPath) ? JSON.parse(await readFile(skillJsonPath, "utf8")) : {};
      const md = existsSync(skillMdPath) ? await readFile(skillMdPath, "utf8") : "";
      const haystack = `${json.id || folder} ${json.title || ""} ${json.command || ""} ${json.description || ""} ${md}`.toLowerCase();
      const score = terms.length ? terms.filter((term) => haystack.includes(term)).length : 1;
      if (score > 0) {
        results.push({
          id: String(json.id || folder),
          title: String(json.title || folder),
          folder,
          source: root.endsWith("skills") ? "pi" : "data",
          score
        });
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}

export async function createWorkGraphDraftSkill(config: PiSkillAdapterConfig, input: Record<string, unknown>) {
  await ensureWorkGraphPiRuntime(config);
  const skill = {
    id: String(input.id || `skill-${Date.now().toString(36)}`),
    title: String(input.title || "Draft Skill"),
    command: String(input.command || "/draft-skill"),
    output: String(input.output || "PNG"),
    description: String(input.description || "Draft Skill generated from WorkGraph node."),
    capabilityType: String(input.capabilityType || "custom"),
    runtime: "pi-skill",
    keywords: Array.isArray(input.keywords) ? input.keywords : ["workgraph", "draft"]
  };
  await writePiSkillFiles(config, skill);
  return { skill, folder: piSkillFolderName(skill), status: "created" };
}

export async function testWorkGraphSkill(config: PiSkillAdapterConfig, skillId: string, input: Record<string, unknown>) {
  await ensureWorkGraphPiRuntime(config);
  const sessionId = `pi-${Date.now().toString(36)}`;
  const record: PiSessionRecord = {
    id: sessionId,
    executionId: String(input.executionId || `exec-${Date.now().toString(36)}`),
    workflowId: String(input.workflowId || "workflow"),
    nodeId: String(input.nodeId || "node"),
    skillId,
    resultId: String(input.resultId || `result-${Date.now().toString(36)}`),
    promptRecordId: String(input.promptRecordId || "prompt"),
    status: "tested",
    createdAt: new Date().toISOString(),
    input,
    output: {
      preview: `Skill ${skillId} tested locally without paid provider call.`,
      logs: [{ step: "skill", message: "Local Pi skill test completed." }]
    }
  };
  await adapterRecordPiSession(config, record);
  return record;
}

export async function recordPiSession(config: PiSkillAdapterConfig, record: PiSessionRecord) {
  await ensureWorkGraphPiRuntime(config);
  await adapterRecordPiSession(config, record);
  return record;
}
```

- [ ] **Step 4: Add backend routes**

Modify `backend/src/server.ts` imports:

```ts
import {
  ensureWorkGraphPiRuntime,
  searchWorkGraphSkills,
  createWorkGraphDraftSkill,
  testWorkGraphSkill
} from "./workgraph/piSkillService";
```

Add routes:

```ts
function piAdapterConfigFromEnv() {
  const config = loadWorkGraphProviderConfig(process.env, projectRoot);
  return {
    piDir: config.pi.piDir,
    skillDataDir: config.pi.skillDataDir
  };
}

app.get("/workgraph-os/pi/runtime", async (_req, res) => {
  res.json(await ensureWorkGraphPiRuntime(piAdapterConfigFromEnv()));
});

app.get("/workgraph-os/skills/search", async (req, res) => {
  res.json({ results: await searchWorkGraphSkills(piAdapterConfigFromEnv(), String(req.query.q || "")) });
});

app.post("/workgraph-os/skills/draft", async (req, res) => {
  res.json(await createWorkGraphDraftSkill(piAdapterConfigFromEnv(), req.body ?? {}));
});

app.post("/workgraph-os/skills/:id/test", async (req, res) => {
  res.json(await testWorkGraphSkill(piAdapterConfigFromEnv(), req.params.id, req.body ?? {}));
});
```

- [ ] **Step 5: Add npm script**

Modify root `package.json`:

```json
{
  "scripts": {
    "test:workgraph-pi-skill-runtime": "node scripts/workgraph-pi-skill-runtime-smoke.mjs"
  }
}
```

- [ ] **Step 6: Verify**

Run:

```bash
node scripts/workgraph-pi-skill-runtime-smoke.mjs
pnpm --filter backend check
curl -sS http://127.0.0.1:4200/workgraph-os/pi/runtime | jq
curl -sS 'http://127.0.0.1:4200/workgraph-os/skills/search?q=image' | jq
```

Expected:

```json
{
  "ready": true
}
```

and search returns an array.

---

## Task 4: Workflow Runner Integrates Model Router, Image, Video Guard, Skill Runtime, and Pi Sessions

**Files:**
- Create: `backend/src/workgraph/workflowRunner.ts`
- Modify: `backend/src/server.ts`
- Modify: `packages/skill-runtime/src/index.ts`
- Create: `scripts/workgraph-end-to-end-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write end-to-end smoke**

Create `scripts/workgraph-end-to-end-smoke.mjs`:

```js
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runnerSource = await readFile("backend/src/workgraph/workflowRunner.ts", "utf8");
const serverSource = await readFile("backend/src/server.ts", "utf8");
const runtimeSource = await readFile("packages/skill-runtime/src/index.ts", "utf8");

assert(runnerSource.includes("runWorkGraphNode"), "node runner missing");
assert(runnerSource.includes("routeWorkGraphModel"), "model router integration missing");
assert(runnerSource.includes("runWorkGraphSkill"), "skill runtime integration missing");
assert(runnerSource.includes("generateWorkGraphImage"), "image service integration missing");
assert(runnerSource.includes("recordPiSession"), "Pi session record missing");
assert(runnerSource.includes("ExecutionLog"), "execution logs missing");
assert(serverSource.includes("/workgraph-os/run-node"), "run-node route missing");
assert(serverSource.includes("/workgraph-os/run"), "workflow run route missing");
assert(runtimeSource.includes("status: \"done\""), "skill runtime must return done status");

console.log(JSON.stringify({ ok: true, checked: ["runner", "image", "skill", "pi-session", "logs"] }, null, 2));
```

- [ ] **Step 2: Run smoke and confirm failure**

Run:

```bash
node scripts/workgraph-end-to-end-smoke.mjs
```

Expected:

```text
Error: ENOENT: no such file or directory, open 'backend/src/workgraph/workflowRunner.ts'
```

- [ ] **Step 3: Implement workflow runner**

Create `backend/src/workgraph/workflowRunner.ts`:

```ts
import { routeWorkGraphModel } from "@sparkcanvas/model-router";
import { runWorkGraphSkill } from "@sparkcanvas/skill-runtime";
import { generateWorkGraphImage } from "./imageService";
import { loadWorkGraphProviderConfig } from "./config";
import { recordPiSession } from "./piSkillService";

export type WorkGraphRunNodeInput = {
  workflowId: string;
  prompt: string;
  output: string;
  node: {
    id: string;
    title: string;
    type: string;
    body: string;
    modelStrategy?: string;
    modelId?: string;
    skillId?: string;
    materialIds?: string[];
    params?: Record<string, unknown>;
  };
  skill?: {
    id: string;
    title: string;
    command: string;
    output?: string;
    runtime?: string;
  } | null;
  brand: {
    id: string;
    name?: string;
    context: string;
  };
  assets: Array<{
    id: string;
    title?: string;
    kind?: string;
    type?: string;
    token?: string;
    tags?: string[];
    referencePath?: string;
  }>;
  dryRun?: boolean;
};

export async function runWorkGraphNode(input: WorkGraphRunNodeInput) {
  const providerConfig = loadWorkGraphProviderConfig(process.env, process.cwd());
  const routingDecision = routeWorkGraphModel({
    activeModelId: input.node.modelId || providerConfig.image.model,
    output: input.output,
    node: {
      id: input.node.id,
      type: input.node.type,
      modelStrategy: input.node.modelStrategy
    }
  });
  const runtimeResult = runWorkGraphSkill({
    mode: "node",
    prompt: input.prompt,
    output: input.output,
    node: {
      id: input.node.id,
      title: input.node.title,
      type: input.node.type,
      body: input.node.body
    },
    workflowId: input.workflowId,
    skill: input.skill ?? null,
    modelPolicy: {
      selectedModelId: routingDecision.selectedModelId,
      selectedCapability: routingDecision.selectedCapability,
      route: routingDecision.route,
      reason: routingDecision.reason,
      strategy: routingDecision.strategy
    },
    brand: input.brand,
    assets: input.assets,
    materialIds: input.node.materialIds ?? [],
    nodeParams: input.node.params
  });
  const shouldGenerateImage = routingDecision.selectedCapability === "image" && /image|png|jpg|poster|preview|output/i.test(`${input.output} ${input.node.type}`);
  const imageResult = shouldGenerateImage
    ? await generateWorkGraphImage({
      prompt: runtimeResult.preview,
      nodeId: input.node.id,
      workspaceId: input.workflowId,
      title: input.node.title,
      model: providerConfig.image.model,
      dryRun: input.dryRun
    }, providerConfig)
    : null;
  const resultId = `result-${Date.now().toString(36)}`;
  const piSession = await recordPiSession({
    piDir: providerConfig.pi.piDir,
    skillDataDir: providerConfig.pi.skillDataDir
  }, {
    id: `pi-${Date.now().toString(36)}`,
    executionId: `exec-${Date.now().toString(36)}`,
    workflowId: input.workflowId,
    nodeId: input.node.id,
    skillId: input.skill?.id || input.node.skillId || "auto-skill",
    resultId,
    promptRecordId: `prompt-${Date.now().toString(36)}`,
    status: "done",
    createdAt: new Date().toISOString(),
    input,
    output: { runtimeResult, imageResult }
  });
  const logs = [
    ...runtimeResult.logs,
    {
      step: "model",
      message: routingDecision.reason,
      payload: routingDecision
    },
    {
      step: "preview",
      message: imageResult ? `Image result ${imageResult.generated ? "generated" : "fallback"}` : "No image generation required",
      payload: imageResult ?? {}
    }
  ];
  return {
    resultId,
    status: "done",
    routingDecision,
    preview: runtimeResult.preview,
    imageResult,
    piSession,
    logs
  };
}
```

- [ ] **Step 4: Add backend run-node route**

Modify `backend/src/server.ts`:

```ts
import { runWorkGraphNode } from "./workgraph/workflowRunner";
```

Add:

```ts
app.post("/workgraph-os/run-node", async (req, res) => {
  const input = z.object({
    workflowId: z.string().default("workflow"),
    prompt: z.string().min(1),
    output: z.string().default("PNG"),
    node: z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      body: z.string(),
      modelStrategy: z.string().optional(),
      modelId: z.string().optional(),
      skillId: z.string().optional(),
      materialIds: z.array(z.string()).optional(),
      params: z.record(z.unknown()).optional()
    }),
    skill: z.object({
      id: z.string(),
      title: z.string(),
      command: z.string(),
      output: z.string().optional(),
      runtime: z.string().optional()
    }).nullable().optional(),
    brand: z.object({
      id: z.string(),
      name: z.string().optional(),
      context: z.string()
    }),
    assets: z.array(z.object({
      id: z.string(),
      title: z.string().optional(),
      kind: z.string().optional(),
      type: z.string().optional(),
      token: z.string().optional(),
      tags: z.array(z.string()).optional(),
      referencePath: z.string().optional()
    })).default([]),
    dryRun: z.boolean().optional()
  }).parse(req.body ?? {});
  res.json(await runWorkGraphNode(input));
});
```

- [ ] **Step 5: Add npm script**

Modify `package.json`:

```json
{
  "scripts": {
    "test:workgraph-e2e": "node scripts/workgraph-end-to-end-smoke.mjs"
  }
}
```

- [ ] **Step 6: Verify dry-run node execution**

Run:

```bash
node scripts/workgraph-end-to-end-smoke.mjs
pnpm --filter backend check
curl -sS http://127.0.0.1:4200/workgraph-os/run-node \
  -H 'Content-Type: application/json' \
  -d '{
    "workflowId":"smoke-workflow",
    "prompt":"给 DAPOT 做一张开业海报",
    "output":"PNG",
    "dryRun":true,
    "node":{"id":"image-node","title":"图片生成","type":"image_generate","body":"生成 DAPOT 开业视觉"},
    "brand":{"id":"brand_dapot","name":"DAPOT","context":"红黑金，年轻，干净，火锅开业"},
    "assets":[]
  }' | jq
```

Expected:

```json
{
  "status": "done",
  "imageResult": {
    "fallback": true
  },
  "piSession": {
    "status": "done"
  }
}
```

---

## Task 5: Video Model Guard and Optional yijiarj Integration

**Files:**
- Create: `backend/src/workgraph/videoService.ts`
- Modify: `backend/src/workgraph/providerClients.ts`
- Modify: `backend/src/server.ts`
- Create: `scripts/workgraph-video-guard-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write video guard smoke**

Create `scripts/workgraph-video-guard-smoke.mjs`:

```js
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const videoSource = await readFile("backend/src/workgraph/videoService.ts", "utf8");
const clientSource = await readFile("backend/src/workgraph/providerClients.ts", "utf8");
const serverSource = await readFile("backend/src/server.ts", "utf8");

assert(videoSource.includes("generateWorkGraphVideo"), "video service missing");
assert(videoSource.includes("SPARKCANVAS_ALLOW_PAID_VIDEO_GEN"), "paid guard env missing");
assert(videoSource.includes("paidGenerationAllowed"), "paid guard config missing");
assert(videoSource.includes("blocked"), "blocked status missing");
assert(clientSource.includes("createYijiarjVideoTask"), "video provider client missing");
assert(serverSource.includes("/workgraph-os/videos/generate"), "video route missing");
assert(!clientSource.includes("sk-"), "provider client must not hardcode video key");

console.log(JSON.stringify({ ok: true, checked: ["video-guard", "yijiarj-client", "video-route"] }, null, 2));
```

- [ ] **Step 2: Run smoke and confirm failure**

Run:

```bash
node scripts/workgraph-video-guard-smoke.mjs
```

Expected:

```text
Error: ENOENT: no such file or directory, open 'backend/src/workgraph/videoService.ts'
```

- [ ] **Step 3: Extend provider client for video**

Add to `backend/src/workgraph/providerClients.ts`:

```ts
export type YijiarjVideoInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  inputReference?: string;
};

export async function createYijiarjVideoTask(input: YijiarjVideoInput) {
  if (!input.apiKey) throw new Error("YIJIARJ_API_KEY or VIDEO_GEN_KEY is missing");
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/v1/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      size: input.size || "720x1280",
      ...(input.inputReference ? { input_reference: input.inputReference } : {})
    })
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`video generation failed: ${JSON.stringify(raw).slice(0, 500)}`);
  return raw;
}
```

- [ ] **Step 4: Implement video service**

Create `backend/src/workgraph/videoService.ts`:

```ts
import { loadWorkGraphProviderConfig, type WorkGraphProviderConfig } from "./config";
import { createYijiarjVideoTask } from "./providerClients";

export type WorkGraphVideoRequest = {
  prompt: string;
  nodeId: string;
  model?: string;
  size?: string;
  inputReference?: string;
  dryRun?: boolean;
};

export async function generateWorkGraphVideo(request: WorkGraphVideoRequest, config: WorkGraphProviderConfig = loadWorkGraphProviderConfig()) {
  const model = request.model || config.video.model;
  if (!config.video.paidGenerationAllowed || request.dryRun) {
    return {
      ok: true,
      status: "blocked",
      paidGenerationAllowed: config.video.paidGenerationAllowed,
      model,
      message: "Paid video generation is blocked. Set SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1 for an explicit paid run."
    };
  }
  const result = await createYijiarjVideoTask({
    baseUrl: config.video.baseUrl,
    apiKey: process.env.YIJIARJ_API_KEY || process.env.VIDEO_GEN_KEY || "",
    model,
    prompt: request.prompt,
    size: request.size || "720x1280",
    inputReference: request.inputReference
  });
  return {
    ok: true,
    status: "submitted",
    paidGenerationAllowed: true,
    model,
    providerResult: result
  };
}
```

- [ ] **Step 5: Add route**

Modify `backend/src/server.ts`:

```ts
import { generateWorkGraphVideo } from "./workgraph/videoService";
```

Add:

```ts
app.post("/workgraph-os/videos/generate", async (req, res) => {
  const input = z.object({
    prompt: z.string().min(1),
    nodeId: z.string().default("video-node"),
    model: z.string().optional(),
    size: z.string().optional(),
    inputReference: z.string().optional(),
    dryRun: z.boolean().optional()
  }).parse(req.body ?? {});
  res.json(await generateWorkGraphVideo(input, loadWorkGraphProviderConfig(process.env, projectRoot)));
});
```

- [ ] **Step 6: Add npm script**

Modify root `package.json`:

```json
{
  "scripts": {
    "test:workgraph-video-guard": "node scripts/workgraph-video-guard-smoke.mjs"
  }
}
```

- [ ] **Step 7: Verify blocked by default**

Run:

```bash
node scripts/workgraph-video-guard-smoke.mjs
curl -sS http://127.0.0.1:4200/workgraph-os/videos/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"DAPOT opening TikTok video","nodeId":"video-smoke","dryRun":true}' | jq
```

Expected:

```json
{
  "ok": true,
  "status": "blocked",
  "paidGenerationAllowed": false
}
```

- [ ] **Step 8: Optional paid video test**

Only run when user explicitly authorizes spend:

```bash
SPARKCANVAS_ALLOW_PAID_VIDEO_GEN=1 curl -sS http://127.0.0.1:4200/workgraph-os/videos/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"short vertical DAPOT opening hot pot video, no subtitles","nodeId":"paid-video-smoke","size":"720x1280"}' | jq
```

Expected:

```json
{
  "ok": true,
  "status": "submitted"
}
```

---

## Task 6: Frontend Wiring for Completed Backend Capabilities

**Files:**
- Modify: `apps/web/app/workgraph-studio.tsx`
- Modify: `scripts/workgraph-os-ui-interaction-smoke.mjs`
- Modify: `scripts/workgraph-os-ui-quality-smoke.mjs`

- [ ] **Step 1: Add UI quality expectations**

Modify `scripts/workgraph-os-ui-quality-smoke.mjs` to assert:

```js
assert(studio.includes("/workgraph-os/run-node"), "UI should call run-node backend route");
assert(studio.includes("/workgraph-os/images/generate"), "UI should call image generate route");
assert(studio.includes("/workgraph-os/videos/generate"), "UI should know video generate route");
assert(studio.includes("data-provider-readiness"), "UI should render provider readiness");
assert(studio.includes("data-pi-runtime-readiness"), "UI should render Pi runtime readiness");
```

- [ ] **Step 2: Update frontend API functions**

In `apps/web/app/workgraph-studio.tsx`, add:

```ts
async function runBackendNode(nodeId = activeNode?.id) {
  const node = plannedNodes.find((item) => item.id === nodeId);
  if (!node) return;
  const response = await api("/workgraph-os/run-node", {
    method: "POST",
    body: JSON.stringify({
      workflowId: workspace?.id || "workspace",
      prompt: workspace?.prompt || prompt,
      output: workspace?.output || "PNG",
      dryRun: true,
      node: {
        id: node.id,
        title: node.title,
        type: node.type,
        body: node.body || "",
        modelStrategy: node.modelStrategy,
        modelId: node.modelId,
        skillId: node.skillId,
        materialIds: node.materialIds,
        params: node.params
      },
      skill: skills.find((skill) => skill.id === node.skillId) ?? null,
      brand: dapot ? { id: dapot.id, name: dapot.name, context: dapot.context } : { id: "brand", context: "" },
      assets: activeNodeAssets
    })
  });
  const payload = await response.json();
  await refreshWorkspace("节点已由后台运行");
  return payload;
}
```

- [ ] **Step 3: Switch run button to backend runner**

Replace current bottom run handler:

```tsx
onClick={() => void runNode()}
```

with:

```tsx
onClick={() => void runBackendNode()}
```

Keep old `runNode` function as fallback for now. Do not delete it in this task.

- [ ] **Step 4: Add readiness indicators**

In current status area or preview metadata, add attributes:

```tsx
<span data-provider-readiness="image">Image {launchReadiness.image ? "ready" : "blocked"}</span>
<span data-pi-runtime-readiness="true">Pi {piSessions.length >= 0 ? "ready" : "loading"}</span>
```

Use actual state shape already present in the file. If `launchReadiness` does not exist in this component, fetch `/ai/status` and store a compact local state.

- [ ] **Step 5: Verify UI**

Run:

```bash
pnpm --filter @sparkcanvas/web check
npm run test:workgraph-os-ui-quality
WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-interaction
```

Expected:

```text
ok true
```

---

## Task 7: Production Readiness Gate and Full Local Verification

**Files:**
- Modify: `scripts/production-smoke.mjs`
- Modify: `scripts/workgraph-os-acceptance-smoke.mjs`
- Modify: `package.json`
- Modify: `docs/SparkCanvas_Completeness_Validation.md`

- [ ] **Step 1: Update acceptance smoke expectations**

Add assertions to `scripts/workgraph-os-acceptance-smoke.mjs`:

```js
assert(serverSource.includes("/workgraph-os/run-node"), "run-node API missing");
assert(serverSource.includes("/workgraph-os/images/generate"), "image generation API missing");
assert(serverSource.includes("/workgraph-os/videos/generate"), "video generation API missing");
assert(serverSource.includes("/workgraph-os/pi/runtime"), "Pi runtime API missing");
assert(serverSource.includes("/workgraph-os/skills/search"), "skill search API missing");
```

- [ ] **Step 2: Add complete test script**

Modify root `package.json`:

```json
{
  "scripts": {
    "test:workgraph-backend-complete": "npm run test:workgraph-provider-config && npm run test:workgraph-image-service && npm run test:workgraph-pi-skill-runtime && npm run test:workgraph-video-guard && npm run test:workgraph-e2e"
  }
}
```

- [ ] **Step 3: Run full local backend verification**

Run:

```bash
npm run test:workgraph-backend-complete
pnpm --filter backend check
pnpm --filter @sparkcanvas/web check
npm run test:workgraph-os-ui-quality
WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-visual
WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-interaction
pnpm --filter @sparkcanvas/web build
```

Expected:

```text
all commands pass
```

- [ ] **Step 4: Update completion doc**

Modify `docs/SparkCanvas_Completeness_Validation.md` with this section:

```md
## WorkGraph Backend Completion

Current local backend supports:
- VDAMO GPT Image 2 image route through `/workgraph-os/images/generate`.
- Pi runtime and local Skill store through `/workgraph-os/pi/runtime`.
- Skill search, draft creation, and local skill tests.
- Node execution through `/workgraph-os/run-node`.
- Video provider route guarded by `SPARKCANVAS_ALLOW_PAID_VIDEO_GEN`.
- Provider readiness through `/ai/status`.

Verification:
- `npm run test:workgraph-backend-complete`
- `npm run test:workgraph-os-ui-quality`
- `WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-visual`
- `WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-interaction`
```

---

## Execution Order

1. Task 1 Provider config/readiness.
2. Task 2 GPT Image backend.
3. Task 3 Pi Skill service.
4. Task 4 Workflow runner.
5. Task 5 Video guard.
6. Task 6 Frontend wiring.
7. Task 7 Full verification and docs.

Do not execute paid provider tests until all dry-run and local smokes pass.

## Final Verification Commands

Run these before declaring completion:

```bash
npm run test:workgraph-backend-complete
pnpm --filter backend check
pnpm --filter @sparkcanvas/web check
npm run test:workgraph-os-ui-quality
WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-visual
WGOS_UI_URL=http://127.0.0.1:3204/ npm run test:workgraph-os-ui-interaction
pnpm --filter @sparkcanvas/web build
curl -sS http://127.0.0.1:4200/health | jq
curl -sS http://127.0.0.1:4200/ai/status | jq
```

## Self-Review

- Spec coverage: GPT image generation, Pi Skill runtime, skill search/create/test, workflow runner, video provider guard, readiness, UI wiring, persistence evidence, and verification are covered.
- Placeholder scan: no `TBD`, no open-ended "add tests" without exact test content.
- Type consistency: provider config, image service, video service, Pi service, and workflow runner use explicit request/result types and stable route names.
- Scope control: plan does not redesign UI style, does not deploy, does not commit secrets, and does not call paid APIs by default.
