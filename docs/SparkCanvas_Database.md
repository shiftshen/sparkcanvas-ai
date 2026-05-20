# SparkCanvas AI 数据库设计文档

## 1. 数据库选型与架构

系统采用混合数据库架构：
- **核心关系型数据**：使用 PostgreSQL，负责存储用户、品牌、资产元数据、订单和积分流水。其对 JSONB 类型的良好支持非常适合存储灵活的工作流配置。
- **高频缓存与队列**：使用 Redis，处理会话状态、积分预扣减和异步任务队列。
- **高维特征检索**：使用 Milvus（或 Pinecone），专用于存储 Brand Agent 提取的品牌特征向量，实现 RAG 检索。

## 2. 核心表结构设计 (PostgreSQL)

### 2.1 用户表 (`users`)
存储用户的基本信息和订阅状态。

| 字段名 | 类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY | 用户唯一标识 |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | 登录邮箱 |
| `password_hash` | VARCHAR(255) | NOT NULL | 密码哈希 |
| `subscription_tier` | VARCHAR(50) | DEFAULT 'free' | 订阅等级 (free/pro/team) |
| `credit_balance` | INTEGER | DEFAULT 0 | 当前可用算力积分余额 |
| `created_at` | TIMESTAMP | DEFAULT NOW() | 注册时间 |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | 更新时间 |

### 2.2 品牌档案表 (`brand_profiles`)
存储用户的品牌核心资产信息，供 Brand Agent 全局调用。

| 字段名 | 类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY | 品牌唯一标识 |
| `user_id` | UUID | FOREIGN KEY | 关联的用户 ID |
| `name` | VARCHAR(100) | NOT NULL | 品牌名称 |
| `logo_url` | VARCHAR(500) | | 品牌 Logo 的 OSS 地址 |
| `primary_color` | VARCHAR(20) | | 品牌主色调 (HEX 格式) |
| `style_description` | TEXT | | 品牌调性的自然语言描述 |
| `vector_id` | VARCHAR(100) | | 关联向量数据库中的特征 ID |
| `is_active` | BOOLEAN | DEFAULT TRUE | 是否为当前激活状态 |
| `created_at` | TIMESTAMP | DEFAULT NOW() | 创建时间 |

### 2.3 资产与素材表 (`assets`)
统一存储用户上传的原图和系统生成的最终结果，打破传统“项目”的层级束缚。

| 字段名 | 类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY | 资产唯一标识 |
| `user_id` | UUID | FOREIGN KEY | 所属用户 ID |
| `brand_id` | UUID | FOREIGN KEY | 关联的品牌 ID (可选) |
| `type` | VARCHAR(50) | NOT NULL | 资产类型 (upload/generated_image/generated_video) |
| `url` | VARCHAR(500) | NOT NULL | 资产在 OSS 的访问地址 |
| `metadata` | JSONB | | 资产元数据 (如分辨率、生成耗时、使用的模型) |
| `prompt_used` | TEXT | | 生成该资产时使用的最终 Prompt |
| `created_at` | TIMESTAMP | DEFAULT NOW() | 创建/生成时间 |

### 2.4 画布区块表 (`canvas_frames`)
记录无限画布上的任务区块状态，实现工作流的可视化管理。

| 字段名 | 类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY | 区块唯一标识 |
| `user_id` | UUID | FOREIGN KEY | 所属用户 ID |
| `title` | VARCHAR(255) | | 区块标题 (如 "夏装大促海报") |
| `position_x` | FLOAT | NOT NULL | 在无限画布上的 X 坐标 |
| `position_y` | FLOAT | NOT NULL | 在无限画布上的 Y 坐标 |
| `width` | FLOAT | NOT NULL | 区块宽度 |
| `height` | FLOAT | NOT NULL | 区块高度 |
| `status` | VARCHAR(50) | DEFAULT 'idle' | 状态 (pending/generating/success/failed) |
| `result_asset_ids` | JSONB | | 关联的生成结果资产 ID 列表 |
| `created_at` | TIMESTAMP | DEFAULT NOW() | 创建时间 |

### 2.5 任务流水表 (`generation_tasks`)
记录后端的异步生成任务和积分消耗情况。

| 字段名 | 类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY | 任务唯一标识 |
| `user_id` | UUID | FOREIGN KEY | 发起任务的用户 ID |
| `frame_id` | UUID | FOREIGN KEY | 关联的画布区块 ID |
| `intent_prompt` | TEXT | NOT NULL | 用户的原始输入指令 |
| `resolved_workflow` | JSONB | NOT NULL | Intent Router 解析后的底层执行工作流 |
| `credits_cost` | INTEGER | NOT NULL | 本次任务消耗的积分 |
| `status` | VARCHAR(50) | DEFAULT 'queued' | 任务状态 (queued/processing/completed/failed) |
| `error_message` | TEXT | | 失败时的错误信息 |
| `created_at` | TIMESTAMP | DEFAULT NOW() | 任务创建时间 |
| `completed_at` | TIMESTAMP | | 任务完成时间 |

## 3. 索引与性能优化建议

- **用户资产查询**：在 `assets` 表的 `user_id` 和 `created_at` 字段上建立联合索引，加速用户历史素材库的加载。
- **画布渲染**：在 `canvas_frames` 表的 `user_id` 字段建立索引，确保用户登录后能秒级拉取其画布上的所有区块。
- **JSONB 查询**：对于 `metadata` 和 `resolved_workflow` 中的高频查询字段，可以使用 GIN 索引提升查询效率。
- **软删除**：对于所有表，建议增加 `deleted_at` 字段实现软删除，以防用户误操作导致数据永久丢失。
