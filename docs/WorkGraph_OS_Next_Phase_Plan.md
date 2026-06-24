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

## 附录:pi-web 契约(T3 实测,pi-web @agegr/pi-web 0.6.x, :30141)
实测于 2026-06-25,最便宜模型 `vdamo:gpt-5.4-mini`,临时 cwd,prompt `"x"`,实测 `usage.cost.total = 0`。

**启动一次 agent 轮次**:`POST /api/agent/new`
- body:`{ cwd, provider, modelId, thinkingLevel, type: "prompt", prompt: "<文本>" }`
  - `cwd` 必填且目录必须存在(否则 400 `cwd is required` / `Directory does not exist`)。
  - `type` 是**命令名**:合法命令含 `prompt`(用户提问)、`set_model`、`set_thinking_level`;非法命令返回 500 `Unsupported command: <type>`(探测非法命令零成本)。
  - handler 从 body 取出 `provider/modelId/toolNames/thinkingLevel`,其余整体作为命令体传 `session.send()`。
- 返回:`{ success: true, sessionId, data }`;`session.send()` 会 **await 整个轮次**,短轮次时 POST 同步返回(`data` 为 send 结果)。

**事件流**:`GET /api/agent/[id]/events`(SSE,`text/event-stream`)
- 实时:先发 `{type:"connected", sessionId}`,轮次进行中转发 coding-agent 事件;轮次**结束后**再连接只会收到 `connected`(非回放)。
- 因此跟踪长轮次需在 POST 前/中并发连接;短轮次直接用 POST 返回的 `data` 或读 session 记录即可。

**输出 / 产物 / 完成**:读 `GET /api/sessions/[id]`(或 session `.jsonl`,位于 `~/.pi/agent/sessions/<slug>/...jsonl`)
- 轮次记录为 message 序列:`{role:"user",content:[{type:"text",text}]}` → `{role:"assistant",content:[{type:"text"|"toolCall",...}], usage:{...,cost}, stopReason}`。
- 完成:assistant 末条 `stopReason != "toolUse"`;`info.modified` 更新。
- 产物:agent 在 `cwd` 通过 `write`/`edit` 等工具调用产生的文件(由 cwd watcher 或解析 toolCall 捕获)。

**T4 落地(已实现)**:`/workgraph-os/run` 真实优先(`WGOS_PIWEB_ENABLED` auto|on|off,per-run `bridge` 覆盖)。`runPiWebSession`:`POST /api/agent/new`(`type:"prompt"`)启动 → `collectPiWebTurn` 实时消费 `/api/agent/[id]/events` SSE 并兜底读一次 session → **仅当抓到非空 assistant 产出**才 `executor:"pi-web"`/`simulated:false`,否则诚实回退 simulated(reason 明确,如 "returned no output within Xms")。模型/cwd 由 `WGOS_PIWEB_PROVIDER/MODEL/CWD` 配置。

**实测重要发现(本机 pi-web 实例)**:轮次为**异步**(POST 立即返回,`send()` 不等完成);`/api/sessions/[id]` 在轮次进行中**始终 0 消息**(只在完成后落盘);`/api/agent/[id]/events` SSE 对所测轮次只发 `connected`、未流出 message 事件(轮次极慢/疑似挂起)。因此当前实例下真实轮次**多数会诚实回退 simulated**;真实路径在 pi-web 返回产出时才激活。已修复早期"空产出却标 pi-web done"的假阳性(现要求非空产出)。后续 pi-web 版本若稳定流式,真实路径即生效,无需改动 WGOS。
