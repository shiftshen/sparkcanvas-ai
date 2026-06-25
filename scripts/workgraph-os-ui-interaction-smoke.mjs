import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { seedCanonicalWorkspace, waitForActiveNode } from "./lib/wgos-seed.mjs";

const url = process.env.WGOS_UI_URL || "http://127.0.0.1:3203/";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = webRequire("@playwright/test"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function cleanupUploadedSmokeAsset(assetTitle, page) {
  const root = process.cwd();
  const smokeAssetIds = new Set();
  if (page) {
    try {
      const response = await page.request.get(new URL("/workgraph-os/assets", url).toString());
      const payload = await response.json();
      for (const asset of payload.assets || []) {
        if (/^smoke-upload-\d+/.test(asset.title || "")) {
          smokeAssetIds.add(asset.id);
          await page.request.delete(new URL(`/workgraph-os/assets/${encodeURIComponent(asset.id)}`, url).toString());
        }
      }
    } catch {
      // Fall back to local cleanup below when the dev server is already gone.
    }
  }
  const indexPath = path.join(root, "data/assets/_index.json");
  const index = await readJsonIfExists(indexPath);
  const entries = (index?.objects || []).filter((item) => item.title === assetTitle || /^smoke-upload-\d+/.test(item.title || ""));
  const entry = entries[0];
  const assetId = entry?.id?.replace(/^asset:/, "");
  if (assetId) smokeAssetIds.add(assetId);
  const relatedFiles = [];
  for (const item of entries) {
    const assetFile = item.file ? path.join(root, "data/assets", item.file) : "";
    const assetRecord = assetFile ? await readJsonIfExists(assetFile) : null;
    if (assetRecord?.payload?.id) smokeAssetIds.add(assetRecord.payload.id);
    const payload = assetRecord?.payload ?? {};
    relatedFiles.push(assetFile, payload.dataPath, payload.thumbnailPath, payload.usagePath, payload.versionPath);
  }

  if (index) {
    index.objects = (index.objects || []).filter((item) => !/^smoke-upload-\d+/.test(item.title || "") && !smokeAssetIds.has(String(item.id || "").replace(/^asset:/, "")));
    index.count = index.objects.length;
    await writeJson(indexPath, index);
  }

  for (const file of [
    path.join(root, "data/nodes/node-brand-context.json"),
    path.join(root, "data/workflows/workflow-workflow-active.json"),
    path.join(root, "data/brands/brand-dapot.json"),
    path.join(root, "data/brands/brand-brand_dapot.json"),
    path.join(root, "backend/data/workgraph-os.json"),
    path.join(root, "backend/data/workgraph-os.json.bak"),
    path.join(root, "backend/data/workgraph-os-history.json"),
    path.join(root, "backend/data/workgraph-os-history.json.bak"),
    path.join(root, "backend/data/sparkcanvas.json"),
    path.join(root, "backend/data/sparkcanvas.json.bak")
  ]) {
    const doc = await readJsonIfExists(file);
    if (!doc) continue;
    let changed = false;
    const scrubSmokeValue = (value) => {
      if (typeof value === "string") {
        const next = value.split("\n").filter((line) => !/smoke-upload-\d+/.test(line)).join("\n");
        if (next !== value) changed = true;
        return next;
      }
      if (Array.isArray(value)) {
        const next = value
          .filter((item) => !(item && typeof item === "object" && /^smoke-upload-\d+/.test(String(item.title || ""))))
          .map((item) => scrubSmokeValue(item));
        if (next.length !== value.length) changed = true;
        return next;
      }
      if (value && typeof value === "object") {
        const record = value;
        if (/^smoke-upload-\d+/.test(String(record.title || ""))) {
          changed = true;
          return null;
        }
        const next = {};
        for (const [key, item] of Object.entries(record)) {
          if (key === "smokeReason") {
            changed = true;
            continue;
          }
          const cleaned = scrubSmokeValue(item);
          if (cleaned !== null) next[key] = cleaned;
          else changed = true;
        }
        return next;
      }
      return value;
    };
    const scrubContext = (value) => {
      if (typeof value !== "string") return value;
      const next = value.split("\n").filter((line) => !/smoke-upload-\d+/.test(line)).join("\n");
      if (next !== value) changed = true;
      return next;
    };
    const cleanedDoc = scrubSmokeValue(doc);
    if (!cleanedDoc) continue;
    Object.keys(doc).forEach((key) => delete doc[key]);
    Object.assign(doc, cleanedDoc);
    doc.context = scrubContext(doc.context);
    if (Array.isArray(doc.payload?.materialIds)) {
      const next = doc.payload.materialIds.filter((id) => !smokeAssetIds.has(id));
      changed = next.length !== doc.payload.materialIds.length;
      doc.payload.materialIds = next;
    }
    if (doc.payload) {
      doc.payload.context = scrubContext(doc.payload.context);
      if (Array.isArray(doc.payload.assets)) {
        const nextAssets = doc.payload.assets.filter((asset) => !smokeAssetIds.has(asset.id) && !/^smoke-upload-\d+/.test(asset.title || ""));
        if (nextAssets.length !== doc.payload.assets.length) changed = true;
        doc.payload.assets = nextAssets;
      }
    }
    if (Array.isArray(doc.assets)) {
      const nextAssets = doc.assets.filter((asset) => !smokeAssetIds.has(asset.id) && !/^smoke-upload-\d+/.test(asset.title || ""));
      if (nextAssets.length !== doc.assets.length) changed = true;
      doc.assets = nextAssets;
    }
    if (Array.isArray(doc.payload?.nodes)) {
      doc.payload.nodes = doc.payload.nodes.map((node) => {
        if (!Array.isArray(node.materialIds)) return node;
        const materialIds = node.materialIds.filter((id) => !smokeAssetIds.has(id));
        if (materialIds.length !== node.materialIds.length) changed = true;
        return { ...node, materialIds };
      });
    }
    if (changed) await writeJson(file, doc);
  }

  const sqlite = path.join(root, "data/db/workgraph-os.sqlite");
  if (existsSync(sqlite)) {
    for (const id of smokeAssetIds) {
      spawnSync("sqlite3", [sqlite, `DELETE FROM wgos_objects WHERE id='asset:${id}'; DELETE FROM wgos_edges WHERE from_object_id='asset:${id}' OR to_object_id='asset:${id}';`], { stdio: "ignore" });
    }
  }

  for (const file of relatedFiles) {
    if (file) await rm(file, { recursive: true, force: true });
  }
}

async function clickUnique(page, selector, message) {
  const locator = page.locator(selector);
  const count = await locator.count();
  assert(count === 1, `${message}: expected 1 match, got ${count}`);
  await locator.click();
}

async function clickIndexed(page, selector, index, message) {
  const locator = page.locator(selector);
  const count = await locator.count();
  assert(count > index, `${message}: expected index ${index}, got ${count} matches`);
  await locator.nth(index).click();
}

async function metrics(page) {
  return page.evaluate(() => ({
    activeBottomNode: document.querySelector("[data-bottom-node-active='true']")?.getAttribute("data-bottom-node-switch") || "",
    activeModule: document.querySelector("[data-inspector-modules-panel='true']")?.getAttribute("data-active-module") || "",
    activeBottomModuleLabel: document.querySelector("[data-current-node-active-module='true']")?.textContent?.trim() || "",
    activeBottomTab: document.querySelector("[data-bottom-mode-state='active']")?.getAttribute("data-bottom-mode-tab") || "",
    activeResourceTab: document.querySelector("[data-library-mode-card='true']")?.getAttribute("data-library-mode-active") || "",
    activeViewMode: document.querySelector("[data-top-view-mode-group='true']")?.getAttribute("data-top-view-mode-active") || "",
    resourceCollapsed: document.querySelector("[data-resource-rail-collapsed='true']") ? "true" : "false",
    inspectorCollapsed: document.querySelector("[data-workspace-node-count]")?.getAttribute("data-inspector-collapsed") || "",
    focusedGoal: document.activeElement?.getAttribute("data-bottom-goal-input") === "true",
    goalDraft: document.querySelector("[data-bottom-goal-input='true']")?.value || "",
    boundAssetText: document.querySelector("[data-bottom-goal-bound-assets='true']")?.textContent?.trim() || "",
    boundAssetCount: Number.parseInt(document.querySelector("[data-asset-bound-list='true']")?.getAttribute("data-asset-bound-count") || "0", 10),
    assetChipCount: document.querySelectorAll("[data-bottom-goal-asset-chip='true']").length,
    previewEmptyActions: document.querySelectorAll("[data-preview-empty-action]").length,
    hasInternalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    bottomInternalOverflow: (() => {
      const element = document.querySelector(".wg-bottom-panel");
      return element ? element.scrollWidth > element.clientWidth + 2 : true;
    })()
  }));
}

let uploadTitle = "";
let uploadPage;
const browser = await chromium.launch({ headless: true });
try {
  const uploadDir = path.join(os.tmpdir(), "sparkcanvas-wgos-ui-smoke");
  await mkdir(uploadDir, { recursive: true });
  uploadTitle = `smoke-upload-${Date.now()}`;
  const uploadPath = path.join(uploadDir, `${uploadTitle}.png`);
  await writeFile(uploadPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"));

  await seedCanonicalWorkspace(url);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  uploadPage = page;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Wait for the canonical graph's node switches to render before interacting,
  // so the test is timing-robust instead of relying on a fixed delay.
  await page.waitForFunction(() => document.querySelectorAll("[data-bottom-node-switch]").length >= 2, { timeout: 15000 });
  await page.waitForTimeout(300);

  await clickIndexed(page, "[data-bottom-node-switch]", 1, "second node switch");
  await waitForActiveNode(page, ["brand", "brand-context"]);
  let state = await metrics(page);
  assert(state.activeBottomNode === "brand" || state.activeBottomNode === "brand-context", `brand node did not activate: ${state.activeBottomNode}`);

  await clickUnique(page, "[data-bottom-node-module='model']", "bottom model module");
  state = await metrics(page);
  assert(state.activeModule === "model", `model module did not open: ${state.activeModule}`);
  assert(state.activeBottomModuleLabel.includes("模型"), `bottom module label did not update: ${state.activeBottomModuleLabel}`);

  await clickUnique(page, "[data-bottom-mode-tab='feedback']", "feedback bottom tab");
  state = await metrics(page);
  assert(state.activeBottomTab === "feedback", `feedback tab did not activate: ${state.activeBottomTab}`);

  await clickUnique(page, "[data-bottom-mode-tab='preview']", "preview bottom tab");
  state = await metrics(page);
  assert(state.activeBottomTab === "preview", `preview tab did not activate: ${state.activeBottomTab}`);

  await clickUnique(page, "[data-toggle-resource-rail='true']", "expand resource rail");
  await clickUnique(page, "[data-resource-primary-tab='skill']", "skill resource tab");
  state = await metrics(page);
  assert(state.activeResourceTab === "skill", `skill resource tab did not activate: ${state.activeResourceTab}`);

  await clickUnique(page, "[data-resource-primary-tab='asset']", "asset resource tab");
  state = await metrics(page);
  assert(state.activeResourceTab === "asset", `asset resource tab did not activate: ${state.activeResourceTab}`);

  await page.locator("body").click({ position: { x: 24, y: 24 } });
  await page.keyboard.press("1");
  await waitForActiveNode(page, ["goal"]);
  // Let the activate-node persist round-trip fully drain before the next switch:
  // rapid switches otherwise race (a late PUT response can revert activeNodeId).
  await page.waitForTimeout(1200);
  state = await metrics(page);
  assert(state.activeBottomNode === "goal", `1 shortcut did not switch to first node: ${state.activeBottomNode}`);

  await page.keyboard.press("2");
  await waitForActiveNode(page, ["brand", "brand-context"]);
  await page.waitForTimeout(1200);
  state = await metrics(page);
  assert(state.activeBottomNode === "brand" || state.activeBottomNode === "brand-context", `2 shortcut did not switch back to second node: ${state.activeBottomNode}`);

  await page.keyboard.press("m");
  state = await metrics(page);
  assert(state.activeModule, "m shortcut did not keep a node module open");

  await page.keyboard.press("f");
  state = await metrics(page);
  assert(state.activeViewMode === "focus", `f shortcut did not enter focus mode: ${state.activeViewMode}`);
  assert(state.resourceCollapsed === "true" && state.inspectorCollapsed === "true", `focus mode did not collapse side panels: resource ${state.resourceCollapsed}, inspector ${state.inspectorCollapsed}`);

  await page.keyboard.press("Escape");
  state = await metrics(page);
  assert(state.activeViewMode === "full", `escape shortcut did not restore full mode: ${state.activeViewMode}`);
  assert(state.resourceCollapsed === "false" && state.inspectorCollapsed === "false", `escape did not restore side panels: resource ${state.resourceCollapsed}, inspector ${state.inspectorCollapsed}`);

  await page.keyboard.press("/");
  state = await metrics(page);
  assert(state.focusedGoal, "slash shortcut did not focus the bottom goal input");
  await page.keyboard.type("视觉验收 smoke");
  state = await metrics(page);
  assert(state.goalDraft.includes("视觉验收 smoke"), "goal input did not accept typed text after shortcut focus");

  const assetStateBeforeUpload = state;
  await clickUnique(page, "[data-bottom-node-module='asset']", "bottom asset module before upload");
  await page.locator("input[type='file']").setInputFiles(uploadPath);
  await page.waitForFunction((before) => {
    const boundList = document.querySelector("[data-asset-bound-list='true']");
    const nextCount = Number.parseInt(boundList?.getAttribute("data-asset-bound-count") || "0", 10);
    return nextCount > before;
  }, assetStateBeforeUpload.boundAssetCount, { timeout: 10000 });
  state = await metrics(page);
  assert(state.activeModule === "asset", `asset module did not stay open after upload: ${state.activeModule}`);
  assert(state.boundAssetCount > assetStateBeforeUpload.boundAssetCount, `uploaded asset did not bind to active node: before ${assetStateBeforeUpload.boundAssetCount}, after ${state.boundAssetCount}`);
  assert(state.assetChipCount > 0 || /[1-9]/.test(state.boundAssetText), `uploaded asset is not visible in bottom binding strip: ${state.boundAssetText}`);

  assert(!state.hasInternalOverflow, "page has horizontal overflow after interactions");
  assert(!state.bottomInternalOverflow, "bottom panel has internal horizontal overflow after interactions");

  const compact = await browser.newPage({ viewport: { width: 820, height: 760 } });
  await compact.goto(url, { waitUntil: "domcontentloaded" });
  await compact.waitForTimeout(1000);
  await clickUnique(compact, "[data-bottom-node-module='asset']", "compact asset module");
  const compactState = await metrics(compact);
  assert(compactState.activeModule === "asset", `compact asset module did not open: ${compactState.activeModule}`);
  assert(!compactState.hasInternalOverflow, "compact page has horizontal overflow after interaction");
  assert(!compactState.bottomInternalOverflow, "compact bottom panel has internal horizontal overflow after interaction");

  console.log(JSON.stringify({
    ok: true,
    url,
    checked: [
      "bottom-node-switch",
      "bottom-module-open",
      "bottom-preview-feedback-tabs",
      "resource-tab-switch",
      "keyboard-node-switch",
      "keyboard-module-focus-reset",
      "slash-focus-goal-input",
      "file-upload-binds-active-node",
      "compact-module-open",
      "no-horizontal-overflow-after-interactions"
    ],
    desktop: state,
    compact: compactState
  }, null, 2));
} finally {
  if (uploadTitle) await cleanupUploadedSmokeAsset(uploadTitle, uploadPage);
  await browser.close();
}
