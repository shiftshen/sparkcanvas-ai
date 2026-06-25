// Drawer mutual-exclusion smoke (agy review 条件1): the right-side inspector
// module drawer and the 520px skill drawer are two heavy right surfaces and must
// never be open simultaneously, otherwise the "一屏多面板叠加" density regresses.
// Seeds a canonical workspace and polls state markers instead of fixed delays so
// it gates CI deterministically.
import { createRequire } from "node:module";
import { seedCanonicalWorkspace } from "./lib/wgos-seed.mjs";

const url = process.env.WGOS_UI_URL || "http://127.0.0.1:3203/";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (playwrightError) {
  try {
    ({ chromium } = webRequire("@playwright/test"));
  } catch (webPlaywrightError) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "playwright package is not installed in this workspace",
      firstError: playwrightError instanceof Error ? playwrightError.message : String(playwrightError),
      secondError: webPlaywrightError instanceof Error ? webPlaywrightError.message : String(webPlaywrightError),
      url
    }, null, 2));
    process.exit(0);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rightSurface(page) {
  return page.evaluate(() => ({
    surface: document.querySelector("[data-right-surface]")?.getAttribute("data-right-surface") || "",
    skillDrawer: Boolean(document.querySelector("[data-skill-drawer='true']")),
    inspectorCollapsed: document.querySelector("[data-inspector-collapsed]")?.getAttribute("data-inspector-collapsed") || ""
  }));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];

try {
  await seedCanonicalWorkspace(url);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-right-surface]", { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-bottom-node-module]").length >= 1,
    null,
    { timeout: 15000 }
  );
  // The mount-time layout effect restores inspector/resource collapse from
  // localStorage shortly after first paint; settle so an early click is not
  // overridden by that restore (timing-robust, not a default-state assumption).
  await page.waitForTimeout(1400);

  // 1) Open the 520px skill drawer -> it becomes the sole right surface and the
  //    inspector module drawer must be collapsed (exclusion direction A).
  await page.locator("[data-top-action='skill']").first().click();
  await page.waitForFunction(
    () => Boolean(document.querySelector("[data-skill-drawer='true']")) &&
      document.querySelector("[data-right-surface]")?.getAttribute("data-right-surface") === "skill-drawer",
    null,
    { timeout: 12000 }
  );
  let state = await rightSurface(page);
  assert(state.skillDrawer, "skill drawer should be open");
  assert(state.surface === "skill-drawer", `expected skill-drawer surface, got ${state.surface}`);
  assert(state.inspectorCollapsed === "true", "inspector must collapse when skill drawer opens (mutual exclusion)");

  // 2) Open an inspector node-module drawer -> the skill drawer must close and the
  //    inspector becomes the sole right surface (exclusion direction B).
  await page.locator("[data-bottom-node-module]").first().click();
  await page.waitForFunction(
    () => !document.querySelector("[data-skill-drawer='true']") &&
      document.querySelector("[data-right-surface]")?.getAttribute("data-right-surface") === "inspector",
    null,
    { timeout: 8000 }
  );
  state = await rightSurface(page);
  assert(!state.skillDrawer, "skill drawer must close when a node module drawer is opened");
  assert(state.surface === "inspector", `expected inspector surface, got ${state.surface}`);
  assert(state.inspectorCollapsed === "false", "inspector must expand when a node module drawer is opened");
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

const ok = failures.length === 0;
console.log(JSON.stringify({ ok, url, failures }, null, 2));
process.exit(ok ? 0 : 1);
