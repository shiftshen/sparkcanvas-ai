# SparkCanvas AI 系统架构设计文档

## 1. 整体架构概览

SparkCanvas AI 采用前后端分离的微服务架构，以确保系统的高可用性、可扩展性和响应速度。系统主要由四个核心层组成：前端交互层、API 网关层、核心业务逻辑层和底层 AI 服务层。

### 1.1 前端交互层 (Frontend Layer)
负责处理用户的交互逻辑，渲染无限画布，并提供多语言支持。
- **核心框架**：React 18 + TypeScript
- **状态管理**：Zustand（轻量级全局状态管理）
- **画布引擎**：tldraw（提供高性能的无限画布渲染和交互）
- **国际化**：i18next（支持中、英、泰等多语言及 RTL 布局）

### 1.2 API 网关层 (API Gateway)
负责请求的路由、鉴权、限流和日志记录。
- **框架**：Kong 或 Nginx
- **功能**：JWT 鉴权、CORS 处理、请求速率限制（Rate Limiting）

### 1.3 核心业务逻辑层 (Business Logic Layer)
处理系统的核心业务，包括用户管理、品牌资产管理、积分计费和意图解析。
- **框架**：Node.js (NestJS) 或 Go (Gin)
- **微服务模块**：
  - **User Service**：处理注册、登录、订阅状态。
  - **Brand Agent Service**：管理用户的品牌资产（Logo、颜色、模特）。
  - **Credit Service**：处理积分的扣减、充值和流水记录。
  - **Workflow Orchestrator**：负责将用户意图转化为具体的 AI 模型调用序列。

### 1.4 底层 AI 服务层 (AI Service Layer)
负责实际的图像和视频生成任务。
- **模型路由**：通过 OpenAI API 格式统一调用不同的底层模型。
- **图像生成**：Stable Diffusion (通过 ComfyUI API 调用) 或 Midjourney API。
- **视频生成**：Kling API 或 Runway API。
- **向量检索 (RAG)**：Milvus 或 Pinecone（用于品牌资产特征的快速检索）。

## 2. 数据流与交互时序

### 2.1 品牌资产初始化数据流
1. 用户上传 Logo 和品牌描述。
2. 前端将文件上传至对象存储（OSS）。
3. Brand Agent Service 接收文件 URL 和文本，调用 Vision 模型提取品牌特征（如主色调、风格）。
4. 特征数据被向量化并存储至向量数据库，同时基本信息存入关系型数据库。

### 2.2 一句话出图数据流
1. 用户在前端画布的魔法框输入：“生成一张带有我们 Logo 的夏装海报”。
2. 请求发送至 Workflow Orchestrator。
3. Orchestrator 向 Brand Agent Service 请求当前用户的品牌上下文（Logo URL、风格向量）。
4. Orchestrator 调用 LLM（如 GPT-4o）进行意图解析，生成包含品牌特征的完整 Prompt 和工作流步骤（如：抠图 -> 换背景 -> 贴 Logo）。
5. 任务下发至底层 AI Service Layer，异步执行。
6. 生成完成后，结果图片的 URL 返回前端，渲染在无限画布的当前区块中。

## 3. 技术栈选型总结

| 组件分类 | 推荐技术栈 | 选型理由 |
| :--- | :--- | :--- |
| **前端框架** | React 18 + TS | 生态丰富，适合构建复杂的交互式 Web 应用。 |
| **画布引擎** | tldraw | 专为无限画布设计，性能优异，支持自定义图形。 |
| **后端框架** | NestJS (Node.js) | 结构化好，易于维护，适合 I/O 密集型应用。 |
| **数据库** | PostgreSQL | 强大的关系型数据库，支持 JSON 字段，适合存储复杂配置。 |
| **缓存与消息队列** | Redis + RabbitMQ | Redis 用于积分高频扣减和会话缓存；RabbitMQ 用于异步 AI 任务的排队。 |
| **对象存储** | AWS S3 / 阿里云 OSS | 存储海量的用户上传资产和 AI 生成结果。 |
| **向量数据库** | Milvus | 用于存储和检索品牌资产的高维特征向量。 |
