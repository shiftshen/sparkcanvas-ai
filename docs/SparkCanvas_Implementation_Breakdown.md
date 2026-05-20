# SparkCanvas AI 项目分析、拆解与实现说明

## 1. 参考项目能力提炼

`marketing.xmanx.com/dashboard` 的价值集中在品牌、项目、产品和素材管理：适合企业持续维护品牌资产，但流程偏后台化，用户需要先建品牌、建项目，再进入生成流程。

`aif.sengeai.com/#/library` 的价值集中在 AI 工作流、模板库和无限画布：适合把复杂模型能力编排成节点，但普通商业用户需要理解节点、连线、参数和运行状态。

SparkCanvas 的合并策略是：保留品牌资产沉淀和无限画布，但去掉显性的复杂层级与节点连线。用户只看到一个工作台，通过一句话或模板触发生成；系统内部由 Brand Agent 和 Intent Router 完成品牌注入与工作流编排。

## 2. MVP 范围

已实现的范围：

- 演示登录：内置 `shift / 123456` 体验账号。
- 品牌管理：多品牌档案、当前品牌切换、Logo 字符、主色、强调色、市场定位、品牌语气，并支持在侧栏直接编辑保存。
- 模板库：电商主图、小红书种草、15 秒带货视频、批量换背景。
- 资产入口：上传、商品图、Logo、视频片尾等统一资产入口；生成完成后自动写入资产库。
- 无限画布：支持平移、滚轮缩放、区块化历史任务、选中检查器。
- 一句话生成：顶部魔法输入框创建新画布区块，模拟 Intent Router、Brand Agent、异步任务状态、生成结果和积分扣减。
- 历史管理：左侧历史列表可定位到对应画布区块。
- 国际化：中、英、泰三语言切换。
- 本地持久化：开发阶段使用 `backend/data/sparkcanvas.json` 保存用户、品牌、资产、画布、任务和积分。
- 生产部署：使用 `https://xmanx.com` 作为主域名，API 统一挂载到 `https://xmanx.com/api`。

暂以模拟生成替代真实模型调用，保证产品闭环先跑通。

## 3. 模块拆解

前端：

- `TopBar`：项目标题、魔法输入、积分、导出、分享、语言切换。
- `SidePanel`：资产、模板、品牌、历史四个工作面板。
- `Canvas`：无限画布平移缩放和世界坐标变换。
- `FrameCard`：一次生成任务的可视化结果区块。
- `Inspector`：展示 Brand Agent 注入步骤、工作流步骤和导出操作。

后端：

- `POST /auth/login`：演示登录。
- `GET /me`：用户与积分。
- `GET /brands`、`PATCH /brands/:id`：品牌档案与当前品牌切换。
- `POST /brands`：创建新品牌档案。
- `GET /assets`、`POST /assets`：统一资产库。
- `GET /templates`：模板库。
- `GET /canvas/frames`、`PATCH /canvas/frames/:id`：画布历史与区块位置保存。
- `POST /generate`：创建异步生成任务，模拟 Intent Router 解析、Brand Agent 注入、积分扣减和结果生成。
- `GET /tasks/:id`：查询任务状态。

## 4. 下一阶段真实产品化路线

优先级 P0：

- 将后端内存数据替换为 PostgreSQL 表：`users`、`brand_profiles`、`assets`、`canvas_frames`、`generation_tasks`。
- 接入真实鉴权和 JWT。
- 增加文件上传到 S3/OSS/MinIO。
- 将 `POST /generate` 改为异步任务：创建任务、预扣积分、SSE/WebSocket 推送状态。

优先级 P1：

- 接入 OpenAI/ComfyUI/Kling 等模型适配器。
- Brand Agent 增加视觉分析、色板提取、风格摘要和向量检索。
- 模板支持可配置字段和批量商品图处理。
- 画布区块坐标、缩放、选中状态持久化。

优先级 P2：

- 团队协作、分享链接、权限控制。
- 模板社区与积分分成。
- 多品牌工作区、账单、订阅和充值。

## 5. 设计取舍

本次实现没有直接使用 tldraw，而是先用轻量自研画布交互完成 MVP。原因是当前目标是快速验证产品闭环：品牌上下文、模板、生成任务、历史区块和极简体验。后续如果要承载大量对象、多人协作、精确选区和复杂编辑工具，可把 `Canvas` 层替换为 tldraw，业务组件和 API 可以继续复用。
