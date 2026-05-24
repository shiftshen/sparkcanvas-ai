# SparkCanvas AI Handoff

This document is for the next AI agent or developer taking over SparkCanvas. It records the product target, reference products, API integration rules, model constraints, test commands, and current known risks.

Important security rule: do not commit real API keys, tokens, `auth.json`, `.env`, or `backend/data`. Use `config/auth.example.json` as the public template and keep real credentials local.

## Latest Handoff Update - 2026-05-21

Latest committed direction: harden CAL canvas UX, unbranded workflows, and handoff readiness.

What changed in the latest round:

- New projects and the bottom `New` action now start as unbranded empty canvases by default.
- `brandId: null` is now a strict state:
  - Unqualified `$logo` / `$ip` do not silently fall back to the active brand.
  - Explicit cross-brand references like `$xmanx.logo` and `$dapot.ip` still resolve.
  - Text optimization no longer injects active-brand context into unbranded prompts such as `马`.
- Preview modal `前插 / 后插` actions are real insert operations for image/video preview outputs.
- Canvas/reference nodes now show clearer asset titles instead of only generic reference counts.
- Project panel, asset panel, canvas status, bottom composer, workflow presets, and CAL suggestion labels have broader `zh/en/th` localization coverage.
- Smoke tests were extended for unbranded canvas behavior, explicit cross-brand references, localization-sensitive CAL items, and preview insertion behavior.

Latest validation command run before handoff:

```bash
PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH" npm test
```

Actual result from the latest local run: frontend typecheck, backend typecheck, backend build, frontend build, `scripts/smoke-test.mjs`, and `scripts/production-smoke.mjs` passed.

Do not commit local Project Evolution scaffolding unless explicitly requested:

- `AGENTS.md`
- `PROJECT_VISION.md`
- `PRODUCT_MAP.md`
- `FEATURE_MATRIX.md`
- `EVOLUTION_PLAN.md`
- `PROJECT_HEALTH.md`
- `BUG_QUEUE.md`
- `TEST_PLAN.md`
- `CHANGELOG.md`
- `scripts/project-doctor.sh`

## 1. Product Target

SparkCanvas is an AI brand workflow canvas for generating commercial assets from brand context.

The product is not just a generic image/video generator. The target experience is:

- A user writes one CAL instruction like code.
- The system resolves brand variables, attached assets, output targets, styles, and commands.
- The canvas creates a visible workflow: references, prompt, storyboard/script, image/keyframe, video/PDF outputs, and compose nodes.
- `$` references must pass real images/text into generation, not just appear as prompt text.
- Final output type determines the workflow:
  - `PNG/JPG/poster`: generate final ad/marketing image.
  - `MP4`: generate storyboard/keyframe references first, then image-to-video, then compose/trim if needed.
  - `PDF`: generate layout-friendly images and compose a real PDF file.
- Empty new projects should start from an empty canvas unless the user asks for a brand/workflow.

Current local app:

- Frontend: `http://localhost:3100`
- Backend: `http://localhost:4100`
- Demo login: `shift / 123456`

## 2. Reference Products

Reference sites used for product and interaction direction:

- Liblib Canvas: `https://www.liblib.tv/canvas?projectId=d960b84f62b84f9facd9f387b9f0e01f`
  - Reference for canvas workflow, node operations, story mode, visual graph interactions, node preview, and generated asset browsing.
- RunningHub Canvas: `https://rhtv.runninghub.ai/projects/canvas/2043980169491787778`
  - Reference for node graph behavior, hover plus buttons, dynamic lines, and canvas-like editing.

Do not blindly clone UI. SparkCanvas should keep the useful canvas behaviors while adding stronger brand resource referencing and one-line workflow automation.

## 3. CAL Symbol Language

CAL is the prompt/workflow language.

Core symbols:

- `@` agent or role.
  - `@imgen`: image generation API agent. Image generation should go through the backend VDAMO image API integration.
- `$` brand resource variable.
  - `$logo`, `$ip`, `$product`, `$menu.soup`, `$xmanx.logo`, `$dapot.ip`
  - Image resources must be sent as real reference images to the image API/video workflow.
  - Text resources must be expanded into the executable prompt.
- `/` command.
  - `/生成海报`, `/生成视频`, `/write-video-script`, `/translate`
