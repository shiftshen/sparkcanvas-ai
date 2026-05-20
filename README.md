# SparkCanvas AI 项目开发包

欢迎来到 SparkCanvas AI 项目！这个开发包包含了从零开始复刻和开发该项目所需的所有架构蓝图、技术方案和设计文档。

## 当前交付状态

本包已从需求文档升级为可运行的 SparkCanvas AI MVP：

- `frontend/`：React + TypeScript + Vite 前端工作台，包含登录、品牌档案、模板/资产侧栏、无限画布、魔法输入框、历史区块和导出入口。
- `backend/`：Express + TypeScript API，提供演示登录、品牌档案、模板库、画布历史、品牌注入工作流和本地图片生成 skill 调用。未配置有效密钥时会明确降级到内置品牌素材，便于离线开发和回滚。
- `docs/SparkCanvas_Implementation_Breakdown.md`：结合两个参考项目后的产品分析、范围拆解和后续真实 AI 接入路线。

### 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3100`。演示账号已内置：账号 `shift`，密码 `123456`。

本地数据会持久化到 `backend/data/sparkcanvas.json`，包括品牌、资产、任务、画布和积分。

### 图片生成配置

图片生成走本地 skill 脚本 `scripts/generate_image.py`，由后端调用，不在前端直接请求图片 API。默认图片模型为 `yijiarj · nano_banana_2`，文本默认用当前账号已验证可用的 `gpt-5.4`，视频默认用当前账号已验证能创建任务的 `grok-imagine-1.0-video-super-720p`。`veo_3_1-fast` 保留为候选模型，但当前账号通道可能不可用。底部控制栏和节点编辑器都可以切换模型和参数。

推荐使用环境变量：

```bash
export YIJIARJ_BASE_URL='https://api.yijiarj.cn/v1'
export YIJIARJ_API_KEY='sk-your-key'
export IMAGE_GEN_MODEL='nano_banana_2'
export VIDEO_GEN_MODEL='grok-imagine-1.0-video-super-720p'
export TEXT_GEN_MODEL='gpt-5.4'
npm run dev
```

也可以复制 `config/auth.example.json` 为本地私有 `auth.json` 或 `config/auth.json`。这些文件已加入 `.gitignore`，不要提交真实密钥。

登录后可通过 `GET /api/ai/status` 查看脱敏后的 skill 配置状态。接口只返回 base URL、模型、密钥来源和是否已配置，不返回密钥值。

### 生产域名

生产部署按单域名收敛：

- Web：`https://xmanx.com`
- API：`https://xmanx.com/api`

这样不需要单独维护 `api.xmanx.com` 的跨域、Cookie 和证书策略。Docker 配置位于 `config/docker-compose.yml`，Nginx 参考配置位于 `config/nginx-xmanx.com.conf`。

### 验证

```bash
npm run check
npm run build
npm run test:smoke
```

一键完整验证：

```bash
npm test
```

`npm run test:smoke` 会使用临时数据文件启动后端，不污染本地演示数据。

### 生产部署预演

```bash
docker compose -f config/docker-compose.yml build
docker compose -f config/docker-compose.yml up -d
```

服务器上将 `xmanx.com` 和 `www.xmanx.com` 的 DNS 指向部署机器后，使用 `config/nginx-xmanx.com.conf` 作为 HTTPS 反代参考。

## 目录结构说明

- `/docs/`：包含所有的核心设计文档。
  - `SparkCanvas_Product_Design.md`：产品核心理念与交互设计。
  - `SparkCanvas_Completeness_Validation.md`：功能完整性与用户体验验证报告。
  - `SparkCanvas_Architecture.md`：整体系统架构设计。
  - `SparkCanvas_Frontend.md`：前端 React/tldraw 技术方案。
  - `SparkCanvas_Backend.md`：后端 NestJS/Agent 技术方案。
  - `SparkCanvas_Database.md`：PostgreSQL 数据库表结构设计。
  - `SparkCanvas_Deployment_Plan.md`：Docker/K8s 部署方案与开发计划。
  - `AI_Workflow_Canvas_Project_Analysis.md`：前期对 aif.sengeai.com 的分析。
  - `AI_Studio_Optimization_Design.md`：前期对 marketing.xmanx.com 的分析。
- `/frontend/`：前端代码。
- `/backend/`：后端代码。
- `/config/`：部署配置预留目录。

## 如何使用此开发包

1. **对于产品经理/架构师**：请先阅读 `/docs/SparkCanvas_Product_Design.md` 和 `/docs/SparkCanvas_Completeness_Validation.md`，理解项目的核心理念（极简画布 + 智能品牌注入）。
2. **对于前端开发团队**：请重点阅读 `/docs/SparkCanvas_Frontend.md`，了解基于 `tldraw` 的无限画布实现方案。
3. **对于后端/AI 开发团队**：请重点阅读 `/docs/SparkCanvas_Backend.md` 和 `/docs/SparkCanvas_Database.md`，理解 Intent Router（意图解析）和 Brand Agent 的实现逻辑。
4. **对于运维团队**：请参考 `/docs/SparkCanvas_Deployment_Plan.md` 进行基础设施的准备。

## 核心开发原则
- **极简交互**：永远不要把系统的复杂性暴露给用户。
- **品牌优先**：确保 Brand Agent 在每一次生成任务中都能自动注入。
- **模块化**：前后端完全分离，底层 AI 模型必须通过统一的接口调用，以便随时替换。
