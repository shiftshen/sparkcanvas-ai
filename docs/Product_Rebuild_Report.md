# SparkCanvas Product Rebuild Report

## 产品定位

SparkCanvas 是面向 xmanx.com 的品牌驱动 AI 生产画布。正确流程不是先堆素材卡片，而是：

1. 维护品牌档案与产品素材。
2. 用一句话创建一个项目工作流。
3. 在画布上微调节点、参考、提示词、模型参数和输出要求。
4. 将品牌上下文与工作流节点整理成最终提示词。
5. 执行可控的图片生成、图片编辑或批量生产。

## 本轮重构内容

- 工作流节点从固定 UI 改为可保存的节点对象。
- 节点标题可编辑。
- 节点可拖动，位置保存到 `workflowNodes[].x/y`。
- 每个节点都支持在前面或后面插入节点。
- 支持新增参考节点和处理步骤节点。
- 非核心新增节点可删除。
- 参考图节点可编辑说明和预览色。
- 品牌上下文节点可按项目微调。
- 输出节点可编辑结果名称、输出要求和图片/视频类型。
- 生成时会提交微调后的 `workflowNodes`、`brandContext` 和 `outputs`。
- 品牌管理重构为视觉素材优先：Logo、IP/模特、商品、场景素材以图片卡片方式管理。
- 品牌图片素材会自动进入工作流“多图参考”节点，并整理进品牌上下文与最终提示词。
- 资产页改为素材库浏览/筛选/多选，不再默认显示“保存素材”表单。
- 导入素材改为用户主动点击“导入”后打开，避免把素材创建当成默认流程。
- 生成结果不再自动写入品牌素材库；结果保留在画布/历史，只有主动导入的素材才成为品牌参考。
- 画布增加底部生成控制台：参考缩略图、提示词、模型、比例、张数和生成按钮集中在同一操作区。
- 已清理历史生成素材污染，品牌参考只使用主动维护的 Logo、IP、商品、模特和上传素材。

## 已测试流程

- 登录与鉴权。
- 默认品牌档案加载。
- 品牌详细字段创建与保存。
- 素材创建。
- 一句话生成工作流。
- 模型选择和参数保存。
- 品牌上下文注入与关闭注入。
- 参考节点内容编辑。
- 节点标题编辑。
- 节点位置持久化。
- 插入参考节点持久化。
- 输出节点标题和要求持久化。
- 工作流再次生成。
- 资产主动导入。
- 资产多选加入当前工作流参考。
- 工作区导出。

## 自动化验证结果

- `npm test` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- Browser verification confirmed the rebuilt UI exposes editable node titles, node insertion controls, visual brand material cards, asset multi-select, model selectors, minimap, zoom controls and bottom generation composer.
- 注：凡涉及生产路径的变更（如登录/认证、CORS、公开引用 URL、上传/对象存储、视频生成生产链路），在认定本重构/验证完成前还必须额外运行 `npm run test:production-smoke`。

## 仍需后续真实接入

- 当前生成结果仍是本地模拟输出，后续需要接入真实图片生成/编辑模型 API。
- 上传真实图片文件和图像预览需要接入对象存储或本地上传服务。
- 批量生产需要增加 CSV/表格任务队列与批量结果管理。
## 2026-05-16 RunningHub-style interaction QA

### 本轮修复

- 将节点间 `+` 菜单从 hover-only 改成 click-to-open，菜单打开后不会因为鼠标移动立刻消失。
- `Image` 按钮现在会插入并渲染 reference 图片节点。
- `Text` 按钮现在会插入并渲染 process/text 节点，修复之前点击后没有可见结果的问题。
- 新增 `ProcessNodePreview`：点击 Text 节点可打开编辑浮层，输入本节点的文字/操作说明。
- 加号菜单保留 RunningHub 风格的 `Image / Text` 两个大按钮。

### 浏览器交互验证

在 `http://localhost:3000/` 真实页面中验证：

- 点击节点间圆形 `+` 后，菜单稳定打开，显示 `Image` 与 `Text`。
- 点击 `Image` 后，画布新增 reference 图片节点。
- 点击 `Text` 后，画布新增 text/process 节点。
- 新增 Text 节点可见，显示 `Text / Click to edit prompt or operation`。
- 侧栏默认关闭，画布优先显示。
- 底部命令台存在并保持固定可读尺寸。

实测 DOM 结果：

