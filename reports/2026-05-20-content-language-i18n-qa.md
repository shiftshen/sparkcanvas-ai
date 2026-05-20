# SparkCanvas Content Language QA

Date: 2026-05-20

## Team Review

- Product/UX: UI language and generated content language are separate controls. The bottom composer now exposes content language beside brand and output format instead of hiding it in advanced settings.
- Frontend: The composer no longer hides brand/content-language controls on narrow desktop widths. Controls wrap into a compact two-line layout.
- Backend: `contentLanguage` is persisted in frame settings and injected into image, video, text, script, audio, and workflow optimization prompts.
- QA: Smoke coverage now asserts content language persistence and verifies that workflow, text, and video generation payloads carry the selected language.

## Verification

- `npm run check`: passed
- `npm run build`: passed
- `npm run test:smoke`: passed
- `npm test`: passed
- Browser QA at `http://localhost:3100/`: passed

## Screenshot

See `reports/content-language-composer.png`.
