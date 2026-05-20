# PDF Artifact QA - 2026-05-20

## Scope

User issue: when the final output target is PDF, the canvas showed a visual preview and the download action could still behave like a PNG download. PDF delivery also needs to support composing one or more generated/reference images into a PDF artifact.

## Fix Summary

- Document outputs now keep preview images for canvas visibility, but download from `fileUrl` as a real `.pdf`.
- Backend PDF export now uses `pdfkit` and embeds canvas preview/reference images as image pages.
- PDF repair upgrades old successful document outputs when a previous PDF did not contain embedded image objects.
- Smoke test now fetches the generated PDF URL and verifies:
  - HTTP response is `application/pdf`.
  - File header is `%PDF`.
  - PDF contains `/Subtype /Image`, proving it is image-composed rather than a renamed PNG/text-only file.

## Manual UI Check

- Reloaded `http://localhost:3100/`.
- Confirmed document output nodes expose `下载PDF`.
- Image output nodes still expose `下载图片`.

## Verification Commands

```bash
npm test
```

Result: passed.

Smoke coverage includes `pdf-artifact`, `video-output-node`, `workflow-nodes`, `generate`, `task`, `canvas`, and `export`.

## Expected Behavior

- PDF nodes may still display a PNG/JPG preview on the canvas. This is intentional.
- Clicking the PDF download control downloads the generated `.pdf` artifact.
- If the workflow has visual draft/reference images, they are composed into the PDF as separate image pages.