```json
{
  "before": { "nodes": 11, "refs": 7, "processes": 0, "menus": 10 },
  "menuAfterPlus": { "open": 1, "text": "Image\nText" },
  "afterImage": { "nodes": 13, "refs": 9, "processes": 0 },
  "afterText": { "nodes": 15, "refs": 10, "processes": 1 }
}
```

### 自动化验证

- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.
- 后端 smoke 覆盖登录、品牌、资产、模型、工作流节点、生成、任务完成、画布保存和导出。

### 注意

当前 Codex 内嵌浏览器自动化无法稳定模拟中文输入，报 `virtual clipboard is not installed`，所以中文提示词输入的浏览器自动化未作为硬性断言；生成链路由 smoke test 验证。真实用户在浏览器中可直接键入。

## 2026-05-16 Project-Level Navigation & Requirements Reset

### 重新整理后的产品需求

SparkCanvas 不是单一画布 demo，而是品牌驱动的 AI 生产工作台：

- Canvas：主工作区，默认进入，承载 RunningHub-style 无限画布、节点、连线、插入 Image/Text、底部生成命令台。
- Assets：品牌素材库，管理 Logo、IP/模特、商品、场景等参考素材；支持多选加入当前工作流。
- Brand：品牌管理，维护品牌档案、视觉素材、品牌上下文和默认注入策略。
- Templates：模板入口，用于 Amazon 主图、小红书、视频、批量换背景、品牌套装维护等预设工作流。
- History：历史项目和任务记录，用于回到任一生成项目。

### 本轮修复

- 恢复项目级入口，不再让产品只剩画布。
- 左侧固定工作台栏现在包含：Assets、Brand、Templates、History、Fit、缩放。
- 每个入口都会打开同一个工作台抽屉，并自动切换到对应页面。
- 抽屉新增标题、说明和关闭按钮，避免用户不知道当前在哪个模块。
- 画布保持默认主视图，抽屉默认关闭，但所有模块随时可进入。

### 浏览器验证

在 `http://localhost:3000/` 逐项点击左侧入口：

- Assets：打开素材库，显示素材筛选、多选和加入工作流。
- Brand：打开品牌管理，显示品牌档案和视觉素材。
- Templates：打开模板页，显示 Amazon 主图、小红书、视频、批量、品牌模板。
- History：打开历史页，显示生成项目和任务记录。
- 关闭按钮：可关闭抽屉，返回纯画布。

### 自动化验证

- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-16 Full Interaction Regression: Menu Click Fix

### 问题

用户反馈菜单显示后点击无反应。复测发现不是业务逻辑完全失效，而是交互目标随画布缩放后变得过小，并且菜单层级可能被浮层压住：

- 当前画布缩放为 34% 时，节点间 `+` 和菜单按钮的物理点击区域也跟着缩小。
- 菜单视觉上显示，但真实可点击区域只有约 22px 高，手动点击很容易落空。
- 参考编辑浮层存在时，菜单层级不够高，会进一步造成“看到但点不到”。

### 修复

- 将节点间 `+` 控件整体反向缩放，保持可点击尺寸。
- 将菜单按钮物理高度固定为 64px。
- 将菜单层级提升到 reference popover 之上。
- Image/Text 使用稳定 click handler 插入节点。

### 浏览器回归结果

真实浏览器流程复测：

```json
{
  "before": { "width": 28, "height": 28, "refs": 4, "processes": 0 },
  "menu": { "open": 1, "buttonHeights": [64, 64], "text": "Image\nText" },
  "afterImage": { "refs": 6, "processes": 0, "open": 0 },
  "afterText": { "refs": 7, "processes": 1, "processCard": true, "open": 0 }
}
```

### 完整验证

- 左侧 Assets / Brand / Templates / History 均可打开并切换。
- 面板可关闭返回纯画布。
- 节点间 `+` 菜单可打开。
- Image 可插入 reference 节点。
- Text 可插入 process/text 节点。
- Text 节点可见。
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-16 Navigation Rebuild + XMANX Real Brand Case

### 导航重构

- 左侧导航从画布层剥离，改为固定工作区侧栏，避免被画布拖拽、缩放和底部控制台遮挡。
- 导航支持展开/收起；展开时显示 Brand / Assets / Templates / History 文本，收起时保留图标操作。
- 再次点击当前入口会关闭面板，解决“打开后难关闭”的问题。
- 面板位置跟随导航展开状态变化，不再挡住底部生成控制台。

### 品牌与素材

