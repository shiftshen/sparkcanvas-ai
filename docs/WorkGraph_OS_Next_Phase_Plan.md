# WorkGraph OS 下一阶段开发计划

状态基线(2026-06-25):WGOS 五项已真实化并合入 `main`(`908b9ae`、`ce6e8dc`);`npm test`(check && build && test:smoke)与全套 WGOS smoke(flow/interaction/quality/visual/layout/skill-evolution)全绿。本计划处理剩余的真实性缺口、前端闭环、工程卫生与上线。

## 全局约束(每阶段都适用)
- 不改 production `marketing.xmanx.com` 的对外行为;不硬编码任何 API key(只走 env / `auth.json`,已 gitignore)。
- 不提交 `backend/data`、生成媒体、`output/`、私有下载。
- "pi 执行完成"只有真实 pi session 返回产物才声称完成,否则明确标 `simulated`;smoke 默认零成本(`bridge:"off"` / 不触发付费)。
- 每个任务做完即跑对应验证并 commit;每阶段结束 `npm test` 必须仍绿。
- 代码风格、命名、注释密度对齐周边代码;新逻辑配 smoke 或 vitest。

## 现状门禁与运行
- 全门禁:`npm test` = `npm run check && npm run build && npm run test:smoke`(当前 exit 0)。
- WGOS 专项 UI:需 dev 栈(web `:3203`、backend `:4200`,`npm run dev`)+ playwright chromium v1223(`playwright install chromium chromium-headless-shell`)。
- 真 pi-web 在本机 `:30141`(Pi Agent Web),契约:`GET /api/models`、`POST /api/agent/new`(需 cwd)、`GET /api/agent/[id]/events`(SSE)。

---

## Phase 0 — 锁住现状 / 防回归
- **T1 统一包管理到 pnpm**:删除 `package-lock.json`,校正 `pnpm-workspace.yaml`/`workspaces`,把 `check`/`build`/`test:*` 脚本统一为 `pnpm -r` / `pnpm --filter`,消除 npm/pnpm 混用(`@types/react` 18/19 重复的根因)。验收:`pnpm install` 干净、`npm test` 仍绿。
- **T2 GitHub Actions CI**:工作流跑 `pnpm install`(缓存)→ `npm test`;独立 job 起 dev 栈跑 WGOS UI smoke 并缓存 playwright chromium v1223。验收:PR 上 CI 绿。

## Phase 1 — pi-web 真实执行打通(P0 核心,唯一仍 simulated 的路径)
- **T3 确认 pi-web 真实契约**:受控环境用最小提示真跑 `POST /api/agent/new`,确认 `session.send` 的 message type、`events` 流的终止信号、产物文件路径表示;记录到本文件「附录:pi-web 契约」。
- **T4 落地真实执行**:依确认结果修正 `packages/pi-adapter` 的 `runPiWebSession`/`collectPiWebEvents`;成功路径 `executor:"pi-web"`、状态由真实 events 驱动、产物路径回填 `result.previewUrl/artifactPaths`。默认 `auto` 真跑、失败仍诚实回退。
- **T5 产物 watcher 对齐真实 cwd**:`WGOS_OUTPUT_WATCH_DIR` 对齐 pi-web 实际产出目录,真跑产物自动回流为 Asset 并出现在 workspace materials。
- **T6 真实模式 e2e smoke(gated)**:`WGOS_PIWEB_ENABLED=on` 的端到端 smoke,仅在检测到 `:30141` 可达时运行,否则 skip(不破坏无 pi-web 的 CI)。

## Phase 2 — 前端闭环(让后端能力在 studio 可见可用)
- **T7 变体并排对比 UI**:studio 消费 `run.variants`/`variantGroupId`,渲染 side-by-side 对比与「选为主」操作。playwright 视觉 smoke 覆盖。
- **T8 版本历史 + 回滚面板**:消费 `/workgraph-os/versions/:type/:id`,展示对象版本链并支持回滚到某版本。
- **T9 真实 pi 产出预览**:Preview 区按 kind(图片/视频/PDF/文本)正确展示真实产物;视频遵循「图生 + 公网 input_reference」规则。

## Phase 3 — 后端重构 + 测试深化
- **T10 拆分 `backend/src/server.ts`(~10.7k 行)**:按域抽模块(wgos 路由、studio 路由、ai 调用、store 适配、sqlite),行为不变,`npm test` + 全 smoke 全绿。
- **T11 vitest 单测**:`pi-adapter` 桥接(probe/run/事件解析/sanitize)、`evaluateWorkGraphSkillEvolution` 全分支、sqlite writer 三态降级、run 失败→repair 分支;接入 `test:smoke` 或新 `test:unit`。

## Phase 4 — 数据层 + 生产上线
- **T12 SQLite 升为查询源**:`/objects`、`/history`、`/versions` 读路径切 SQLite,JSON 退为备份;保留导出 API 兼容、保留 `json-only` 降级。
- **T13 生产上线闸门就绪**:配齐对象存储 / 公网 `input_reference` 上传;`production-smoke` 覆盖;`aiStatus.launchReadiness` 在 env 配齐时真实显示 `Launch ready`,否则保持 blocked。
- **T14 文档 / 交接同步**:更新 `AI_HANDOFF.md`、`Acceptance_Checklist.md`、本计划附录;运行 `oc project-note` 同步 SiYuan。

---

## 里程碑
- M1(Phase 0+1):真 pi-web 执行默认可用、CI 绿、依赖统一。
- M2(Phase 2):studio 端到端可见真实产出、变体、版本。
- M3(Phase 3+4):可维护后端、单测覆盖、SQLite 查询源、营销线可上线。

## 附录:pi-web 契约(T3 填充)
- message type:_待 T3 实测确认_
- events 终止信号:_待确认_
- 产物文件路径表示:_待确认_
