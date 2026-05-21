# SparkCanvas Upgrade Verification - 2026-05-21

Source plan: `/Users/shift/Downloads/SparkCanvas 升级完善方案.md`

## Completed

- PDF font handling:
  - `pdfFontPath()` now prefers standard `.ttf` fonts and avoids `.ttc` defaults that can trigger `pdfkit` subset errors.
  - `registerFont` is wrapped with a safe Helvetica fallback.
- Cross-platform reference image compaction:
  - `compactReferenceImage()` no longer depends only on macOS `sips`.
  - It tries ImageMagick `magick`, then `convert`, then `sips`.
  - If all tools are unavailable, it returns the original image instead of failing the workflow.
- Production generated-file protection:
  - `/generated/*` now uses an auth middleware.
  - In production, generated files require `Authorization: Bearer <token>` or a generated signed query token.
  - Workspace responses in production append the token to generated media URLs so browser previews can still render.
- Brand lifecycle API:
  - Added `PATCH /brands/:id/archive`.
  - Added `DELETE /brands/:id`.
  - Brand deletion removes associated assets and cleans derived canvas references.
- Automated tests:
  - Smoke now covers brand archive/delete lifecycle.
  - Production smoke now covers generated-file auth.
- Follow-up hardening:
  - Text node generation accepts legacy `mode: "text"` and normalizes it to editable story text instead of returning 400.
  - Workspace export smoke verifies `brands` and `frames` are present and include the generated smoke frame.
  - Frontend demo login account/password can be overridden with `VITE_SPARKCANVAS_DEMO_ACCOUNT` and `VITE_SPARKCANVAS_DEMO_PASSWORD`.

## Verified Commands

```bash
npm run check
npm run build
npm run test:smoke
```

Result: all passed.

## Existing Coverage Reconfirmed

- PDF output is a real `.pdf` and embeds image pages.
- DAPOT brand profile and `$dapot.*` references resolve.
- CAL token boundary handling still works.
- MP4 workflow nodes, video planning, and local compose/trim smoke still pass.
- Production demo login remains disabled unless explicitly configured.
- Production CORS still rejects arbitrary origins.

## Deferred Work

- Frontend-wide async handler cleanup remains a larger refactor. Existing backend route catcher and node editor generation handlers cover the main tested flows, but a dedicated UI audit should still review every `void handle...()` call.
- Production object storage is still recommended for generated media. Query-token URLs keep previews working, but a controlled private object-storage layer would be better for real deployment.
- Long-form video voice/audio continuity still needs real provider-level validation beyond local compose smoke.