- 清理演示品牌和测试素材，当前默认数据只保留 XMANX。
- 新增 XMANX 真实品牌案例素材：Logo、XM Navigator IP、固定 AI 模特、黑橙商品主图、xmanx.com 店铺视觉。
- Assets 和 Brand 页面都显示真实图片缩略图，不再只显示文字或色块。
- Brand / Assets 新增素材时可上传图片，图片会保存到资产并进入多图参考。

### 图片生成接入

- 新增 `scripts/generate_image.py`，按项目要求走 GPT 模型 + `image_generation` tool + `/v1/responses`。
- 后端生成链路改为调用本地 `scripts/generate_image.py`，不在业务代码里直接请求图片网关。
- 环境变量优先级：`IMAGE_GEN_BASE_URL` / `OTCBOT_BASE_URL` / `CPA_BASE_URL` / `OPENAI_BASE_URL` 和对应 key。
- 任务完成阶段会把品牌上下文、多图参考和最终提示词交给本地 skill 脚本，并把真实生成 PNG 写入 `/generated/*`。
- 模型列表收敛为唯一默认模型：`cliproxyapi · gpt-5.4`。
- 已用 `cliproxyapi` 真实生成 XMANX Logo、IP、模特、商品和店铺视觉 PNG，替换原占位 SVG。

### 浏览器回归

最终在 `http://localhost:3000/` 验证：

- Brand / Assets / Templates / History 全部可点击打开。
- 当前导航入口再次点击可关闭面板。
- Assets 显示 5 个 XMANX 图片素材，5 个都有缩略图。
- Brand 显示 5 个 XMANX 视觉素材，5 个都有图片。
- 底部 Add 可打开多图参考抽屉，抽屉内 6 个参考项均有上传入口。
- 模型下拉仅包含 `cliproxyapi · gpt-5.4`。
- 画布多图参考区显示 4 张图片，输出节点显示真实图片。
- 使用本地 skill 完成一次真实工作流生成，输出 `/generated/xmanx-f9oqV2qI-1.png`。

### 自动化验证

- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.
- `scripts/generate_image.py --help` passed.

## 2026-05-16 Canvas Image Operation Regression Fix

### 本轮修复

- 修复窄屏/移动宽度下复用旧 viewport 导致画布整体偏到屏幕外的问题；进入项目、切换项目、点击 Fit、窗口尺寸变化时都会按当前项目重新适配可视区域。
- 连线 `+` 菜单改为纯点击打开，不再依赖 hover；移动鼠标到 `Image / Text` 按钮时菜单保持打开。
- 窄屏下连线菜单宽度收敛到 220px，避免按钮超出屏幕右侧。
- 图片节点操作改成点击图片后打开大图操作框，包含预览、下载、替换、前插、后插。
- 参考图片节点同样支持点击大图预览和节点操作。
- 输出结果图支持点击放大预览、下载和前后插入节点。
- 图片操作弹窗挂载到页面根层，避免被无限画布的 transform 缩放、位移影响。
- 图片节点的替换、前插、后插按钮常驻显示，避免 hover 过程中按钮消失。
- 移动宽度下导航固定为稳定图标栏，面板从右侧展开；再次点击当前导航入口可关闭面板。

### 浏览器回归结果

在 `http://localhost:3000/` 的 378px 窄屏视口复测：

```json
{
  "firstAdd": { "left": 201, "top": 236, "width": 28, "height": 28 },
  "firstImage": { "left": 82, "top": 205, "width": 105, "height": 92 },
  "edgeMenu": { "left": 85, "right": 305, "width": 220, "display": "grid", "text": "ImageText" },
  "referencePopover": { "left": 14, "right": 364, "top": 85, "bottom": 703 },
  "outputPopover": { "left": 14, "right": 364, "top": 106, "bottom": 682 },
  "navigationPanel": { "left": 72, "right": 368, "top": 66, "bottom": 778 }
}
```

### 自动化验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-16 Panel Auto Dismiss UX Fix

### 本轮修复

- 侧边面板打开时，在画布区域增加透明关闭层。
- 点击画布任意可见区域会先关闭侧边面板，避免面板一直挡住画布。
- 点击侧边面板内部不会关闭，便于继续编辑品牌、素材、模板和历史。
- 点击左侧导航仍可切换或重新打开对应面板。
- 同时保留 `click`、`mousedown`、`pointerdown`、`touchstart` 事件兜底，覆盖鼠标和触屏操作。

### 验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.
- 浏览器 DOM 命中验证：面板打开后，画布可见区域命中 `.panel-dismiss-layer`，侧边面板内部命中 `.side-panel`，层级符合预期。

