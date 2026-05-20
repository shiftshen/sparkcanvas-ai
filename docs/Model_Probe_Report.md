# SparkCanvas Model Probe Report

Date: 2026-05-20

## Runtime

- Frontend: `http://localhost:3100`
- Backend: `http://localhost:4100`
- Image route: local `scripts/generate_image.py`
- Secrets source: local private `auth.json` or environment variables. No keys are stored in this report.

## Verified Results

| Model option | Type | Result | Evidence |
| --- | --- | --- | --- |
| `@imgen · image skill` | image | Pass | Generated `/generated/probe-imgen-skill-mpdqe6lq.png` in about 9.9s with configured `grok-imagine-image`. |
| `yijiarj · nano_banana_2` | image | Timeout | Local skill timed out after 45s for `nano_banana_2`. Keep selectable, but do not mark as verified-current. |
| `yijiarj · grok video 720p` | video | Pass | Created video task `task_mjeFBvVOZ4DkS6Sv9ak3eAyWkpOrxkeF` in about 3.0s. |
| `yijiarj · veo_3_1-fast` | video | Timeout | `/v1/videos` request timed out after 30s. Keep selectable, but do not mark as verified-current. |

## Product Rule

- `@imgen` is the default recommended image route.
- Other image/video models remain selectable for compatibility and later channel switching.
- Model failures must be visible as status messages instead of silently falling back or hanging.
- No-brand canvases must not inject XMANX context unless the prompt explicitly references `$xmanx...` or the project is bound to XMANX.

## Regression Case

Created an unbranded canvas named `无品牌马测试`, generated prompt `马` with `@imgen`, and confirmed:

- `brandId` stayed empty.
- Generated image appeared on the canvas node.
- Node body did not contain `XMANX` or `xmanx.com`.
