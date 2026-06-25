// Seed a deterministic canonical workspace for the browser UI smokes. Uses an
// EXPLICIT node list (mirroring the studio's fallback graph) so the nodes are
// real, activatable workspace nodes in a fixed order (goal, brand, asset, skill,
// model, preview, feedback) — clicking the 2nd switch / pressing "2" reliably
// activates the brand node regardless of any residual workspace state.
export async function seedCanonicalWorkspace(url) {
  const base = String(url).replace(/\/$/, "");
  const nodes = [
    { id: "goal", title: "目标", type: "goal", body: "@imgen /生成海报 使用 $logo 生成 XMANX 海报", status: "就绪" },
    { id: "brand", title: "品牌上下文", type: "brand_context", body: "读取 DAPOT 品牌规则和禁用项", status: "就绪" },
    { id: "asset", title: "素材检索", type: "asset_search", body: "搜索品牌素材、参考图", status: "就绪" },
    { id: "skill", title: "视频技能", type: "skill_search", body: "搜索或创建技能", status: "就绪" },
    { id: "model", title: "模型策略", type: "model_select", body: "按节点选择模型策略", status: "就绪" },
    { id: "预览", title: "预览结果", type: "预览", body: "生成分镜、文案、画面提示词", status: "就绪" },
    { id: "feedback", title: "反馈记忆", type: "feedback", body: "将反馈写入品牌和记忆", status: "就绪" }
  ];
  const res = await fetch(`${base}/workgraph-os/workspace`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      id: "workspace-local",
      prompt: "@imgen /生成海报 使用 $logo 生成 XMANX 海报",
      activeBrandId: "brand-dapot",
      activeModelId: "vdamo-gpt-image-2",
      selectedIds: [],
      activeMaterialId: "",
      activeSkillId: "",
      activeNodeId: "goal",
      materials: [], skills: [], models: [], nodes, edges: [],
      jobs: [], results: [], feedback: [], memories: [], executionLog: [], promptRecords: []
    })
  });
  if (!res.ok) throw new Error(`seedCanonicalWorkspace failed: ${res.status}`);
}

// Wait until the studio's active bottom node matches one of `ids`. Node switching
// persists asynchronously (PUT + re-render), so polling here makes the smokes
// timing-robust instead of relying on fixed delays.
export async function waitForActiveNode(page, ids, timeout = 8000) {
  const wanted = Array.isArray(ids) ? ids : [ids];
  await page.waitForFunction(
    (want) => want.includes(document.querySelector("[data-bottom-node-active='true']")?.getAttribute("data-bottom-node-switch") || ""),
    wanted,
    { timeout }
  );
}