## 2026-05-19 RunningHub-Style Single Canvas Rebuild

### 产品级重构

- 前端从多页面工作台改为单画布工作台：打开后只看到顶部状态栏、左侧工具栏、中央无限画布、底部生成栏。
- 删除旧版复杂侧栏布局和冗余页面密度，品牌、素材、模板、项目都变成轻量抽屉。
- 保留后端真实生成链路、XMANX 默认品牌、品牌素材、多图参考、本地 `cliproxyapi · gpt-5.4` 模型配置。
- 工作流节点收敛为 RunningHub 风格横向画布：Reference / Brand / Prompt / Model / Output。
- 节点间连线保留 `+` 插入菜单，支持新增 `Image` 和 `Text` 节点。
- 图片节点点击直接进入大图预览，预览层包含前插、后插、下载、替换动作。
- 底部生成栏保留一句话输入、模型、比例、张数、质量和生成按钮。
- 素材抽屉支持上传、选择、多选加入当前画布参考、下载和删除。
- 品牌抽屉只保留关键品牌字段和品牌图片，隐藏复杂信息架构。

### 浏览器验证

在 `http://localhost:3000/` 验证：

- `.rh-topbar`、`.rh-rail`、`.rh-canvas`、`.rh-composer` 均正常渲染。
- 当前画布渲染 9 个节点和 8 个连线插入控件。
- 素材抽屉可打开，显示 XMANX 真实品牌素材。
- 导航再次点击可关闭抽屉。
- 图片节点可打开大图预览。
- 连线 `+` 可打开 `Image / Text` 插入菜单。
- 模板抽屉可打开并显示 5 个模板。

### 自动化验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-19 Project Creation and Branch Workflow Fix

### 本轮修复

- Projects 抽屉新增 `新建项目 / 流程`，用当前提示词创建一个新的干净画布项目。
- 新建项目不再复用当前画布的已编辑节点，避免把旧项目分支污染到新项目。
- 工作流节点支持 `parentId`，从线性列表升级为可持久化的图结构。
- 每个节点右侧都有独立 `+`，不再只允许在相邻节点中间插入。
- 最后的 `Output` 节点也可以继续 `+`，支持继续向后执行。
- `+` 菜单新增 `Output`，可从任意节点生成新的输出节点。
- 同一个节点可以连续添加多个 `Output`，形成一对多分支，例如一张参考图生成多个结果图。
- 后端 `workflowNodeSchema` 增加 `parentId`，分支关系可保存到画布数据。
- 模型节点显示强制收敛为当前唯一模型 `cliproxyapi · gpt-5.4`，避免旧数据里的模型文案继续露出。

### 浏览器验证

在 `http://localhost:3000/` 验证：

- 初始画布 5 个节点对应 5 个 `+` 控件，最后 Output 也有 `+`。
- 点击 Output 节点右侧 `+`，菜单显示 `Image / Text / Output`。
- 从同一个 Output 连续添加 2 个 Output，画布变为 7 个节点、3 个 Output、7 个 `+`，形成一对多输出分支。
- Projects 抽屉显示 `新建项目 / 流程` 入口。
- Model 节点显示 `cliproxyapi · gpt-5.4`。

### 自动化验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-19 Per-Node Editing and Node Image Generation

### 本轮修复

- 点击任意节点会打开统一节点编辑面板，不再只有部分节点可编辑。
- 编辑面板支持修改节点名称和节点提示词/处理说明。
- 新增 Image / Reference / Output 节点默认可以是空图片节点。
- 空图片节点可在编辑面板里输入提示词并点击 `生成图片`。
- 后端新增 `POST /canvas/frames/:id/nodes/:nodeId/generate`，按当前节点提示词调用本地图片生成链路，并把图片回写到该节点。
- Reference / Image 节点生成后会写入 `node.refs[0].imageUrl`。
- Output 节点生成后会写入对应 `frame.outputs[]`，动态输出节点也会自动补输出记录。
- 生成失败或缺少图片生成环境变量时使用 XMANX 品牌素材兜底，保证流程不断。

### 浏览器验证

在 `http://localhost:3000/` 验证：

- 从节点 `+` 新增空 Image 节点。
- 点击空 Image 节点后打开 `.rh-node-editor`。
- 在编辑器输入节点提示词：`生成一张黑橙色 XMANX 运动鞋电商主视觉，干净背景，突出商品质感`。
- 点击 `生成图片` 后，节点编辑器从空图片状态变为当前图片状态，并出现下载按钮。
- 当前测试环境未设置 `IMAGE_GEN_KEY`，后端按预期回落到 `/brand-assets/generated/xmanx-product.png`；配置 key 后会走 `scripts/generate_image.py` 本地 skill。

