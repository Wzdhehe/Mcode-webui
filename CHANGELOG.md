# Changelog

All notable changes to this project are documented here. Versions
follow `vMAJOR.MINOR.PATCH`. The `v0.5.bx-NN` scheme was used during
the modularization period (2026-08-17 → 2026-08-20) and is preserved
in the "Earlier history" table below.

This project follows [Keep a Changelog](https://keepachangelog.com/).
The `## Unreleased` section at the top tracks changes that have
landed on the development branch but are not yet cut into a release.

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

### Verified (no code changes in this patch)

- `npm test` — 382 passing + 1 skipped (383 total)
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
- **23 个新单测** (state-bus 7 / routes 10 / acp RPC 4 / version check 3, 含 doc-vs-code audit 修复)

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