- `%` style tag.
  - `%premium`, `%TikTok`, `%Facebook广告`
- `->` output target.
  - `-> png`, `-> jpg`, `-> pdf`, `-> mp4`

Example commands for manual testing:

```text
@imgen /生成海报 使用 $logo $ip $product，为 DAPOT 生成 5.1 自助火锅促销海报 %Facebook广告 -> png
```

```text
@imgen /生成视频 使用 $logo $ip $product，为 DAPOT 生成 8 秒泰国自助火锅短视频 %TikTok -> mp4
```

```text
@imgen /生成教材 使用 $logo $ip $menu.soup，为 DAPOT 生成门店自助火锅点餐说明，包含图片和中泰双语文字 -> pdf
```

## 4. API Integration

### 4.1 Image generation

Image generation must use the backend VDAMO OpenAI-compatible image API:

```bash
curl -sS https://api.vdamo.com/v1/images/generations \
  -H "Authorization: Bearer $VDAMO_OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"Create a commercial image...","n":1,"size":"1024x1024"}'
```

Default image model:

- `gpt-image-2`
- Provider: vdamo OpenAI-compatible API
- Route: `/v1/images/generations`
- Verified with a real PNG probe before switching defaults.

Selectable production image routes:

- `gpt-image-2`
- `gpt-image-1.5`
- `gpt-image-1`

Disabled image probes retained only in diagnostics:

- `gemini-2.5-flash-image`
- `gemini-3.1-flash-image`

Known issue:

- Gemini image models are visible from VDAMO model listing, but current probes did not return usable image output or returned account exhaustion. Do not expose them in the production selector until a real image generation route is verified.

### 4.2 Video generation

Video API:

```bash
POST https://api.yijiarj.cn/v1/videos
Authorization: Bearer <YIJIARJ_API_KEY>
Content-Type: application/json
```

Correct body format:

```json
{
  "prompt": "Animate this exact first frame...",
  "model": "veo_3_1-fast",
  "input_reference": "https://public-image-url.png",
  "size": "1920x1080"
}
```

Important:

- Use `input_reference`, not `image_url`.
- Use `size`, not `aspect_ratio`.
- `input_reference` must be a public URL. Local `/generated/...` paths are not accepted by yijiarj unless `SPARKCANVAS_PUBLIC_BASE_URL` points to a public host.
- VEO URLs expire after about 6 hours. Download MP4 immediately to local or own server.
- Do not silently fall back from image-to-video to text-to-video when reference submission fails. This causes identity drift.

### 4.3 Video model constraints

| Model | Approx cost | Fixed source clip length | Reference support | Size rule |
| --- | ---: | ---: | --- | --- |
| `grok-imagine-1.0-video-super` | ¥0.38/request | 10s | `input_reference` URL | `720x1280` works for portrait |
| `grok-imagine-1.0-video-super-720p` | ¥0.58/request | 10s | `input_reference` URL | `720x1280` works for portrait |
| `veo_3_1-fast` | ¥0.437/request | 8s | text-to-video and image-to-video | image reference in ad group must use landscape `1920x1080` |
| `veo_3_1-fast-fl` | unknown | 8s assumed until verified | first/last frame only; no pure text-to-video | multiple images separated by `|` |

Current implementation:

- `videoModelClipSeconds(model)` returns `8` for `veo_3_1*`.
- It returns `10` for `grok-imagine*` / `video-super`.
- Segment planning, compose planning, output refresh, and node-level video generation all pass the selected model into segment planning.

### 4.4 Public base URL

Set in production:

```bash
SPARKCANVAS_PUBLIC_BASE_URL=https://xmanx.com
```

This is required so generated local images can be converted from:

```text
/generated/example.png
```

to:

```text
https://xmanx.com/generated/example.png
```

for video `input_reference`.

## 5. Environment Template

Use `config/auth.example.json` as the public template.

Local private file options:

- `auth.json`
- `config/auth.json`
- environment variables

Required for real generation:

```json
{
  "VDAMO_BASE_URL": "https://api.vdamo.com/v1",
  "VDAMO_OPENAI_API_KEY": "YOUR_VDAMO_OPENAI_GROUP_KEY",
  "VDAMO_GEMINI_API_KEY": "YOUR_VDAMO_GEMINI_GROUP_KEY",
  "YIJIARJ_BASE_URL": "https://api.yijiarj.cn/v1",
  "YIJIARJ_API_KEY": "YOUR_YIJIARJ_API_KEY",
  "IMAGE_GEN_BASE_URL": "https://api.vdamo.com/v1",
  "IMAGE_GEN_KEY": "YOUR_VDAMO_OPENAI_GROUP_KEY",
  "IMAGE_GEN_MODEL": "gpt-image-2",
  "TEXT_GEN_BASE_URL": "https://api.vdamo.com/v1",
  "TEXT_GEN_MODEL": "gpt-5.4-mini",
  "VIDEO_GEN_MODEL": "grok-imagine-1.0-video-super",
  "SPARKCANVAS_PUBLIC_BASE_URL": "https://xmanx.com"
}
```

Do not put real values in Git.

## 6. Verified Real Tests

Last verified chain:

1. VDAMO `/v1/chat/completions` returned `OK` for `gpt-5.4-mini` with the OpenAI group key.
2. VDAMO `/v1/chat/completions` returned `OK` for `gemini-2.5-flash` with the Gemini group key.
3. VDAMO `/v1/models` listed the requested OpenAI and Gemini model groups.
4. VDAMO `/v1/images/generations` returned valid PNG files for `gpt-image-2`, `gpt-image-1.5`, and `gpt-image-1`.
5. Gemini image probes did not produce a usable image output, so those models remain disabled in production selectors.
6. Existing yijiarj video routing remains separate and still requires public `input_reference` image URLs.

Local output paths from the verification run:

- Image reference: `frontend/public/generated/dapot-video-keyframe-imgen-test.png`
- MP4: `frontend/public/generated/dapot-veo-fast-imgen-reference-test.mp4`
- First extracted frame: `frontend/public/generated/dapot-veo-fast-imgen-reference-test-frame.jpg`

These generated files are ignored by Git and should not be required for CI.

## 7. Validation Commands

Use these before handing off:

```bash
npm run check
npm run build
npm run test:smoke
```

Production-path regression check:

```bash
npm run test:production-smoke
```

Run `npm run test:production-smoke` when:

- preparing a production handoff or release check
- changing login/auth, CORS, public reference URLs, upload/object storage, or video generation production wiring
- investigating a production-only regression

Full:

```bash
npm test
```

Smoke coverage includes:

- auth/login
- brand and asset CRUD
- DAPOT brand profile
- CAL token parsing and reference resolution
- PDF artifact creation
- video node planning
- compose-local-MP4 with ffmpeg
- model diagnostics
- fixed video clip duration checks:
  - `veo_3_1-fast = 8s`
  - `grok-imagine-1.0-video-super = 10s`

## 8. Current High-Priority Product Rules

- Generated video should be image-to-video whenever a reference image exists.
- If the target is MP4, do not create a final poster as the intermediate image. Generate storyboard/keyframe references.
- If output is PNG/JPG, generate the final marketing/ad image.
- If output is PDF, compose a real PDF with images and layout-friendly text.
- Brand assets must be editable and have visible `$` tags so users know how to reference them.
- `$brand.asset` references can cross brands. `$logo` or `$ip` uses the current project brand.
- Missing references should produce user-facing warnings, not hidden failures.
- UI should avoid hiding important generate/preview/download actions in panels that overflow.

## 9. Known Risks / Next Work

- Public upload of local reference images is still a deployment dependency. For production, use `SPARKCANVAS_PUBLIC_BASE_URL` or implement controlled upload to owned object storage.
- Character consistency depends on the quality of supplied references and whether the selected video model honors `input_reference`.
- `grok-imagine-1.0-video-super` is cheapest but may temporarily fail because the provider has no available accounts.
- `veo_3_1-fast` completed in testing but forces landscape for image-reference requests in the current ad group.
- `veo_3_1-fast-fl` first/last frame behavior should be tested with real public URLs before exposing as default.
- Long video generation needs stricter voice/audio segment planning and final compose verification.

## 10. Git / Data Rules

Commit:

- source code
- docs
- config examples
- tests

Do not commit:

- `auth.json`
- `.env`
- real keys
- `backend/data`
- generated media under `frontend/public/generated`
- private downloads or user files

Current GitHub remote:

```text
https://github.com/shiftshen/sparkcanvas-ai.git
```