### 自动化验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-19 RunningHub-Style Image Editor Controls

### 本轮修复

- 图片节点编辑面板改为目标站点风格的图片生成控制器。
- 顶部工具栏包含：风格、标记、聚焦、列表、放大、关闭。
- 中间保留节点标题与大提示词输入区，占位文案为：`描述你想要生成的画面内容，按/呼出指令，@引用素材`。
- 底部控制栏包含：Lib Nano Pro、16:9 · 2K、摄像机、翻译、参数、1张、积分、提交按钮。
- 提交按钮继续调用节点级生成接口，把结果回写到当前图片节点或输出节点。
- 已适配窄屏，工具栏和底部控制栏横向滚动，避免挤压主要输入区。

### 浏览器验证

在 `http://localhost:3000/` 验证：

- 点击图片节点后打开 `.rh-image-editor`。
- 顶部工具栏显示 `风格 / 标记 / 聚焦 / 列表`。
- 提示词输入区显示目标占位文案。
- 底部显示 `Lib Nano Pro / 16:9 · 2K / 摄像机 / 1张 / ♦14 / 提交按钮`。
- 提交按钮 `.submit` 存在。

### 自动化验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-19 Text Node Model Translate Generate Controls

### 本轮修复

- Text 节点改为可点击打开独立文本生成器，不再只是普通 textarea。
- Text 节点卡片视觉改为目标站点风格的大文本节点，占位为 `根据图片生成提示词`。
- 文本编辑器支持模型选择：`GVLM 3.1`、`cliproxyapi · gpt-5.4`、`Lib Nano Pro`。
- 文本编辑器支持翻译开关。
- 文本编辑器底部显示积分 `♦ 6` 与提交按钮。
- 后端新增 `POST /canvas/frames/:id/nodes/:nodeId/generate-text`，生成文本后回写到当前 Text 节点。
- 当前文本生成先使用品牌上下文和规则兜底，后续可替换为同一模型网关真实文本生成。

### 浏览器验证

在 `http://localhost:3000/` 验证：

- 从节点 `+` 新增 Text 节点。
- 点击 Text 节点后打开 `.rh-text-editor`。
- 编辑器默认模型为 `GVLM 3.1`。
- 编辑器存在翻译按钮、积分 `♦ 6`、提交按钮 `.submit`。
- 受内嵌浏览器虚拟剪贴板限制，自动化无法 `fill` 中文输入；可见控件和接口已完成。

### 自动化验证

- `npm run check` passed.
- `npm test` passed.
- `npm audit --audit-level=moderate` passed, 0 vulnerabilities.

## 2026-05-20 LibTV-Style Video Node Controls

### 本轮修复

- 新增 `video` 工作流节点类型，前后端 schema 均已支持保存、加载和生成配置回写。
- 节点右侧 `+` 菜单新增 `Video`，可从任意节点继续分支出视频节点，保持一对多画布结构。
- 视频节点卡片改为简洁播放态：播放图标、提示词摘要、`16:9 · 720P · 5s` 默认规格。
- 点击视频节点打开 LibTV 风格视频编辑器：
  - 顶部：`文生视频 / 全能参考 / 图生视频 / 首尾帧 / 图片参考`。
  - 工具：`标记 / 运镜 / 角色库 / 当前素材数`。
  - 主区：视频提示词输入、空视频预览播放态。
  - 底部：`Seedance 2.0 VIP`、比例清晰度时长、音效、翻译、参数、数量、积分和提交按钮。
- 后端新增 `POST /canvas/frames/:id/nodes/:nodeId/generate-video`，当前先保存视频生成计划、品牌约束和参数。项目尚未提供真实视频生成 skill，因此不伪造视频文件。

### 对比参考站点

参考 `https://www.liblib.tv/canvas?projectId=d960b84f62b84f9facd9f387b9f0e01f` 的最后截图：

- 保留深色无限画布、节点连线、视频节点播放图标。
- 视频详细功能集中到浮层，避免把节点卡片做复杂。
- 参数只展示生产所需的一级控制，不新增无效页面。

### 浏览器验证

在 `http://localhost:3000/` 验证：

