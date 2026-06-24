import { createRequire } from "node:module";

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

async function measure(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box ? {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      } : null;
    };
    const bodyText = document.body.innerText || "";
    const internalLabels = [
      "WorkGraph Studio",
      "Execution graph",
      "brand_context",
      "asset_search",
      "model_select",
      "video_generate",
      "human_review",
      "Workflow Runner",
      "Skill"
    ];
    return {
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      shell: rect(".wg-shell"),
      topbar: rect(".wg-topbar"),
      resource: rect("[data-resource-panel='true']"),
      canvas: rect("[data-workbench-center='execution-graph']"),
      inspector: rect(".wg-inspector-header"),
      bottom: rect(".wg-bottom-panel"),
      activeNodeCard: rect("[data-bottom-active-node-card='true']"),
      activeNodePrimaryAction: rect("[data-current-node-primary-action='run']"),
      activeNodeModuleShortcuts: rect("[data-bottom-node-module-shortcuts='true']"),
      bottomInternalOverflow: (() => {
        const element = document.querySelector(".wg-bottom-panel");
        return element ? element.scrollWidth > element.clientWidth + 2 : true;
      })(),
      goalComposer: rect("[data-bottom-goal-composer='true']"),
      goalComposerOverflow: (() => {
        const element = document.querySelector("[data-bottom-goal-composer='true']");
        return element ? element.scrollHeight > element.clientHeight + 1 : true;
      })(),
      nodeCount: document.querySelectorAll("[data-workgraph-node='true']").length,
      bottomNodeCount: document.querySelectorAll("[data-bottom-node-title='true']").length,
      minimapCount: document.querySelectorAll(".react-flow__minimap").length,
      attributionCount: document.querySelectorAll(".react-flow__attribution").length,
      visibleInternalLabels: internalLabels.filter((label) => bodyText.includes(label)),
      hasBottomGoal: Boolean(document.querySelector("[data-workbench-primary-input='bottom-goal']")),
      hasCenterGraph: Boolean(document.querySelector("[data-workbench-center='execution-graph']")),
      hasNodeDrilldown: Boolean(document.querySelector("[data-workbench-details='node-drilldown']")),
      scrollReachability: {
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        canScrollVertically: document.documentElement.scrollHeight > document.documentElement.clientHeight + 2,
        resourceReachable: (() => {
          const element = document.querySelector("[data-resource-panel='true']");
          if (!element) return false;
          const box = element.getBoundingClientRect();
          return box.bottom <= document.documentElement.scrollHeight + 2;
        })(),
        inspectorReachable: (() => {
          const element = document.querySelector(".wg-inspector-header");
          if (!element) return false;
          const box = element.getBoundingClientRect();
          return box.bottom <= document.documentElement.scrollHeight + 2;
        })()
      },
      topActions: Array.from(document.querySelectorAll("[data-top-action]")).map((element) => element.textContent?.trim()).filter(Boolean),
      bottomTypes: Array.from(document.querySelectorAll("[data-bottom-node-type='true']")).map((element) => element.textContent?.trim()).filter(Boolean)
    };
  });
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(1000);
  const desktopMetrics = await measure(desktop);

  assert(desktopMetrics.title === "AI 工作图谱", `unexpected page title: ${desktopMetrics.title}`);
  assert(!desktopMetrics.hasHorizontalOverflow, "desktop has horizontal overflow");
  assert(desktopMetrics.hasBottomGoal, "bottom goal composer contract missing");
  assert(desktopMetrics.hasCenterGraph, "center execution graph contract missing");
  assert(desktopMetrics.hasNodeDrilldown, "node drilldown contract missing");
  assert((desktopMetrics.nodeCount ?? 0) >= 1, "no graph nodes rendered");
  assert((desktopMetrics.bottomNodeCount ?? 0) >= 1, "no bottom node rail rendered");
  assert(desktopMetrics.visibleInternalLabels.length === 0, `internal labels visible: ${desktopMetrics.visibleInternalLabels.join(", ")}`);
  assert((desktopMetrics.canvas?.height ?? 0) >= 420, `desktop canvas too short: ${desktopMetrics.canvas?.height}`);
  assert((desktopMetrics.bottom?.height ?? 0) <= 240, `bottom panel too tall: ${desktopMetrics.bottom?.height}`);
  assert((desktopMetrics.activeNodeCard?.height ?? 0) > 0, "desktop active node card is not visible");
  assert((desktopMetrics.activeNodePrimaryAction?.height ?? 0) > 0, "desktop active node run action is not visible");
  assert((desktopMetrics.activeNodeModuleShortcuts?.height ?? 0) > 0, "desktop active node module shortcuts are not visible");
  assert((desktopMetrics.activeNodePrimaryAction?.y ?? 9999) >= (desktopMetrics.activeNodeCard?.y ?? -1), "desktop active node run action starts outside card");
  assert(((desktopMetrics.activeNodePrimaryAction?.y ?? 0) + (desktopMetrics.activeNodePrimaryAction?.height ?? 0)) <= ((desktopMetrics.activeNodeCard?.y ?? 0) + (desktopMetrics.activeNodeCard?.height ?? 0) + 1), "desktop active node run action is clipped outside card");
  assert(((desktopMetrics.activeNodeModuleShortcuts?.y ?? 0) + (desktopMetrics.activeNodeModuleShortcuts?.height ?? 0)) <= ((desktopMetrics.activeNodeCard?.y ?? 0) + (desktopMetrics.activeNodeCard?.height ?? 0) + 1), "desktop active node module shortcuts are clipped outside card");
  assert(!desktopMetrics.bottomInternalOverflow, "desktop bottom panel has internal horizontal overflow");
  assert(!desktopMetrics.goalComposerOverflow, "desktop goal composer content is clipped");
  assert((desktopMetrics.topActions ?? []).includes("技能"), "top skill action is not localized");
  assert(desktopMetrics.minimapCount === 0, "desktop minimap overlays the canvas");
  assert(desktopMetrics.attributionCount === 0, "desktop React Flow attribution is visible");
  await desktop.locator("body").click({ position: { x: 24, y: 24 } });
  await desktop.keyboard.press("/");
  const slashFocus = await desktop.evaluate(() => ({
    activeIsGoal: document.activeElement?.getAttribute("data-bottom-goal-input") === "true",
    selectedText: document.getSelection()?.toString() || ""
  }));
  assert(slashFocus.activeIsGoal, "slash shortcut does not focus the bottom goal input");
  await desktop.keyboard.press("ArrowRight");
  await desktop.keyboard.press("/");
  const slashTextInput = await desktop.evaluate(() => ({
    activeIsGoal: document.activeElement?.getAttribute("data-bottom-goal-input") === "true",
    endsWithSlash: (document.activeElement instanceof HTMLTextAreaElement ? document.activeElement.value : "").endsWith("/")
  }));
  assert(slashTextInput.activeIsGoal && slashTextInput.endsWithSlash, "slash is not typed normally inside the goal input");
  await desktop.locator("body").click({ position: { x: 24, y: 24 } });
  await desktop.keyboard.press("2");
  await desktop.waitForTimeout(150);
  const numberSwitch = await desktop.evaluate(() => {
    const activeChip = document.querySelector("[data-bottom-node-active='true']");
    const activeCanvasNode = document.querySelector("[data-canvas-active-node='true']");
    return {
      activeId: activeChip?.getAttribute("data-bottom-node-switch") || "",
      activeTitle: activeCanvasNode?.textContent || ""
    };
  });
  assert(numberSwitch.activeId === "brand" || numberSwitch.activeId === "brand-context", `number shortcut did not switch to second node: ${numberSwitch.activeId}`);
  assert(numberSwitch.activeTitle.includes("品牌上下文"), `canvas active node did not update after number shortcut: ${numberSwitch.activeTitle}`);
  await desktop.keyboard.press("m");
  await desktop.waitForTimeout(150);
  const moduleShortcut = await desktop.evaluate(() => {
    const panel = document.querySelector("[data-inspector-modules-panel='true']");
    const drawer = document.querySelector("[data-node-native-module='brand']");
    const bottomModule = document.querySelector("[data-current-node-active-module='true']");
    return {
      activeModule: panel?.getAttribute("data-active-module") || "",
      brandOpen: drawer?.getAttribute("data-module-open") === "true",
      bottomLabel: bottomModule?.textContent || ""
    };
  });
  assert(moduleShortcut.activeModule === "brand", `M shortcut did not select brand module: ${moduleShortcut.activeModule}`);
  assert(moduleShortcut.brandOpen, "M shortcut did not open the brand module drawer");
  assert(moduleShortcut.bottomLabel.includes("品牌"), `bottom module label did not update after M shortcut: ${moduleShortcut.bottomLabel}`);

  const compact = await browser.newPage({ viewport: { width: 820, height: 760 } });
  await compact.goto(url, { waitUntil: "domcontentloaded" });
  await compact.waitForTimeout(1000);
  const compactMetrics = await measure(compact);

  assert(!compactMetrics.hasHorizontalOverflow, "compact viewport has horizontal overflow");
  assert((compactMetrics.canvas?.width ?? 0) === 820, `compact canvas width mismatch: ${compactMetrics.canvas?.width}`);
  assert((compactMetrics.canvas?.y ?? 9999) < (compactMetrics.resource?.y ?? -1), "compact canvas is not first");
  assert((compactMetrics.canvas?.y ?? 9999) < (compactMetrics.bottom?.y ?? -1), "compact bottom is not after canvas");
  assert((compactMetrics.bottom?.y ?? 9999) < (compactMetrics.resource?.y ?? -1), "compact bottom is not before resource panel");
  assert((compactMetrics.bottom?.y ?? 9999) < (compactMetrics.inspector?.y ?? -1), "compact bottom is not before inspector");
  assert((compactMetrics.bottom?.height ?? 0) <= 480, `compact bottom panel too tall: ${compactMetrics.bottom?.height}`);
  assert((compactMetrics.activeNodeCard?.height ?? 0) > 0, "compact active node card is not visible");
  assert((compactMetrics.activeNodePrimaryAction?.height ?? 0) > 0, "compact active node run action is not visible");
  assert(((compactMetrics.activeNodePrimaryAction?.y ?? 0) + (compactMetrics.activeNodePrimaryAction?.height ?? 0)) <= ((compactMetrics.activeNodeCard?.y ?? 0) + (compactMetrics.activeNodeCard?.height ?? 0) + 1), "compact active node run action is clipped outside card");
  assert(!compactMetrics.bottomInternalOverflow, "compact bottom panel has internal horizontal overflow");
  assert((compactMetrics.goalComposer?.height ?? 0) <= 180, `compact goal composer too tall: ${compactMetrics.goalComposer?.height}`);
  assert((compactMetrics.resource?.height ?? 0) <= 320, `compact resource panel too tall: ${compactMetrics.resource?.height}`);
  assert(compactMetrics.scrollReachability.canScrollVertically, "compact layout should be vertically scrollable");
  assert(compactMetrics.scrollReachability.resourceReachable, "compact resource panel is not reachable by vertical scroll");
  assert(compactMetrics.scrollReachability.inspectorReachable, "compact inspector is not reachable by vertical scroll");
  assert(compactMetrics.minimapCount === 0, "compact minimap overlays the canvas");
  assert(compactMetrics.attributionCount === 0, "compact React Flow attribution is visible");

  console.log(JSON.stringify({
    ok: true,
    url,
    desktop: desktopMetrics,
    compact: compactMetrics
  }, null, 2));
} finally {
  await browser.close();
}
