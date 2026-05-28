# WorkGraph OS Product Plan

Internal codename: WGOS.

Chinese name: 工作图谱操作系统.

## Goal

Build a local-first visual AI work operating system on top of the pi-web operating model.

The target user problem is that pi + skills can execute one-sentence tasks, but the browser chat surface is weak for file-heavy creative work:

- Image/file parameters are not ergonomic.
- Uploaded materials are hard to preview.
- Outputs are hard to inspect, reuse, compare, and save back as materials.
- Multi-step material, skill, model, brand, result, and composition workflows need a visible canvas.

The long-term target is not merely "canvas image/video generation". It is a visual agent work OS where files, skills, workflows, models, brand memory, outputs, and revisions are all editable nodes.

## Product Shape

WorkGraph OS is the first local WGOS app under `apps/workgraph-os`.

It should not replace the existing marketing site. It is a new local product surface that can later connect to `pi.dev` / `@agegr/pi-web` sessions.

Core surfaces:

- Material library: local image/video/audio/document registry.
- Material preview: inspect image files before sending them into a skill.
- Tokenized parameters: every material gets a stable variable such as `$xmanx.logo` or `$local.product-shot`.
- Skill workflow canvas: one sentence becomes input material nodes, skill node, composition node, and output node.
- Brand canvas: brand memory and rules are visible and selectable.
- Model canvas: image/video/text/local model options are visible and replaceable.
- Goal canvas: one sentence is represented as an editable goal node.
- Result canvas: output nodes remain visible and can become new materials.
- Job queue: records skill/composition/archive tasks and status.
- Pi bridge: future bridge to send prompt + file references into pi-web/pi agent.

## Current Implementation

Implemented in `apps/workgraph-os`:

- Vite React app on port `3200`.
- Uses existing `@sparkcanvas/ai-design-language` CAL parser.
- Uploads local files through browser file input.
- Generates object URL previews for local image/video/audio files.
- Maintains material tokens and selected material parameters.
- Provides brand memory nodes for DAPOT and XMANX.
- Provides Model Objects for cloud image, @imgen, video, and local model candidates, including provider, capability tags, route, cost/latency tier, fallback model IDs, node affinity, and routing rules.
- Provides skill templates:
  - poster generation
  - material composition
  - image-to-video planning
  - material kit archive
- Supports one-sentence skill search.
- Supports no-match skill creation from the search phrase.
- Stores skills as Skill Objects with capability type, input/output contracts, runtime target, future `SKILL.md` path, version, test plan, and evolution counters.
- Builds a visible workflow graph from CAL prompt resources, brand memory, model, skill, output, and review nodes.
- Converts the natural-language prompt into a structured Goal Object with raw input, normalized intent, goal type, output target, constraints, and success criteria.
- Persists generated canvas nodes as first-class Node Objects instead of treating the work graph as UI-only state.
- Persists the active graph as a Workflow Object with version, status, node IDs, edge IDs, selected materials, skill/model bindings, result IDs, run count, and reusability state.
- Persists run outputs as Result Objects with kind, status, version, preview URL, source job, material references, review state, and save-as-material metadata.
- Supports active node editing and natural-language modification routing.
- Persists the active workspace snapshot in local browser storage as typed WGOS objects:
  - Goal Object
  - Asset Object
  - Skill Object
  - Model Object
  - Workflow Object
  - Result Object
  - Feedback Object
  - Memory Object
- Persists the same workspace snapshot through authenticated backend APIs:
  - `GET /workgraph-os/workspace`
  - `PUT /workgraph-os/workspace`
  - filesystem JSON file controlled by `WORKGRAPH_OS_DATA_FILE`
- Reads local brand memory from the SparkCanvas brand database:
  - `GET /workgraph-os/brands`
  - Brand Objects include compiled brand context, asset roles, linked assets, source marker, rules, colors, and audience.
- Retrieves local asset memory from the SparkCanvas asset store:
  - `GET /workgraph-os/assets`
  - Asset Objects include tokenized CAL references, brand id, role, preview URL, source marker, and tags.
- Runs nodes through a backend Workflow Runner / Node Executor foundation:
  - `POST /workgraph-os/run`
  - persists Job, Result, and Memory Objects with `executor: workgraph-os-backend`
  - records a node-level `routingDecision` with selected model, capability, route, fallback list, and reason.
  - returns an updated object index and history snapshot after execution