- 画布中 Video 节点可点击。
- 点击后出现 `.rh-video-editor`。
- 编辑器显示 `文生视频 / 全能参考 / 图生视频 / 首尾帧 / 图片参考`。
- 编辑器显示 `Seedance 2.0 VIP / 16:9 · 720P · 5s / 音效 / 翻译 / 参数 / 1个 / ♦135 / 提交按钮`。
- 提交按钮在空提示词时禁用，避免误提交。
- API 直接验证 `generate-video` 返回 200，并回写 `node.type=video` 与视频生成计划。

### 自动化验证

- `npm run check` passed.

## 2026-05-20 Script Node Controls

### 本轮修复

- 新增 `script` 工作流节点类型，用于剧情脚本、角色参考、视频参考到分镜脚本的生成。
- 节点右侧 `+` 菜单新增 `Script`，可从任意节点追加脚本节点。
- Script 节点卡片改为参考截图里的大文本节点样式：深色卡片、居中列表图标、简洁说明。
- Script 编辑器改为底部浮层，包含：
  - 大输入区：`描述剧情或添加角色参考、视频参考等，为你生成分镜脚本`
  - 模型选择：`GVLM 3.1 / cliproxyapi · gpt-5.4`
  - 翻译按钮、积分 `♦ 6`、提交按钮
- 后端新增 `POST /canvas/frames/:id/nodes/:nodeId/generate-script`，按品牌约束生成三镜头分镜脚本并回写当前 Script 节点。

### 验证

- `npm run check` passed.
- `generate-script` API 验证通过：返回 200，回写 `node.type=script`，脚本包含 `镜头 1`。
- `npm test` passed.
- `npm audit --audit-level=moderate` passed，0 vulnerabilities。

## 2026-05-20 Node Menu And Multi-Node Types

### 本轮修复

- 按参考截图重构节点 `+` 菜单：
  - `添加节点`：文本、图片、视频、视频合成 Beta、音频、脚本 Beta。
  - `添加资源`：上传、从图库选择。
- 新增 `compose` 视频合成节点类型：
  - 节点卡片显示剪刀图标。
  - 默认文案：`空空如也，请连接视频节点后操作`。
  - 编辑器可先保存剪辑顺序、转场、节奏、输出规格等配置。
- 新增 `audio` 音频节点类型：
  - 节点卡片显示音频图标。
  - 编辑器可先保存旁白、音效、配乐风格或音频参考。
- 文本节点增加两种模式：
  - `文本故事`
  - `生成表格`
- 后端 `generate-text` 支持 `mode=table`，可生成分镜表格字段：镜号、时长、画面描述、角色、参考、景别、动作、情绪、光影、音效、分镜提示词、视频运动提示词。

### 验证

- `npm run check` passed.
- API 验证：
  - `compose` / `audio` 新节点类型可保存。
  - `generate-text` 使用 `mode=table` 返回 200，输出包含表格头 `| 镜号 |`。

## 2026-05-20 Model And Image Skill Configuration

### 本轮修复

- 模型不再写死为单一不可选项：
  - 默认模型仍为 `cliproxyapi · gpt-5.4`。
  - 新增可切换模型 `cliproxyapi · gpt-5`。
  - 烟测更新为验证默认模型和可切换模型，而不是要求只有一个模型。
- 底部生成栏参数改为可编辑并保存：
  - 模型
  - 比例
  - 数量
  - 质量
  - 强度
  - 时长
  - 品牌注入
- 图片节点编辑器参数改为可编辑：
  - 模型
  - 比例
  - 质量
  - 数量
  - 强度
- 节点级图片生成会把模型和参数传给后端。
- 后端图片生成继续走本地 `scripts/generate_image.py` skill，并把所选模型传给脚本 `--model`。
- 新增本地私有配置支持：
  - 环境变量仍优先。
  - 可使用 `auth.json` 或 `config/auth.json`。
  - `auth.json` 和 `config/auth.json` 已加入 `.gitignore`。
  - 新增 `config/auth.example.json` 作为无密钥模板。
- 默认图片生成 base URL 为 `https://api.otcbot.com/v1`，实际 key 只从环境变量或本地私有配置读取。

### 验证

- `npm test` passed.
- `npm audit --audit-level=moderate` passed，0 vulnerabilities。
- API 验证模型与参数可保存：
  - 模型列表返回 `cliproxyapi-gpt-5-4, cliproxyapi-gpt-5`。
  - PATCH 画布可保存 `modelId=cliproxyapi-gpt-5`、`ratio=16:9`、`quality=ultra`、`strength=88`、`brandInject=false`。
