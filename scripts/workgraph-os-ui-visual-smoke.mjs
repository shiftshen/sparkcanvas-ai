import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

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

async function auditViewport(page, name, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const screenshot = `output/playwright/workgraph-final-${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: false });
  const metrics = await page.evaluate((screenshotPath) => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box ? {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        bottom: Math.round(box.bottom)
      } : null;
    };
    const visibleButtonCount = Array.from(document.querySelectorAll("button")).filter((button) => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return box.width > 1 && box.height > 1 && box.bottom > 0 && box.top < window.innerHeight && style.visibility !== "hidden" && style.opacity !== "0";
    }).length;
    const activeNodeCard = rect("[data-bottom-active-node-card='true']");
    const activeNodeRun = rect("[data-current-node-primary-action='run']");
    const activeNodeModules = rect("[data-bottom-node-module-shortcuts='true']");
    const topbar = rect("[data-top-command-bar='true']");
    const activeNodeRunElement = document.querySelector("[data-current-node-primary-action='run']");
    const activeNodeRunCenterTarget = activeNodeRun ? (() => {
      const x = activeNodeRun.x + activeNodeRun.width / 2;
      const y = activeNodeRun.y + activeNodeRun.height / 2;
      const target = document.elementFromPoint(x, y);
      return Boolean(activeNodeRunElement && target && (target === activeNodeRunElement || activeNodeRunElement.contains(target)));
    })() : false;
    return {
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screenshot: screenshotPath,
      topbar,
      canvas: rect("[data-workbench-center='execution-graph']"),
      goalComposer: rect("[data-bottom-goal-composer='true']"),
      activeNodeCard,
      activeNodeRun,
      activeNodeRunCenterTarget,
      activeNodeModules,
      preview: rect("[data-bottom-result-preview='true']"),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      bottomInternalOverflow: (() => {
        const element = document.querySelector(".wg-bottom-panel");
        return element ? element.scrollWidth > element.clientWidth + 2 : true;
      })(),
      topbarInternalOverflow: (() => {
        const element = document.querySelector("[data-top-command-bar='true']");
        return element ? element.scrollWidth > element.clientWidth + 2 : true;
      })(),
      isMobileStack: window.innerWidth <= 700,
      visibleButtonCount,
      visibleGraphNodeCount: Array.from(document.querySelectorAll("[data-workgraph-node='true']")).filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && box.bottom > 0 && box.top < window.innerHeight;
      }).length
    };
  }, screenshot);

  assert(metrics.title === "AI 工作图谱", `${name}: title mismatch`);
  assert(!metrics.hasHorizontalOverflow, `${name}: horizontal overflow`);
  assert(!metrics.bottomInternalOverflow, `${name}: bottom internal overflow`);
  assert(!metrics.topbarInternalOverflow, `${name}: topbar internal overflow`);
  assert((metrics.topbar?.height ?? 0) >= 40, `${name}: topbar too small`);
  assert((metrics.canvas?.height ?? 0) >= 360, `${name}: canvas too small`);
  assert((metrics.goalComposer?.height ?? 0) >= 120, `${name}: goal composer not usable`);
  assert((metrics.activeNodeCard?.height ?? 0) >= 120, `${name}: active node card not usable`);
  assert((metrics.activeNodeRun?.height ?? 0) > 0, `${name}: active node run button missing`);
  assert(metrics.activeNodeRunCenterTarget, `${name}: active node run button center is covered`);
  assert((metrics.activeNodeModules?.height ?? 0) > 0, `${name}: module shortcuts missing`);
  if (!metrics.isMobileStack) {
    assert(((metrics.activeNodeRun?.bottom ?? 0) <= (metrics.activeNodeCard?.bottom ?? 0) + 1), `${name}: run button clipped outside active card`);
    assert(((metrics.activeNodeModules?.bottom ?? 0) <= (metrics.activeNodeCard?.bottom ?? 0) + 1), `${name}: module shortcuts clipped outside active card`);
    assert((metrics.visibleGraphNodeCount ?? 0) >= 3, `${name}: too few visible graph nodes`);
    assert((metrics.visibleButtonCount ?? 0) <= 130, `${name}: too many visible buttons (${metrics.visibleButtonCount})`);
  } else {
    assert((metrics.activeNodeCard?.y ?? 0) > (metrics.goalComposer?.y ?? -1), `${name}: mobile active node should stack below goal input`);
    assert((metrics.activeNodeRun?.bottom ?? 9999) <= metrics.viewport.height - 4, `${name}: mobile run button is not fully visible above the fold`);
    assert((metrics.activeNodeModules?.bottom ?? 9999) <= metrics.viewport.height - 4, `${name}: mobile module shortcuts are not fully visible above the fold`);
    assert((metrics.visibleGraphNodeCount ?? 0) >= 1, `${name}: mobile graph has no visible nodes`);
    assert((metrics.visibleButtonCount ?? 0) <= 90, `${name}: too many visible mobile buttons (${metrics.visibleButtonCount})`);
  }
  return metrics;
}

await mkdir("output/playwright", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const results = [];
  results.push(await auditViewport(page, "desktop", { width: 1280, height: 720 }));
  results.push(await auditViewport(page, "wide", { width: 1440, height: 900 }));
  results.push(await auditViewport(page, "compact", { width: 820, height: 760 }));
  results.push(await auditViewport(page, "mobile", { width: 430, height: 820 }));
  results.push(await auditViewport(page, "narrow", { width: 390, height: 844 }));
  console.log(JSON.stringify({ ok: true, url, results }, null, 2));
} finally {
  await browser.close();
}
