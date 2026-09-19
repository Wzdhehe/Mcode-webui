# Changelog

All notable changes to this project are documented here. Versions
follow `vMAJOR.MINOR.PATCH`. The `v0.5.bx-NN` scheme was used during
the modularization period (2026-08-17 → 2026-08-20) and is preserved
in the "Earlier history" table below.

This project follows [Keep a Changelog](https://keepachangelog.com/).
The `## Unreleased` section at the top tracks changes that have
landed on the development branch but are not yet cut into a release.

## v1.1.1 — 2026-09-19 (内置浏览器实测修复)

在内置浏览器对 0.4.2 实测过程中发现并修复的 4+2 个缺陷。

### Fixed

- **正文流式** — thought/message chunk 更新 `cs.chat` 后 300ms 节流推送
  SSE（`throttledStreamPush`）；回调尾部的逐 chunk 全量推送改走同一节流，
  长回复不再打爆 SSE。
- **运行中自动排队** — `cs.mcodeSessionId` 提前到 `session/new` 返回即
  赋值；`runMcodeAcp` 入口提前置位 `running.active`（冷启动 5-8s 盲区内
  并发 send 不再各自开新 session / 报 "active Turn"）。
- **队列徽标台账** — 0.4.2 `queue/list` 投递后返回空、且无推送通知，
  徽标恒 0。改为服务端台账 `cs.mcodeQueue`（enqueue 记账、finalize 对账
  清零、update/delete/steer 同步），`GET /api/chat/queue` 直读台账。
- **徽标主题配色** — `.queue-badge` 原用主题未定义的 `--accent-soft`/
  `--accent-hover`（浅色 hover 黑底黑字）。改 `--accent-bg`/`--accent-text`/
  `--accent`/`--on-accent` 语义变量，浅色=墨/纸、深色=纸/墨，两主题两态
  （普通/悬停）均清晰可读（浅深 × 中英已逐一截图验证）。
- **90s 固定超时误杀长任务** — prompt 安全超时改活动感知：每个 chunk
  重置计时器，连续 90s 无输出才算挂死（`MCODE_PROMPT_IDLE_TIMEOUT_MS`
  可覆盖），8000 字长文不再中途被杀。
- **`btn-send` 标题 i18n 缺失** — 硬编码 "发送 (Enter)"，补
  `data-i18n-title="btn_send_title"`。

## v1.1.0 — 2026-09-12 (mcode 0.3/0.4 适配 + 布局收敛)

适配 mcode TUI 0.3.x–0.4.2（实测 release 0.4.2，probe 报告见
`docs/acp-probe-0.4.md`）；同时把仓库收敛成单树布局。

### Added

- **ACP 兼容层**（`acp.mjs`）— `extRequest()` 扩展方法优先走 0.3+ 的
  `mcode/session/*` 命名空间，遇 "Method not found" 自动回退 0.2.x 裸名
  （queue 五件套、steer、goal 四件套，进程级命名空间缓存）。
- **取消路径修复** — mcode 0.3+ 移除了 `session/cancel`；`cancel()`
  回退为 `session/close`（运行中 turn 以 `stopReason:"cancelled"` 结束）
  + 立即 `session/load` 重新挂载。
- **`session/request_permission` 应答器** — server→client 请求现在会被
  自动应答（默认保守 `cancelled`）并通过 `serverRequest` 事件上抛，
  mcode 不再挂起等待。
- **新路由** — `GET /api/chat/queue`（队列快照）、
  `GET /api/chat/config-options`（模型/权限模式下拉数据源）、
  `POST /api/sessions/acp-activate`、`POST /api/sessions/acp-close`
  （Session Center 的 ACP 面）。
- **前端队列面板** — R5 建好的 queue-badge/queue-list DOM 首次接上数据源：
  徽标计数、队列清单、条目级 引导/删除 操作；0.3+ 无 `queue_update`
  推送，改为变更后主动拉取（`refreshQueueList`）。
- **模型切换优先走 ACP** — model picker 优先用 session `configOptions`
  （真实时值 + 当前选中标记 + BYOK 渠道），经
  `POST /api/chat/config-option` 切换；旧 `/api/models` 流程保留为回退。
- **`mcode/session/*_update` 通知归一化** — 独立通知重发射为
  `sessionUpdate` 形状，下游 state-bus/前端零改动。

### Changed

- **load-first** — 0.4.2 的 ACP 会话是进程域的：每请求新建的 client
  必须先 `session/load` 才能操作 session（否则 goal/queue/mode/close
  全部 `Resource not found`）。所有操作 `cs.mcodeSessionId` 的路由
  都在 start 后先 load。
- **参数形状** — `set_mode` 用 `modeId`（0.2.4 的 `mode` 保留为回退）；
  `set_config_option` 用 `{configId, value}`（`{key, value}` 保留为回退）；
  `resume`/`fork` 补 `cwd`；usage 从 `usage_update` 通知累计（prompt
  response 不再带 usage）。
- **仓库布局收敛** — 删除 `plugins/Wzdhehe/mcode-webui/` 手工镜像，
  repo root 即插件源；`package:plugin` 从 root 按 EXCLUDE 清单产出
  dist，`validate:plugin` 校验 dist 产物，`verify.mjs` 顺序改为
  package → validate → test → lint。
- **round 1–8 审计修复并入主树** — modacker 在官方 PR 线做的 round
  5–8（better-sqlite3 resolver、Token Plan 套餐用量、CORS per-origin
  allowlist、跨域 bootstrap-token 泄露修复、`csrf-token-disclosure`
  等测试）从镜像移植到根目录代码。

### Fixed

- model picker 回调里对导入绑定 `state` 赋值（ESM 只读绑定会抛
  TypeError）→ 改用 `setState()`。
- `lib-db-resolver.test.js` 的 POSIX 路径断言在 Windows 上必红
  （上游 CI 仅 ubuntu）→ 改为平台无关的路径段比较。
- `server-startup.test.js` 恢复 R6 的 `TEST_PORT=8090`（避免与开发
  server 抢 8080）。

### 验证

- 单测 478 个：477 pass / 0 fail / 1 skipped；lint 0 warning；
  `npm run verify` 全绿（package → validate → test → lint）。
- Live smoke（`acp-probe/smoke-webui-042.mjs`，真实 mcode 0.4.2）：
  11/11 — send/prompt、goal 生命周期、queue enqueue/list、
  config-options、set_mode、acp-close。

## Unreleased

> Documentation patch layered on top of v1.0.0 — no behavior
> changes, no version bump. The plugin schema (`plugin.json`),
> runtime, and API surface are byte-identical to v1.0.0.

### Added

- **`README.zh-CN.md`** — full Chinese translation of `README.md`,
  with a "命名说明" section explaining why the product is called
  "Mcode CLI 的 webui" (mcode is the upstream CLI; webui is the
  browser layer for it — the direction is CLI → webui, not the
  other way around).
- **`CONTRIBUTING.md`** at the repo root — contribution workflow,
  commit message convention, PR checklist, release process,
  sync rule for the dual-layout repo, style guide, FAQ.
- **`CONTRIBUTING.md`** in the plugin tree — a short pointer doc
  for plugin-tree-only readers, linking back to the source repo.

### Changed

- **`SKILL.md` moved** from `plugins/Wzdhehe/mcode-webui/SKILL.md`
  to `plugins/Wzdhehe/mcode-webui/skills/mcode-webui/SKILL.md` to
  match the official Agent Plugins 1.0 `skills/` layout (the local
  `validate-plugin` mirror flagged this; the official registry
  gate is the same check).
- **`PR_DESCRIPTION.md`** — placeholder phrasing ("fill in the
  blanks", "Template for the upstream PR") replaced with direct
  language ("Submission body — use verbatim"). Repository link
  corrected from the non-existent `hetaoBackend/MiniMax-Code-Plugins`
  to the official `MiniMax-AI/MiniMax-Code-Plugins`.

## v1.0.3 (2026-08-26) — mcode 0.2.4 Goal 完整功能

> R6 实施: Round 6 Goal 完整功能 (chat 顶部 budget bar + 5 状态 + 倒计时 + delegation card)。
> 累计 5+ commit (3 feat + 2 chore), 20 个新单测。

### Added

- **session/goal RPC 4 个**: `goalGet` / `goalCreate` / `goalPatch` / `goalClear` (cli.js bundle 验证真实 method 名)
- **Goal 5 状态 enum** (server/lib/state-bus.js `GOAL_STATUSES`): `active | paused | blocked | complete | budget_limited`
- **4 个 server endpoint**: `POST /api/chat/goal` (create) / `PATCH` (patch) / `DELETE` (clear) / `GET` (get)
- **客户端 Goal budget bar**: chat 顶部 progress bar + 5 状态色 badge, mcode `session/goal_update` 通知时实时更新
- **Delegation card**: chat 顶部子任务快照 (mcode `session/delegation_update` 通知时刷新)
- **Ask 倒计时**: Ask modal 打开时启动 30s 倒计时, 到 0 自动调 `sendAskAnswer` 走默认选项 (mcode 0.2.4 文档没列 countdown, 客户端兜底)
- **Goal 自动结算 toast**: 收到 `status='complete'` 或 `'budget_limited'` 时弹一次 toast (sessionStorage 防重弹)

### Fixed

- **Round 5 queue() 方法名错**: 之前 v1.0.2 Round 5 误用 `session/queue` (一锅烩), 实际 mcode 0.2.4 acp 是 `session/queue/enqueue` (5 个分开 method)。本次修。

### Changed

- **server-startup.test.js**: 用 `PORT=8090` 避免跟开发 server (8080) 冲突

### Test count

- 435 pass / 0 fail / 1 skipped (R5 末: 415 → R6 末: 435, +20)
- 4 个新 test 文件: `lib-acp-goal.test.js` (8) / `routes-chat-goal.test.js` (8) / `events-ask-countdown.test.js` (6) — v1.0.3 audit 后从 4 增到 6

### Verified (no code changes in this patch)
- `npm test` — 435 passing + 1 skipped (436 total)
- `npm run lint` — 0 warnings
- `npm run validate:plugin` — 0 errors, 0 warnings
- No tracked debug residue (`git ls-files` shows zero
  `.server.*`, `acp-probe*`, `goal-plan-probe*`, `probes/`)
- No new `node_modules` / build artifacts in the working tree
- No personal data committed (no IPs, usernames, real session
  IDs in any tracked file)

## v1.0.2 (2026-08-26) — mcode 0.2.4 control surface 适配

> 适配 mcode TUI 0.2.4 (2026-08-24) 新增的 Session 控制面。
> **硬性要求**: webui v1.0.2 需要 mcode >= 0.2.4。旧 mcode 启动时直接 fail-fast + 清晰错误信息, 不做 graceful degrade (用户决策)。
>
> 上游 PR: PR #16 (Round 1-4 v1.0.1 baseline + Round 5 v1.0.2 新增, 同一 PR 追加, 不开新 PR)

### Added

- **Session control 面适配** (mcode 0.2.4 acp 真实方法名, 来自 cli.js bundle grep 验证):
  - `session/cancel` RPC 包装 + `handleStop` 优先温和取消 (替代 hard kill)
  - `session/fork` RPC + `POST /api/sessions/fork` 路由 (从指定消息分叉)
  - `session/queue` + `session/queue/update`/`delete`/`steer` RPC + queue badge UI (LLM 响应中可排队/改写/删除)
  - `session/steer` RPC + 顶栏 Steer 按钮 (引导当前 turn 不打断)
  - `session/resume` RPC + `POST /api/sessions/resume` 路由 (Ctrl+U 接续, Round 7)
  - `session/set_mode` + `session/set_config_option` RPC + 恢复 `btn-mode` 和 `btn-model` 隐藏的按钮
- **Goal 字段 (Round 6 基础)**: 5 状态枚举 (`active`/`paused`/`blocked`/`complete`/`budget_limited`), `cs.goalBudget = { used, total, status }`
- **Delegation 字段 (Round 6 基础)**: `cs.activeDelegations` 数组
- **6 个新 cs 字段** + **6 个 broadcast 函数** + **4 个新 sessionUpdate 事件** (queue_update / goal_update / delegation_update / current_session_update)
- **`docs/PROGRESS.md`** (用户决策新增) — 跟踪 Round 5/6/7/8 进度 + 未来计划
- **23 个新单测** (state-bus 7 / routes 9 / acp RPC 4 / version check 3, 含 doc-vs-code audit 修复)

### Changed

- **`handleStop`**: 旧实现永远 hard kill (`child.kill()`), mcode 0.1.5 acp 不支持 `session/cancel` (probe 实测 "Method not found")。新实现 mcode 0.2.4 真正支持温和取消 — 优先走 `session/cancel` RPC, 失败才 hard kill。后续 prompt 仍能用同 session 发。
- **`btn-mode` 和 `btn-model`**: 之前 v0.5.by 注释说"等 mcode 0.1.5+ 加 set_config_option 后可恢复", 现在 mcode 0.2.4 真的支持了, 取消 hidden 并接通。
- **server.js 启动时**加 mcode 版本检查, 旧 mcode 直接退出 + 双语错误信息。
- **mcode-acp.js** 透传 4 个新事件 kind, 不再只走老 `goal_update` legacy shape。

## v1.0.1 (2026-08-25) — LAN access security controls

> Scope: address PR #16 reviewer feedback that `SECURITY-NOTES.md §2`
> documents `?token=` / `Authorization: Bearer` but the code had no
> real auth gate. v1.0.1 implements the actual auth + adds a
> secondary card under the LAN chip to manage it, plus a few related
> hardening fixes. **No breaking changes to existing endpoints**
> (loopback behaviour, LAN toggle, and existing routes are
> preserved byte-identically).
>
> **Token auth itself is the headline change** — see the three
> dedicated sub-sections below. The other v1.0.1 features (read-only
> mode, sub-card UI, top-bar chip, bilingual reject page) are listed
> under "Other additions" for completeness.

### Token auth: default-on

- On first start with no `TOKEN` env set, the server now
  **auto-generates a 32-hex-char token** (`crypto.randomBytes(16)
  .toString('hex')`), persists it to
  `~/.mcode-webui/settings.json` (mode `0600` on Unix; best-effort
  on Windows), and **prints it to stdout exactly once** (never to
  `.server.log` — the operator is expected to copy it from the
  console or the settings file before it scrolls off).
- The settings card in the bottom-left sub-card shows the token
  in cleartext on first open, with "我已保存 / I have saved it"
  next to it. Until that button is clicked, `GET /api/settings`
  and the SSE state push keep including the `currentToken` field.
- The `TOKEN` env var (when set) still wins over the auto-generated
  token — the env path is unchanged, this is purely additive.
- `MCODE_WEBUI_SETTINGS_PATH` env var overrides the settings file
  location (test / non-default-install use cases).

### Token auth: reset + live broadcast

- The settings card has a "重置 token / Reset token" button. Click
  it → confirm → server generates a new 32-hex token, persists
  it, **broadcasts an `auth.token_rotated` SSE event** with the
  new value to every connected client, and resets
  `tokenAcknowledged` back to `false` so the new token is shown
  in the settings card.
- Each client that receives `auth.token_rotated` updates its
  `localStorage` (`webui_token` key) and the live `HEADERS.
  Authorization` object **in place** — subsequent `fetch()` calls
  use the new token automatically. No reload required.
- Clients that were offline when rotation happened will get
  `401` on their next request, at which point they need to be
  re-sent the new URL (with `?token=`) manually.
- `rotateToken` is **crash-safe**: persists to disk first, then
  commits the in-memory token. If disk write fails, in-memory
  state is rolled back and the API returns `500`.

### Token auth: acknowledged state machine

- After clicking "我已保存 / I have saved it" in the settings
  card, the server records `tokenAcknowledged=true` and
  **stops including `currentToken` in subsequent
  `GET /api/settings` responses and SSE state pushes**.
- The UI replaces the value/mask row with a `✓ 已保存 — 查看请点
  "重置" / Saved — click "Reset" to view again` placeholder.
  The "show / copy" buttons disappear (nothing to show / copy).
- To view the token again, the operator must hit "Reset token"
  (which produces a new value and a new broadcast). The
  acknowledged flag prevents accidental token disclosure in
  /api/settings responses if a stale client or external monitor
  is scraping the endpoint.
- The state is persisted to `~/.mcode-webui/settings.json`
  alongside the token itself, so the acknowledged flag survives
  server restarts.

### Other additions

- **Read-only mode** — sub-card toggle. When on, non-local
  `POST` / `DELETE` to `/api/*` return `403 {"error": "read-only
  mode"}`. `GET` / `HEAD` / `OPTIONS` are exempt. Local requests
  always exempt. `/api/settings` exempt (escape hatch). Persisted.
- **Top-bar read-only chip** — when read-only is on, a red
  pulsing "只读 / READ ONLY" chip appears in the top bar. Visible
  to all clients (loopback and remote), including on mobile
  (`max-width: 600px` keeps it visible when the rest of the
  top-bar status group is hidden).
- **Sub-card under the LAN chip** — a secondary floating card
  (not inline; positions itself to the right of the sidebar, full-
  width on mobile) that consolidates the LAN broadcast toggle,
  read-only toggle, token auth toggle, token view/copy/reset/
  acknowledge, and the `lanUrlWithToken` shareable URL.
- **Bilingual single-page LAN reject** — the 403 HTML now shows
  both Chinese and English stacked (not Accept-Language switching,
  per user feedback). The `127.0.0.1:PORT/` URL uses the dynamic
  `PORT` constant, not a hardcoded `7890`.
- **`lanUrlWithToken` in `GET /api/settings`** — for convenience
  the top-bar LAN chip now copies a complete shareable URL
  (`http://<lan-ip>:8080/?token=<token>`) to the clipboard when
  clicked. The top-bar text still shows just the host:port
  (token never appears in top-bar text).

### Verified

- `npm test` — 372/372 pass
- `npm run lint` — 0 warnings
- Independent verifier audit (security + feature + regression) — passed
  with 1 IMPORTANT mobile-visibility fix landed in `7c9dbe3`
- Token not logged to `.server.log` (verified via grep on audit run)

## v1.0.0 (2026-08-22) — First public release

> Scope: visual redesign, several silent-bug fixes, delete-coverage
> overhaul, and version alignment ahead of the first push.

### Fixed

- **Global toast was silently dead** — `showToast()` writes to
  `#toast`, but the element never existed in `index.html`; every toast
  in the app (LAN toggle, usage refresh, copy confirmations) was a
  no-op. Added the element + a single consolidated `.toast` rule
  (an earlier duplicate rule pair produced a stretched-box bug where
  `top: 50%` + `bottom: 96px` with no height made one-line toasts
  render screen-tall).
- **GitHub link covered by LAN popover** — the LAN URL hover popover
  positioned itself directly below the LAN card, on top of the GitHub
  link. The popover was removed entirely (the topbar LAN chip already
  shows + copies the access URL); LAN card now only toggles.
- **Session delete left ~19k-row orphans per active session** — the
  cross-delete covered 9 of 33 session-keyed tables in the Mcode
  schema, missing `local_runtime_message_rows` (message bodies),
  `local_runtime_token_usage`, `local_runtime_pi_history_rows`, and
  more. Table list extended to 32 (all `local_runtime_*` tables with a
  `session_id` column; `questionnaire_requests` skipped — ownership
  unclear). Verified by E2E: real-delete against a 713 MB copy of the
  production db reduced an 11,176-row session to 7 rows (the skipped
  table only).

### Changed

- **Theme: "Ink & Brass" → "Ink & Paper"** — full monochrome
  black/white palette; accent is near-white (dark) / near-black
  (light); new `--on-accent` token keeps text readable on accent
  backgrounds; success/warning desaturated to grays, danger kept as
  muted red. LAN wifi icon keeps a functional green (`--status-on`)
  when broadcast is on.
- **LAN toggle toast copy** (zh/en): "局域网已开启 — 局域网内其他设备
  可访问" / "LAN access on — other devices on this network can access"
  (and the off variants).
- **Version → v1.0** everywhere: topbar `v1.0`, manifests `1.0.0`.

### Added

- `MCODE_RUNTIME_DB` env override — lets tests run the real-delete
  path against a copy of the Mcode runtime db instead of the live one.
- Historical port note: default port is 8080 (was 7890 before v0.5).

## v0.5.bx (2026-08-20) — Documentation rewrite

> Scope: technical-tone rewrite of the entire documentation set, plus
> `SKILL.md` for plugin packaging.

### Added

- `README.md` — complete rewrite. Project overview, capability
  summary, quickstart, env reference, doc map, repository layout,
  why two mcode transports, known limitations.
- `docs/ARCHITECTURE.md` — complete rewrite. High-level topology
  diagram, request lifecycle trace, module contracts table, full
  `clientState.state` payload schema, SSE event schema, frontend
  topology, failure modes, instructions for adding new endpoints.
- `docs/CAPABILITIES.md` — **new file**. Full capability matrix:
  what works, what's partial, what's blocked, what mcode would
  need to add to unblock each ❌ row. Organized by feature area
  (chat, plan, permissions, ask-user, slash, workspace, sessions,
  usage, attachments, UI, network, ops).
- `docs/API.md` — **new file**. Every HTTP endpoint documented:
  method, path, request body schema, response schema, error cases,
  auth requirements, gating rules. Includes the static file
  endpoint table and the LAN-rejection exemption note.
- `docs/DEVELOPMENT.md` — **new file**. Dev setup, repo hygiene,
  recipes for adding routes / events / UI panels / slash commands
  (webui-side and mcode-translated), testing without mcode, common
  tasks (cache-bust, port change, debug subprocess), style guide,
  code review checklist.
- `docs/TROUBLESHOOTING.md` — **new file**. ~15 common failures
  with symptom → cause → fix triples, organized by observable
  symptom. Covers the 6 most common issues from the 2026-08 user
  feedback batch.
- `SKILL.md` — **new file**. mavis/minimax plugin-format description
  at the repo root. Frontmatter metadata + body covering when to
  use, how to start, capabilities matrix, architecture, plugin
  integration, known issues, doc map.
- `.minimax-plugin/plugin.json` — **new file**. Plugin manifest
  with schemaVersion 1, all 7 configurable env knobs documented,
  full endpoint table, capability tags, doc references.
- `CHANGELOG.md` — this file.

### Changed

- `README.md` — rewrote from 130 lines (architecture dump with
  partial code references) to 230 lines (overview + quickstart +
  capability matrix + doc map + repo layout).

### Notes

- `docs/acp-goal-plan-status.md` kept as-is (archaeology only).
- The plugin at `~\.minimax\plugins\Mcode-webui\`
  (the mavis-level install) was not updated in this pass; its
  `SKILL.md` is a different artifact (mavis skill format, with
  the install steps for the Mcode.ps1 shim injection).
- No code changes in this version — server, routes, libs, public/
  are all byte-identical to the previous `70e3555` commit. This
  is a docs-only release.

## Earlier history (pre-documentation-rewrite)

| Date | Commit | Summary |
|---|---|---|
| 2026-08-20 | `651aafc` | i18n: session delete 二次确认 + send/stop tooltip + workspace unset 补漏 |
| 2026-08-20 | `70e3555` | fix: 删 main.js 残留的 3 个被删 button 引用 (workspace-picker-confirm/tui/reset) |
| 2026-08-20 | `fa30285` | fix: 修 renderTreeNodes for 循环被吃 + browseToggle 提前出 scope 的 bug |
| 2026-08-20 | `c40c743` | debug log 面板 (visible) + render() 包 try/catch |
| 2026-08-20 | `ab54b78` | v0.5.bx UI 反馈 6 处修复 (tpsEl null / 删 3 按钮 / i18n / 版本 / cache-bust) |
| 2026-08-20 | `3a43f17` | v0.5.by: mcode acp 协议层封装 + 能力探测 + 降级路径 |
| 2026-08-20 | `b06bcea` | docs: remove backup HTMLs, add ARCHITECTURE.md, update README |
| 2026-08-20 | `44ed608` | refactor: extract inline `<style>` to /public/styles/main.css |
| 2026-08-20 | `5a0e364` | refactor: add `?v=2` cache-bust to /app/main.js |
| 2026-08-20 | `5114218` | refactor: extract inline `<script>` to /public/app/main.js ES module |
| 2026-08-20 | `6dfe014` | refactor: encapsulate sseByCid via state-bus helpers |
| 2026-08-20 | `97c499a` | refactor: split server.js (2456 → 55 lines) into lib/ + routes/ + router.js |
| 2026-08-20 | `4a279be` | (rollback anchor) pre-modularization monolithic webui snapshot |