- 真实图片 skill 调用路径已验证到网关，请求发送到 `/v1/responses`；本次使用的 key 返回 `HTTP 401 Invalid API key`，因此未得到真实图片文件。代码没有写入该 key。

## 2026-05-20 Fresh Audit And Completion Push

### 本轮修复

- 后端新增 `GET /ai/status`，返回脱敏后的图片生成 skill 配置状态：
  - 是否已配置 key。
  - base URL 和来源。
  - 当前模型。
  - key 来源。
  - provider 和 skill 路径。
  - 不返回任何密钥值。
- `/workspace` 返回体新增 `ai`，前端加载工作台时同步拿到 skill 状态。
- 前端顶部状态增加 `Skill ready` / `Skill key missing`，底部生成栏同步显示 skill 配置来源。
- 节点级图片、文本、脚本、视频操作增加错误反馈，失败时显示到页面错误条，避免静默失败。
- 图片节点编辑器补充窄屏响应式约束，避免编辑浮层被底部输入栏遮挡。
- smoke test 扩展为完整流程验收：
  - AI 状态接口。
  - 模型切换。
  - 比例、数量、质量、强度、时长、品牌注入参数持久化。
  - 文本、脚本、视频、视频合成、音频节点保存。
  - 文本表格生成。
  - 脚本生成。
  - 视频生成配置保存。
- 新增 `docs/Project_Audit_2026-05-20.md`，记录当前完成度、风险和下一步。
- README 清理旧的“模拟生成任务”表述，明确真实图片 skill 与降级策略。

### 验证

- `npm test` passed。
- `npm audit --audit-level=moderate` passed，0 vulnerabilities。
- 浏览器验收 `http://localhost:3000/`：
  - 页面可打开。
  - 添加节点菜单可打开，包含文本、图片、视频、视频合成、音频、脚本、上传、从图库选择。
  - 图片节点编辑器可打开，模型、比例、质量、张数、强度、下载、保存控件存在。
  - 窄屏下图片编辑器可滚动。

### 当前限制

- 当前环境仍没有可用图片生成 key；此前 key 返回 `HTTP 401 Invalid API key`。因此本轮不能声明真实出图成功，只能确认真实 skill 调用入口、配置状态、降级链路和工作流完整性。

## 2026-05-20 Completeness Continuation

### 本轮修复

- 后端新增 `GET /ai/diagnostics`：
  - 检查本地 `scripts/generate_image.py` 是否存在。
  - 运行 `python3 scripts/generate_image.py --help`，确认本地 skill CLI 可用。
  - 返回是否具备真实出图尝试条件。
  - 不返回任何密钥值。
- 前端顶部新增 `检查` 按钮，可主动触发 Skill 自检。
- 底部 `Add` 死按钮改为 `New`，点击后按当前提示词新建项目/流程。
- 底部状态新增 `Skill runtime ok · key missing`，区分“脚本不可用”和“只缺 key”。
- smoke test 增加 `ai-diagnostics` 覆盖，确保本地 skill 脚本和 CLI 可被后端验证。

### 验证

- `npm test` passed。
- 浏览器验收：
  - 顶部 `检查` 按钮可见可点击。
  - 点击后底部状态显示 `Skill runtime ok · key missing`。
  - 底部 `New` 可点击并新建项目/流程，项目列表出现新生成中的流程。

## 2026-05-20 Full Audit Bugfix Pass

### 本轮修复

- 修复后端严重稳定性问题：Express 4 不会自动捕获 async 路由中的 Zod 异常，非法请求会导致进程退出。现在所有路由统一包裹 async 错误捕获，并通过统一错误处理中间件返回 JSON 400/500。
- 登录接口从“任意账号密码可进”改为校验演示账号 `shift / 123456`。
- 前端 API 请求失败时保留后端 `message`，错误提示不再只有 `POST /xxx failed`。
- 画布新增节点的宽高不再被 `displayNodes` 覆盖，文本/脚本/视频合成节点可以保持更接近参考站的较大卡片形态。
- 非核心节点删除按钮阻止事件冒泡，避免删除动作同时触发选中/编辑。
- 图片节点编辑器新增本地图片上传/替换入口，上传后直接写入当前节点 refs 并持久化到画布。
- 图片节点生成降级时会把原因写入节点 body，避免把内置品牌图误认为真实出图。
- 预览弹窗里尚未实现的前插/后插/替换按钮改为 disabled，避免假按钮误导用户。
- 素材管理补充可编辑字段：
  - 素材名称。
  - 素材用途。
  - 素材类型。
