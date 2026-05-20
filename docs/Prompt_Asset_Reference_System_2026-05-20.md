# Prompt Asset Reference System

SparkCanvas 的提示词不是普通长文本，而是带品牌资源引用能力的项目脚本。用户可以像写代码变量一样，在画布提示词、节点提示词和批量生成任务中引用品牌图片与品牌文本。

## 核心语法

- `@` 引用图片/视觉资源，生成时进入 image references。
- `#` 引用文本/文案资源，生成前展开到 prompt，同时保留引用记录。
- 当前画布绑定品牌时可以省略品牌名。
- 跨品牌引用使用完整路径。

## 当前品牌简写

```text
@logo
@ip
@model
@product
@storefront
@environment
#brand_name
#slogan
#slogen
#domain
#style
#tone
#cta
```

`#slogen` 作为历史拼写兼容项，会自动识别为 `#slogan`。

## 跨品牌写法

```text
@xmanx.logo
@xmanx.ip
@xmanx.model.main
@xmanx.product.hero
#xmanx.brand_name
#xmanx.slogan
#xmanx.promotion
```

当前品牌内的 `@logo` 等价于 `@当前品牌.logo`。如果显式写了品牌前缀，则按品牌 key 查询对应品牌。

## 生成前解析

输入：

```text
参考 @model，画面中心写 #slogan，为 xmanx.com 黑橙色运动鞋生成首发海报。
```

后端会生成：

```json
{
  "prompt": "参考 @model，画面中心写 \"AI launch kit for xmanx.com\"，为 xmanx.com 黑橙色运动鞋生成首发海报。",
  "imageReferences": [
    {
      "key": "xmanx.model",
      "url": "/brand-assets/generated/xmanx-model.png"
    }
  ],
  "textReferences": [
    {
      "key": "xmanx.slogan",
      "value": "AI launch kit for xmanx.com"
    }
  ],
  "warnings": []
}
```

## 缺失处理

- 找不到品牌：保留原 token，并在 `warnings` 中记录。
- 找不到图片资源：不会阻断生成，提示用户补齐品牌素材槽位。
- 找不到文本资源：不会阻断生成，提示用户检查字段名。
- 当前品牌简写优先绑定当前画布品牌，避免多个品牌共用同一域名 key 时串品牌。

## 已实现范围

- 后端实现 `parsePromptAssetRefs`、`resolvePromptAssets`、`buildFinalPrompt`。
- 图片引用会合并进 `runImageGenerationSkill` 的参考图列表。
- `/public` 静态图片和前端上传产生的 `data:image/...` 图片都会被转换为本地文件，再通过 `--input-image` 传给 `scripts/generate_image.py`。
- 文本引用会展开到最终 prompt。
- 品牌管理面板提供 `@logo/@ip/@product/@model/@storefront/@environment` 六个核心图片槽位。
- 前端提示弹层统一展示 `@ 图片引用 / # 文本引用`。
- 后端提供 `POST /api/ai/resolve-references`，用于检查某段提示词会解析出哪些图片引用、文本引用和缺失提示。
- smoke 测试覆盖 `@model + #slogan` 解析、品牌注入开关、工作流保存和生成流程。
