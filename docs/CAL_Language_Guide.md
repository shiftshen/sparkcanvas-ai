# CAL 1.0 AI Canvas Language Guide

CAL is the SparkCanvas prompt language for brand-controlled AI design. It lets users write prompts like code while still working visually on the canvas.

## Core Idea

Users should not repeatedly describe a brand, logo, IP character, model, product, or slogan. They reference those assets with stable tokens.

Example:

```text
@imgen /生成海报 使用 $logo $ip $product.hero，显示 $copy.slogan，主题 %高级感 -> 海报
```

The system resolves this into:

- `@imgen`: use the local image generation skill.
- `$logo`, `$ip`, `$product.hero`: pass real image files as references.
- `$copy.slogan`: expand the brand slogan into the prompt text.
- `%高级感`: style tag.
- `-> 海报`: output target.

## Symbols

| Symbol | Meaning | Examples |
| --- | --- | --- |
| `@` | Agent / executor | `@imgen`, `@designer`, `@video_director` |
| `$` | Real brand resource or text variable | `$logo`, `$ip`, `$xmanx.logo`, `$copy.slogan` |
| `/` | Command | `/生成海报`, `/写视频脚本`, `/生成视频` |
| `%` | Style or theme tag | `%高级感`, `%TikTok`, `%premium` |
| `"` | Locked visible text | `"Grand Opening"` |
| `:` | Parameter | `尺寸: 1080x1350`, `比例: 4:5` |
| `->` | Output target | `-> 海报`, `-> 视频`, `-> 分镜表` |

## Brand Resource Rules

Current project brand can use short references:

```text
$logo
$ip
$product
$model
$scene
$copy.slogan
$copy.brand_name
```

Cross-brand references must include the brand key:

```text
$xmanx.logo
$xmanx.ip
$xmanx.product.hero
$xmanx.copy.slogan
```

Whole brand package:

```text
$xmanx
```

This pulls the brand's image references and key text constraints together.

## Compatibility

Legacy user habits are preserved:

- `@logo` maps to `$logo`
- `@IP` maps to `$ip`
- `#slogan` and `#slogen` map to `$copy.slogan`
- `#brand_name` maps to `$copy.brand_name`

The UI can still suggest old `@` / `#` patterns, but the backend normalizes them into CAL.

## Product Behavior

- Image resources are never only pasted into the prompt as text. They are passed as real reference images to the image skill.
- Text resources are expanded into the prompt and also kept as structured references.
- If a project has no brand, no brand context is injected by default.
- If a project has a brand but `brandInject:false`, brand context is not injected unless the prompt explicitly references a brand resource.
- Explicit `$xmanx.logo` or `$xmanx` always resolves cross-brand resources.

## Suggested User Prompts

```text
@imgen /生成海报 使用 $logo 和 $ip，主标题显示 $copy.brand_name，副标题显示 $copy.slogan，主题 %高级感 -> 海报
```

```text
@imgen /生成主图 使用 $product.hero，背景参考 $scene.store，比例: 1:1 -> 商品主图
```

```text
@video_director /写视频脚本 使用 $product $ip，主题 %TikTok，时长: 15s -> 分镜表
```

```text
@imgen /生成海报 使用 $xmanx.logo $xmanx.ip，显示 $xmanx.copy.slogan -> 联名海报
```

## Internationalization

The homepage and in-app guide currently support:

- Chinese
- English
- Thai

Language preference is stored in `localStorage` as `sparkcanvas.locale`.