- 品牌管理补充关键字段：
  - 行业/市场、目标用户、品牌故事。
  - IP 名称、IP 设定。
  - Logo 文本、Logo 使用规范。
  - 场景关键词、禁用词。
- smoke test 增加 bad-login、json-validation、asset-edit 覆盖。

### 验证

- `npm test` passed。
- `npm audit --audit-level=moderate` passed，0 vulnerabilities。
- 浏览器验收：
  - 素材面板显示并可编辑素材名称/用途/类型。
  - 品牌面板显示目标用户、品牌故事、IP 名称、Logo 使用规范、禁用词等字段。
  - 图片节点编辑器显示替换、下载、保存操作。

## 2026-05-20 Image Editor Full-Flow Bugfix

### 本轮发现

- 图片编辑器在当前浏览器宽度下默认显示不完整，底部参数栏横向溢出，提交按钮容易被挤出可视范围。
- 图片节点即使可以用节点标题作为提示词，生成按钮仍会因为 `body` 为空被禁用。
- 点击生成后如果没有有效 `IMAGE_GEN_KEY`，用户只能看到内置图回写，缺少明确的真实失败原因。

### 本轮修复

- 图片编辑器改成固定上下边界，内容区内部适配，避免默认裁切底部操作区。
- 图片编辑器参数栏改为自动换行，不再依赖横向滚动才能找到提交按钮。
- 增加明确的 `生成 / 重新生成` 按钮，和原图标提交按钮同时保留。
- 生成按钮启用逻辑改为使用 `body || title`，空图片节点也可以用节点标题生成。
- 后端节点图片生成接口返回：
  - `generated: true/false`
  - `message`
- 前端收到 `generated=false` 时显示可见错误条，例如：`使用内置品牌图降级，未配置有效图片生成 Key。`

### 全流程复测结果

- `npm test` passed。
- `npm audit --audit-level=moderate` passed，0 vulnerabilities。
- 浏览器复测：
  - 打开 `http://localhost:3000/` 成功。
  - 打开图片节点编辑器，`重新生成 / 替换 / 下载 / 保存 / 1张 / hd / strength` 控件均可见。
  - 点击 `重新生成` 可触发后端接口。
  - 当前环境返回可见原因：`生成状态: 使用内置品牌图降级，未配置有效图片生成 Key。`

### 当前真实图片生成阻塞

后端 `/ai/diagnostics` 当前返回：

- `scriptExists: true`
- `helpOk: true`
- `configured: false`
- `keySource: missing`
- `canAttemptGeneration: false`

结论：本地图片生成 skill 和 Python CLI 没坏；真实出图失败原因是运行中的后端没有有效图片生成 Key。

## 2026-05-20 Brand Flow And Real Skill Integration

### 本轮修复

- 修复后端迁移逻辑：
  - 不再删除非 XMANX 品牌。
  - 不再删除非 XMANX 素材。
  - 不再把所有历史画布强制改成当前活跃品牌。
- 前端品牌管理补齐完整流程：
  - 品牌下拉切换。
  - `新建品牌`。
  - 新品牌自动激活。
  - 新建画布使用当前激活品牌。
  - 素材面板默认只显示当前品牌素材，避免跨品牌误选。
- 本地私有 `auth.json` 已写入可用的本地图片生成配置，文件已在 `.gitignore` 中，不进入代码仓库。
- 后端 `/ai/diagnostics` 已确认：
  - `configured: true`
  - `keySource: auth.json`
  - `canAttemptGeneration: true`
- 修复异步任务状态：
  - 真实图片写回完成前，frame 保持 `generating`。
  - `fillFrameOutputs` 完成并持久化后，才标记 `success`。
  - 避免页面出现“成功但输出图为空”的假完成状态。

### 真实出图验证

- 直接调用本地 skill 成功输出：
  - `/tmp/sparkcanvas-real-image-test-local.png`
- 通过后端节点生成接口成功输出：
  - `/generated/node-dVNtX_fg-input-image-mpd1dpjb.png`
- 通过完整 `/generate` 任务成功输出：
  - `/generated/xmanx-g6sgk5ks-1.png`

### 验证

- `npm test` passed。
- `npm audit --audit-level=moderate` passed，0 vulnerabilities。
- 浏览器验收：
  - 顶部显示 `Skill · gpt-5.4`。
  - 品牌面板可点击 `新建品牌`，新品牌可见并自动激活。
  - 底部 `New` 使用当前新品牌创建画布。
  - 新建画布标题区域显示 `新品牌 2 Canvas`。
