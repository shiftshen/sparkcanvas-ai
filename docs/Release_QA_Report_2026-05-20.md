# SparkCanvas Release QA Report

Date: 2026-05-20

## Scope

Release QA was run against the local product UI and API:

- Frontend: `http://localhost:3100`
- Backend: `http://localhost:4100`
- Default image route: `@imgen · image skill`
- Domain target: `xmanx.com`

## Page-Level Checks

| Module | Result | Notes |
| --- | --- | --- |
| Entry / workspace load | Pass | Landing/workspace loads at `localhost:3100`; local session opens the canvas. |
| Left navigation | Pass | Projects, tools, assets, history, tutorial, and brand panels open and close. |
| Project module | Pass | `New` creates an empty canvas; project panel shows naming and brand selection. |
| Brand selection | Pass | Project can switch between no brand and XMANX without replacing existing nodes. |
| Empty canvas | Pass | New canvas starts with no default workflow nodes. |
| Canvas menu | Pass | Double-click blank canvas opens add-node menu. |
| Node creation | Pass | Image, text, video, compose, audio, and script nodes can be added from the canvas menu. |
| Canvas controls | Pass | Organize, minimap toggle, grid snap, zoom in/out, and fit controls respond. |
| Image node | Pass | Edit, preview, close preview, download action, model/ratio/quality/count controls render. |
| Text/script/video/audio editors | Pass | Generation result now syncs back into the open bottom editor after API returns. |
| Model diagnostics | Pass | Header `检查` action returns runtime status without exposing keys. |
| No-brand generation | Pass | No-brand canvas image/audio generation no longer injects XMANX unless explicitly referenced. |

## Bugs Found And Fixed

1. Preview modal close button had no accessible name.
   - Fixed with `title` and `aria-label`.

2. Editor submit buttons for image/text/script/video/audio were icon-only and hard to test.
   - Fixed with explicit button labels.

3. Text/script/video/audio node generation saved backend state but did not refresh the open editor draft.
   - Fixed by returning node responses from the parent handlers and syncing `draft` in the editor.

4. Text/script/video/audio generation injected project brand context even when `brandInject:false`.
   - Fixed with separate resource-brand and context-brand handling. `$xmanx...` still resolves explicitly, but implicit brand context respects the toggle.

## Automated Verification

Commands passed:

```bash
npm run check
npm run build
npm run test:smoke
```

Smoke coverage includes:

- auth gate
- login and bad login
- JSON validation
- brand and asset CRUD
- AI status and model diagnostics
- CAL reference parsing and legacy aliases
- model and parameter persistence
- editable workflow nodes
- image/text/script/video/audio generation paths
- task completion
- canvas export
- unbranded image/audio regression checks

## Real Model Status

| Model option | Status |
| --- | --- |
| `@imgen · image skill` | Verified pass; generated real image. |
| `yijiarj · grok video 720p` | Verified pass for task creation. |
| `yijiarj · nano_banana_2` | Candidate only; timed out in current channel. |
| `yijiarj · veo_3_1-fast` | Candidate only; timed out in current channel. |

## Evidence

- Screenshot: `docs/release-qa-canvas.png`
- Model probe report: `docs/Model_Probe_Report.md`
