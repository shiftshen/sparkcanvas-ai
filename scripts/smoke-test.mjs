import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = 4199;
const baseUrl = `http://localhost:${port}`;
const tempDir = await mkdtemp(path.join(tmpdir(), "sparkcanvas-smoke-"));
const dataFile = path.join(tempDir, "sparkcanvas.json");
let token = "";

const server = spawn("node", ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: {
    ...process.env,
    PORT: String(port),
    SPARKCANVAS_DATA_FILE: dataFile,
    SPARKCANVAS_DISABLE_IMAGE_GEN: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const health = await request("/health");
      if (health.ok && health.domain === "xmanx.com") return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Server did not become ready.\n${serverLog}`);
}

async function waitForTask(taskId) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const result = await request(`/tasks/${taskId}`);
    if (result.task.status === "completed" && result.frame.status === "success") return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Task ${taskId} did not complete`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForServer();

  const unauthorized = await fetch(`${baseUrl}/workspace`);
  assert(unauthorized.status === 401, "workspace should require a demo token");

  const wrongLogin = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: "shift", password: "wrong-password" })
  });
  assert(wrongLogin.status === 401, "demo login should reject invalid credentials");

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ account: "shift", password: "123456" })
  });
  token = login.token;
  assert(login.user?.credits === 1260, "demo login should return seeded credits");

  const initial = await request("/workspace");
  assert(initial.brands.some((brand) => brand.id === "brand_xmanx" && brand.active), "XMANX should be the active default brand");
  assert(initial.templates.some((template) => template.id === "tpl_brandkit"), "brand kit template should exist");
  assert(initial.models[0]?.id === "imgen-skill", "default image role should be @imgen skill");
  assert(initial.models.some((model) => model.id === "yijiarj-nano-banana-2"), "model selector should still expose yijiarj nano_banana_2");
  assert(initial.models.some((model) => model.id === "yijiarj-grok-video-720p"), "model selector should expose verified yijiarj video model");
  assert(initial.models.some((model) => model.id === "cliproxyapi-gpt-5"), "model selector should keep legacy switchable models");
  assert(typeof initial.ai?.imageGeneration?.model === "string" && initial.ai.imageGeneration.model.length > 0, "workspace should expose sanitized AI skill status");

  const aiStatus = await request("/ai/status");
  assert(typeof aiStatus.imageGeneration.baseUrl === "string" && aiStatus.imageGeneration.baseUrl.includes("/v1"), "AI status should expose image generation base URL");
  assert(!("apiKey" in aiStatus.imageGeneration), "AI status must not expose secrets");
  const aiDiagnostics = await request("/ai/diagnostics");
  assert(aiDiagnostics.runtime.scriptExists === true, "AI diagnostics should find the local image skill script");
  assert(aiDiagnostics.runtime.helpOk === true, "AI diagnostics should verify the local image skill CLI");
  assert(!("apiKey" in aiDiagnostics.imageGeneration), "AI diagnostics must not expose secrets");
  const modelDiagnostics = await request("/ai/models/diagnostics");
  assert(modelDiagnostics.models.some((item) => item.id === "imgen-skill" && item.status === "recommended"), "model diagnostics should mark @imgen as the recommended image route");
  assert(modelDiagnostics.models.some((item) => item.id === "yijiarj-veo-3-1-fast" && item.type === "video"), "model diagnostics should include switchable video candidates");

  const invalidGenerate = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: "" })
  });
  const invalidGenerateBody = await invalidGenerate.json();
  assert(invalidGenerate.status === 400 && invalidGenerateBody.message === "Invalid request payload", "invalid payloads should return JSON 400 errors");

  const brand = await request("/brands", {
    method: "POST",
    body: JSON.stringify({
      name: "XMANX Smoke",
      logoText: "XM",
      primaryColor: "#111827",
      accentColor: "#f97316",
      tone: "black orange launch visuals",
      market: "xmanx.com validation",
      slogan: "AI launch kit for xmanx.com",
      industry: "AI commerce operations",
      targetAudience: "brand operators and performance designers",
      brandStory: "A reusable brand brain for launch posters and canvas workflows.",
      ipName: "XM Smoke IP",
      ipDescription: "A direct AI assistant IP for campaign guidance.",
      logoUsage: "Keep the XM logo crisp with clear safe margin.",
      visualStyle: "black orange commercial product hierarchy",
      sceneKeywords: ["launch poster", "product hero"],
      forbiddenWords: ["fake logo", "messy layout"],
      assetRoles: [
        { role: "logo", title: "XM Smoke Logo", description: "Transparent logo for watermark and corner lockup.", color: "#111827" },
        { role: "ip", title: "XM Smoke IP", description: "Assistant character for brand maintenance.", color: "#f97316" },
        { role: "product", title: "Smoke Product", description: "Hero product reference.", color: "#f97316" }
      ],
      autoInject: true
    })
  });
  assert(brand.name === "XMANX Smoke", "brand creation failed");
  assert(brand.ipName === "XM Smoke IP" && brand.assetRoles.length === 3, "brand detail profile should be stored");

  const activeBrand = await request(`/brands/${brand.id}`, {
    method: "PATCH",
    body: JSON.stringify({ active: true, forbiddenWords: ["fake logo", "blurry product"] })
  });
  assert(activeBrand.active === true, "brand activation failed");
  assert(activeBrand.forbiddenWords.includes("blurry product"), "brand detail patch failed");

  const asset = await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke Product",
      type: "product",
      brandId: brand.id,
      color: "#f97316",
      meta: "smoke asset",
      imageUrl: "/brand-assets/generated/xmanx-product.png"
    })
  });
  assert(asset.title === "Smoke Product", "asset creation failed");

  const updatedAsset = await request(`/assets/${asset.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Smoke Product Edited", meta: "smoke asset edited", type: "model" })
  });
  assert(updatedAsset.title === "Smoke Product Edited" && updatedAsset.meta === "smoke asset edited" && updatedAsset.type === "model", "asset edit should persist");

  await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke Logo Image",
      type: "logo",
      brandId: brand.id,
      color: "#111827",
      meta: "$logo · smoke logo image",
      imageUrl: "/brand-assets/generated/xmanx-logo.png"
    })
  });
  await request("/assets", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke IP Image",
      type: "model",
      brandId: brand.id,
      color: "#f97316",
      meta: "$ip · smoke IP image",
      imageUrl: "/brand-assets/generated/xmanx-ip.png"
    })
  });

  const resolvedRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: '@imgen /生成海报 使用 $model，显示 "会员免费锅底"，画面中心写 $copy.slogan，再加入 $copy.brand_name，主题 %高级感 尺寸: 1080x1350 -> 海报',
      brandId: brand.id,
      brandInject: true
    })
  });
  assert(resolvedRefs.imageReferences.some((reference) => reference.role === "model" && reference.imageUrl), "resolved CAL resources should expose concrete image references");
  assert(resolvedRefs.agents.includes("imgen"), "@imgen should be parsed as the image generation skill agent");
  assert(resolvedRefs.textReferences.some((reference) => reference.key.endsWith(".copy.slogan") && reference.value === brand.slogan), "$copy.slogan should resolve to current brand slogan");
  assert(resolvedRefs.lockedTexts.includes("会员免费锅底") && resolvedRefs.tags.includes("高级感") && resolvedRefs.params["尺寸"] === "1080x1350", "CAL parser should extract locked text, tags and params");
  assert(resolvedRefs.prompt.includes(`"${brand.slogan}"`) && resolvedRefs.finalPrompt.includes("图片资源"), "resolved payload should expand text and keep image reference summary");

  const legacyRefs = await request("/ai/resolve-references", {
    method: "POST",
    body: JSON.stringify({
      prompt: "参考 @LOGO 和 @IP，标题用 @品牌，风格参考 @视觉风格",
      brandId: brand.id,
      brandInject: true
    })
  });
  assert(legacyRefs.imageReferences.some((reference) => reference.role === "logo" && reference.imageUrl), "legacy @LOGO should resolve to logo image reference");
  assert(legacyRefs.imageReferences.some((reference) => reference.role === "ip" && reference.imageUrl), "legacy @IP should resolve to IP image reference");
  assert(legacyRefs.textReferences.some((reference) => reference.key.endsWith(".copy.brand_name") && reference.value === brand.name), "legacy @品牌 should resolve to $copy.brand_name text reference");

  const emptyFrame = await request("/canvas/frames", {
    method: "POST",
    body: JSON.stringify({ brandId: brand.id })
  });
  assert(emptyFrame.workflowNodes.length === 0 && emptyFrame.outputs.length === 0 && emptyFrame.prompt === "", "new canvas should start from a truly empty frame");
  const emptyFrameSettings = await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({ settings: { ratio: "4:5", count: 1, quality: "hd", strength: 72, brandInject: true } })
  });
  assert(emptyFrameSettings.workflowNodes.length === 0, "settings changes on empty canvas must not inject default nodes");
  const emptyFrameLegacyCoreCleanup = await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      workflowNodes: [
        { id: "input-image", type: "image", title: "Reference", body: "", x: 0, y: 0 },
        { id: "brand", type: "brand", title: "Brand", body: "", parentId: "input-image", x: 260, y: 0 },
        { id: "prompt", type: "prompt", title: "Prompt", body: "", parentId: "brand", x: 520, y: 0 },
        { id: "output", type: "output", title: "Output", body: "", parentId: "prompt", x: 780, y: 0 }
      ],
      outputs: []
    })
  });
  assert(emptyFrameLegacyCoreCleanup.workflowNodes.length === 0, "legacy auto core nodes should be cleaned from empty canvases");

  const plainImageNode = {
    id: "node_plain_horse",
    type: "image",
    title: "Image",
    body: "马",
    preview: "#f97316",
    refs: [],
    x: 120,
    y: 160,
    w: 250,
    h: 300
  };
  const frameWithPlainNode = await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      settings: { ratio: "1:1", count: 1, quality: "hd", strength: 70, brandInject: false },
      workflowNodes: [plainImageNode]
    })
  });
  assert(frameWithPlainNode.workflowNodes.length === 1 && frameWithPlainNode.workflowNodes[0].body === "马", "plain prompt image node should stay on empty canvas");
  const plainGeneratedNode = await request(`/canvas/frames/${emptyFrame.id}/nodes/${plainImageNode.id}/generate`, {
    method: "POST",
    body: JSON.stringify({
      prompt: "马",
      modelId: "imgen-skill",
      settings: { ratio: "1:1", count: 1, quality: "hd", strength: 70, brandInject: false }
    })
  });
  assert(plainGeneratedNode.node.body.startsWith("马\n模型:"), "plain prompt generation should not prepend brand workflow context");
  assert(!plainGeneratedNode.node.body.includes("XMANX") && !plainGeneratedNode.node.body.includes("xmanx.com"), "plain prompt generation should not include XMANX unless referenced");
  assert(plainGeneratedNode.node.refs?.[0]?.imageUrl?.startsWith("data:image/svg+xml") || plainGeneratedNode.node.refs?.[0]?.imageUrl?.startsWith("/generated/"), "generated image node should keep a displayable image on canvas");
  const plainAudioNode = {
    id: "node_plain_audio",
    type: "audio",
    title: "Audio",
    body: "simple beat",
    parentId: plainImageNode.id,
    preview: "#7c3aed",
    x: 420,
    y: 160,
    w: 230,
    h: 238
  };
  await request(`/canvas/frames/${emptyFrame.id}`, {
    method: "PATCH",
    body: JSON.stringify({ workflowNodes: [plainGeneratedNode.node, plainAudioNode] })
  });
  const plainAudioGenerated = await request(`/canvas/frames/${emptyFrame.id}/nodes/${plainAudioNode.id}/generate-audio`, {
    method: "POST",
    body: JSON.stringify({ prompt: "simple beat", model: "gpt-5.4", settings: { mode: "配乐", duration: "15s", scene: "广告短视频", loop: false, translate: false } })
  });
  assert(/品牌约束:\s*无品牌/.test(plainAudioGenerated.audioPlan), `unbranded audio nodes should stay unbranded: ${plainAudioGenerated.audioPlan}`);
  assert(!plainAudioGenerated.audioPlan.includes("XMANX") && !plainAudioGenerated.audioPlan.includes("xmanx.com"), "unbranded audio nodes should not inject XMANX unless referenced");

  const generated = await request("/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: '@imgen /生成海报 使用 $model $logo，显示 $copy.slogan，为 xmanx.com 黑橙色运动鞋生成首发海报，主题 %新品上市',
      mode: "magic",
      modelId: "imgen-skill",
      brandId: brand.id,
      brandInject: true,
      settings: { ratio: "4:5", count: 2, quality: "hd", strength: 66, duration: 0, brandInject: true },
      x: 360,
      y: 220
    })
  });
  assert(generated.credits < login.user.credits, "credits should be deducted");

  const completed = await waitForTask(generated.taskId);
  assert(completed.frame.progress === 100, "completed frame should reach 100%");
  assert(completed.frame.modelName === "@imgen · image skill", "selected @imgen skill role should be stored on the frame");
  assert(completed.frame.brandId === brand.id && completed.frame.brandInjected === true, "generated frame should store brand injection state");
  assert(completed.frame.brandContext.includes("XM Smoke IP"), "brand context should include IP details");
  assert(completed.frame.finalPrompt.includes("$copy.brand_name XMANX Smoke") && completed.frame.finalPrompt.includes("【本次任务】"), "final prompt should include code-style organized brand context");
  assert(completed.frame.finalPrompt.includes("【资源解析】") && completed.frame.finalPrompt.includes("AI launch kit for xmanx.com"), "final prompt should resolve CAL image refs and text refs");
  assert(completed.frame.workflowNodes?.some((node) => node.type === "prompt" && node.body.includes("xmanx.com")), "workflow should expose the prompt node");
  assert(completed.frame.workflowNodes?.some((node) => node.type === "image"), "workflow should expose an image input node");
  const inputRefs = completed.frame.workflowNodes.find((node) => node.id === "input-image")?.refs ?? [];
  assert(inputRefs.length >= 1 && inputRefs.every((ref) => ref.imageUrl), "workflow should auto-build concrete image references only");
  assert(!completed.frame.workflowNodes.some((node) => node.id?.startsWith("ref-")), "workflow should keep brand references grouped in one multi-image node by default");
  assert(completed.frame.steps.some((step) => step.includes("XMANX Smoke")), "Brand Agent should inject active brand");

  const editedWorkflowNodes = completed.frame.workflowNodes.map((node) => (
    node.id === "input-image"
      ? { ...node, title: "可编辑参考图", body: "可编辑参考图：Logo / IP / 模特 / 批量商品素材", preview: "#22c55e", x: 88, y: 188, refs: [...node.refs, { id: "ref_smoke_model", role: "model", title: "Smoke 模特参考", description: "用于测试多图参考编辑", color: "#22c55e", imageUrl: "data:image/svg+xml;base64,PHN2Zy8+" }] }
      : node.id === "brand"
        ? { ...node, body: `${completed.frame.brandContext}\n项目微调：本批图片强调绿色上线活动。` }
        : node
  ));
  editedWorkflowNodes.splice(1, 0, {
    id: "node_smoke_reference",
    type: "reference",
    title: "新增参考节点",
    body: "插入在商品和品牌之间的补充参考。",
    preview: "#22c55e",
    x: 310,
    y: 500
  });
  editedWorkflowNodes.push(
    { id: "node_smoke_text", type: "process", title: "文本故事", body: "把首发海报拆成三幕故事", parentId: "prompt", preview: "#2563eb", x: 590, y: 500 },
    { id: "node_smoke_script", type: "script", title: "脚本", body: "黑橙运动鞋 10 秒短片", parentId: "node_smoke_text", preview: "#f97316", x: 860, y: 500 },
    { id: "node_smoke_video", type: "video", title: "视频", body: "把脚本生成产品短视频", parentId: "node_smoke_script", preview: "#111827", x: 1130, y: 500 },
    { id: "node_smoke_compose", type: "compose", title: "视频合成", body: "合成多个视频节点", parentId: "node_smoke_video", preview: "#0f766e", x: 1400, y: 500 },
    { id: "node_smoke_audio", type: "audio", title: "音频", body: "生成科技感节奏配乐", parentId: "node_smoke_video", preview: "#7c3aed", x: 1400, y: 650 }
  );
  const editedOutputs = completed.frame.outputs.map((output, index) => index === 0 ? { ...output, title: "首屏主图", copy: "用于 xmanx.com 首页首屏，保留 Logo 安全边距" } : output);

  const savedWorkflow = await request(`/canvas/frames/${generated.frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      brandContext: editedWorkflowNodes.find((node) => node.id === "brand").body,
      workflowNodes: editedWorkflowNodes,
      outputs: editedOutputs,
      modelId: "cliproxyapi-gpt-5",
      settings: { ratio: "16:9", count: 4, quality: "ultra", strength: 88, duration: 5, brandInject: true }
    })
  });
  assert(savedWorkflow.modelId === "cliproxyapi-gpt-5" && savedWorkflow.modelName.includes("gpt-5"), "model switch should persist");
  assert(savedWorkflow.brandId === brand.id, `workflow save should keep selected brand: ${savedWorkflow.brandId} !== ${brand.id}`);
  assert(savedWorkflow.settings.ratio === "16:9" && savedWorkflow.settings.quality === "ultra" && savedWorkflow.settings.strength === 88, "generation parameters should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").body.includes("可编辑参考图"), "reference node edits should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").refs.some((reference) => reference.id === "ref_smoke_model"), "multi image reference edits should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").refs.some((reference) => reference.id === "ref_smoke_model" && reference.imageUrl?.startsWith("data:image")), "uploaded reference image data should persist");
  assert(savedWorkflow.workflowNodes.find((node) => node.id === "input-image").x === 88, "node drag positions should persist");
  assert(savedWorkflow.workflowNodes.some((node) => node.id === "node_smoke_reference" && node.type === "reference"), "inserted workflow nodes should persist");
  for (const type of ["process", "script", "video", "compose", "audio"]) {
    assert(savedWorkflow.workflowNodes.some((node) => node.type === type), `${type} node should persist`);
  }
  assert(savedWorkflow.brandContext.includes("绿色上线活动"), "brand context workflow edit should persist");
  assert(savedWorkflow.outputs[0].title === "首屏主图", "output node edits should persist");

  const textNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_text/generate-text`, {
    method: "POST",
    body: JSON.stringify({ prompt: "生成三镜头分镜表格", model: "gpt-5.4", translate: false, mode: "table" })
  });
  assert(textNode.text.includes("| 镜号 |") && textNode.node.type === "process", "text node should generate storyboard table");

  const scriptNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_script/generate-script`, {
    method: "POST",
    body: JSON.stringify({ prompt: "生成黑橙运动鞋短片脚本", model: "gpt-5.4", translate: true })
  });
  assert(scriptNode.script.includes("镜头 1") && scriptNode.node.type === "script", "script node should generate editable storyboard script");

  const videoNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_video/generate-video`, {
    method: "POST",
    body: JSON.stringify({ prompt: "保存文生视频配置", model: "grok-imagine-1.0-video-super-720p", settings: { mode: "文生视频", ratio: "9:16 · 720P · 5s", duration: "5s", sound: true, translate: false } })
  });
  assert(videoNode.videoPlan.includes("视频类型: 文生视频") && videoNode.node.type === "video", "video node should save generation plan");

  const audioNode = await request(`/canvas/frames/${generated.frame.id}/nodes/node_smoke_audio/generate-audio`, {
    method: "POST",
    body: JSON.stringify({ prompt: "生成科技感节奏配乐", model: "gpt-5.4", settings: { mode: "配乐", duration: "15s", scene: "广告短视频", loop: false, translate: false } })
  });
  assert(audioNode.audioPlan.includes("音频类型: 配乐") && audioNode.node.type === "audio", "audio node should save generation plan");

  const moved = await request(`/canvas/frames/${generated.frame.id}`, {
    method: "PATCH",
    body: JSON.stringify({ x: 480, y: 260, brandInject: false })
  });
  assert(moved.x === 480 && moved.y === 260, "frame position should persist");
  assert(moved.brandId === brand.id, `frame should keep selected brand after updates: ${moved.brandId} !== ${brand.id}`);
  assert(moved.brandInjected === false && moved.brandContext === "", "brand injection toggle should hide full brand context");
  assert(moved.finalPrompt.includes("AI launch kit for xmanx.com") && !moved.finalPrompt.includes("$copy.brand_name XMANX Smoke"), `resource references should still resolve without full brand context injection: ${moved.finalPrompt}`);

  const after = await request("/workspace");
  const migratedEmptyFrame = after.frames.find((frame) => frame.id === emptyFrame.id);
  assert(migratedEmptyFrame?.workflowNodes.some((node) => node.id === plainImageNode.id && node.refs?.length), "workspace should keep generated image nodes on canvas");
  assert(after.assets.length === initial.assets.length + 4, "only manually created brand materials should be added to assets");
  assert(after.frames[0].status === "success", "latest frame should be successful");

  const exported = await request("/workspace/export");
  assert(exported.domain === "xmanx.com", "workspace export should include production domain");

  console.log(JSON.stringify({
    ok: true,
    checked: ["auth-gate", "login", "bad-login", "json-validation", "brand", "asset", "asset-edit", "ai-status", "ai-diagnostics", "model-diagnostics", "resolve-references", "legacy-reference-alias", "model", "parameters", "workflow-nodes", "text", "script", "video", "audio", "generate", "task", "canvas", "export"],
    latestFrame: after.frames[0].title,
    credits: after.user.credits
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(tempDir, { recursive: true, force: true });
}
