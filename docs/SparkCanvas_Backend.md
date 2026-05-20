# SparkCanvas AI 后端技术方案

## 1. 后端架构与核心模块

后端采用 Node.js 环境下的 NestJS 框架构建，利用其强大的依赖注入和模块化特性来管理复杂的业务逻辑。系统分为三个核心模块：API 服务模块、智能代理模块（Agent Module）和任务调度模块。

### 1.1 API 服务模块
负责处理前端的所有 HTTP 请求，提供 RESTful 风格的接口。
- **Auth 控制器**：处理用户的注册、登录、JWT 签发。
- **Brand 控制器**：管理用户的品牌档案，包括 Logo 上传、色值保存等。
- **Asset 控制器**：管理用户上传的原图和生成的历史资产。
- **Task 控制器**：接收前端的生成指令（一句话魔法或模板拖拽），返回任务 ID。

### 1.2 智能代理模块 (Agent Module)
这是系统的核心大脑，包含两个关键子模块：
- **Brand Agent**：负责在数据库和向量库中检索当前用户的品牌特征。
- **Intent Router (意图路由)**：接收自然语言指令，调用大语言模型（如 GPT-4o）将指令解析为具体的底层 API 调用序列。

### 1.3 任务调度模块
由于图像和视频生成是耗时操作，系统采用异步任务队列机制。
- 接收到生成任务后，将其推入 RabbitMQ 或 Redis 队列。
- 后台的 Worker 进程从队列中消费任务，实际调用底层 AI 模型的 API（如 Stable Diffusion 或 Kling）。
- 任务完成后，更新数据库中的任务状态，并通过 WebSocket 或 Server-Sent Events (SSE) 通知前端。

## 2. Brand Agent 实现机制 (核心创新)

Brand Agent 的核心作用是实现“零配置”的品牌资产注入。

### 2.1 资产初始化与向量化
当用户首次上传品牌 Logo 和产品图时，系统会执行以下流程：
1. 将图片存储至 OSS。
2. 调用视觉大模型（Vision LLM）对图片进行分析，提取关键特征（如：“主体为红色字母 M，背景透明，极简风格”）。
3. 将这些文本特征转化为向量（Embeddings），存储至 Milvus 或 Pinecone 向量数据库中，并关联当前用户的 ID。

### 2.2 RAG (检索增强生成) 注入流程
当用户在前端输入“生成一张夏装海报”时：
1. 后端拦截该请求，提取当前用户的 ID。
2. Brand Agent 根据用户 ID，从关系型数据库中获取其 Logo 的 URL。
3. 同时从向量数据库中检索其品牌风格的文本描述。
4. 将这些信息（Logo URL + 风格描述）与用户的原始指令进行拼接，形成最终的 Prompt，发送给后端的图像生成模型。

## 3. 意图解析引擎 (Intent Router)

意图解析引擎负责将用户的“一句话”转化为底层可执行的机器指令。

### 3.1 提示词工程 (Prompt Engineering)
系统内部维护了一个强大的 System Prompt，指导 LLM 如何解析用户的输入。
例如，LLM 会被要求输出一个标准化的 JSON 结构：
```json
{
  "workflow": [
    {
      "step": 1,
      "action": "remove_background",
      "input_image": "user_upload_url"
    },
    {
      "step": 2,
      "action": "generate_background",
      "prompt": "summer beach, sunny day",
      "style_reference": "brand_style_vector"
    },
    {
      "step": 3,
      "action": "composite_logo",
      "logo_url": "brand_logo_url",
      "position": "bottom_right"
    }
  ]
}
```

### 3.2 工作流编排执行
后端的 Worker 进程接收到上述 JSON 后，会按顺序依次调用底层的微服务或第三方 API（如先调用抠图 API，再调用 SD 生成背景，最后用图像处理库合成 Logo）。

## 4. 积分与计费系统

- **扣减逻辑**：在任务进入队列前，系统会预估所需的算力积分并进行预扣减。如果任务失败，积分会自动退回。
- **并发控制**：利用 Redis 的原子操作（如 `DECR`）确保在高并发下积分扣减的准确性，防止超卖。
- **事务一致性**：积分流水记录和余额更新必须在同一个数据库事务中完成。

## 5. 安全与性能优化

- **接口限流**：针对耗时的生成接口，采用令牌桶算法进行严格的限流，防止恶意刷单。
- **资源缓存**：将高频访问的品牌配置信息缓存至 Redis，减少数据库的读取压力。
- **Webhook 回调**：底层 AI 模型生成完成后，通过 Webhook 异步通知后端，避免长连接导致的资源占用。