- Derives a queryable object index from the filesystem workspace:
  - `GET /workgraph-os/objects`
  - `GET /workgraph-os/objects?type=memory`
  - `GET /workgraph-os/objects/:type/:id`
  - current index types: Goal, Asset, Brand, Skill, Model, Workflow, Node, Result, Feedback, Memory
  - Asset Objects are indexed from both the WGOS workspace materials and the SparkCanvas asset store.
  - structured Goal Objects are indexed from workspace data when available, with legacy prompt-only workspaces migrated into derived goals.
  - Skill Objects include evolution metadata and future `SKILL.md` export paths, so high-frequency workflows can become reusable Agent Skills.
  - Model Objects expose routing policy metadata so nodes can later choose models by capability, fallback, latency, cost, and local/cloud constraints.
  - Model Objects now include the backend routing catalog and last routing decision, making model strategy auditable instead of UI-only.
  - Workflow Objects are indexed from workspace data when available, with legacy workspaces migrated into derived active workflows.
  - Result Objects are indexed from workspace results when available, with legacy jobs migrated into derived results.
  - persisted canvas nodes are indexed as Node Objects and connected to workflow/assets in the SQLite export graph.
- Records object-index history snapshots on every workspace save:
  - `GET /workgraph-os/history`
  - `GET /workgraph-os/history?type=memory`
  - `GET /workgraph-os/history/:id`
  - filesystem JSON file controlled by `WORKGRAPH_OS_HISTORY_FILE`
- Exposes a SQLite-ready migration/export layer without adding a runtime SQLite dependency yet:
  - `GET /workgraph-os/sqlite/schema`
  - `GET /workgraph-os/sqlite/export`
  - tables: `wgos_workspaces`, `wgos_objects`, `wgos_edges`, `wgos_history`
  - current mode is `json-export`, so WGOS can validate table shape and graph rows before switching the write path to SQLite.
- The UI now prefers backend filesystem JSON storage and falls back to browser-local or memory-only modes when the backend is unavailable.
- The object graph panel consumes the backend index when available, so counts and recent objects are no longer UI-only state.
- The object graph panel also shows recent version history, giving WGOS a first version-management surface.
- Shows an object graph counter for Goal, Asset, Brand, Skill, Model, Workflow, Result, Feedback, and Memory objects.
- Records user feedback as linked Feedback Objects with target type/id, reuse/revise/avoid action, source result, and paired Memory Object id.
- Converts Feedback Objects into Memory Objects with sourceType/sourceId, target linkage, confidence, and reusable flags for later skill/workflow evolution.
- Backend object graph and SQLite export now connect feedback to its target and memory back to the feedback source.
- Displays task queue and simulated completion.

## pi-web Findings

`@agegr/pi-web@latest` is currently `0.6.12`.

It is not a project scaffold. Running:

```bash
npx @agegr/pi-web@latest
```

starts a prebuilt Next.js app on port `30141`.

Relevant package facts:

- CLI bin: `pi-web`
- Next app APIs include:
  - `/api/sessions`
  - `/api/agent`
  - `/api/files`
  - `/api/skills`
  - `/api/models`
- Default session directory is `~/.pi/agent/sessions`.
- `PI_CODING_AGENT_DIR` can point to another pi agent data directory.

## Next Integration Steps

1. Add a local bridge service or Next/Vite proxy that can talk to pi-web/pi agent APIs.
2. Replace the SQLite-ready JSON export layer with an actual SQLite write path for object querying, version history, and future vector indexing.
3. Convert uploaded files into real pi-readable paths and include them in prompts.
4. Add output watcher for generated files in the active working directory.
5. Replace simulated job completion with real pi session events.
6. Add side-by-side file preview for generated output variants.
7. Add visual skill editor that can save a generated skill to disk as `SKILL.md` + scripts.
8. Add automatic skill improvement: successful runs become templates; failed runs become repair tasks.
9. Add model capability probing and per-node fallback policy.
10. Add version history for material, skill, workflow, and result nodes.

## Non-goals For This Slice

- Do not change production `marketing.xmanx.com`.
- Do not hardcode API keys.
- Do not claim pi execution is complete until a real pi session receives file references and returns outputs.
