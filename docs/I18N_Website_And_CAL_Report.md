# SparkCanvas International Website And CAL Guide Report

Date: 2026-05-20

## Delivered

- Added a public website route: `/?site=1`
- Added language switcher with Chinese, English, and Thai.
- Added generated website assets:
  - `frontend/public/site-assets/sparkcanvas-logo-skill.png`
  - `frontend/public/site-assets/sparkcanvas-hero-skill.png`
- Added a homepage explaining the product position:
  - AI design like writing code.
  - WYSIWYG canvas workflow.
  - Brand resources as prompt variables.
  - Real image references through the image skill.
- Added in-app localized guide content in the tutorial drawer.
- Added CAL language documentation:
  - `docs/CAL_Language_Guide.md`

## CAL Coverage

The website and guide explain:

- `@` agents, including `@imgen`
- `$` real brand resource references
- `/` commands
- `%` style tags
- locked visible text in quotes
- `:` parameters
- `->` output targets
- current-brand short references
- cross-brand references such as `$xmanx.logo`
- compatibility aliases such as `@logo`, `@IP`, `#slogan`, and `#slogen`

## Browser QA

Verified in the local browser:

- `/?site=1` loads the public homepage even when the user is logged in.
- Chinese homepage renders: `像写代码一样用 AI 设计品牌内容`.
- English homepage renders: `Design with AI like writing code`.
- Thai homepage renders: `ออกแบบด้วย AI`.
- Workspace language state carries into the left navigation and tutorial drawer.
- Thai tutorial displays CAL content and examples with `@imgen` and `$logo`.

## Evidence

- `docs/i18n-homepage-zh.png`
- `docs/i18n-homepage-en.png`
