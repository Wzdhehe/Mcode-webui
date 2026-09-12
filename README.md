# Mcode Web UI

**[English](README.md) | [简体中文](README.zh-CN.md)**

Browser-based chat frontend for the **Mcode CLI** — run `mcode` from a
browser instead of the terminal. Speaks Mcode's own protocols directly
(`mcode acp` JSON-RPC + `mcode exec` stream-json); not a TUI wrapper.
Zero npm dependencies at runtime (Node 22+ stdlib only).

> 三栏布局(会话/对话/上下文),`/` 命令搜索,附件上传,套餐用量右向展开,
> token 鉴权局域网,移动端响应。

```
[Browser :8080] ←─ SSE /api/events ─ [Node server.js] ─ mcode acp / exec ─ [Mcode CLI]
      │                                     │
      └──── REST /api/* ────────────────────┴── ~/.minimax/v2 sqlite (read + session delete)
```

## Features

- **Three-column layout** — sessions / conversation / context panel
- **Real-time streaming** — model output, tool events (Bash / Read /
  Edit / Glob / Grep / WebFetch…), agent thought chunks
- **Slash command search** — `/` opens the palette with fuzzy search
  over live Mcode commands + webui-local commands
- **File attachments** — click / drag / Ctrl+V paste; paths injected as `@file`
- **Quota panel** — right-side expandable: 5h + weekly quota, context
  bar, cache hit rate, tok/s, per-session token stats
- **Plan review & ask-user modals** — plan mode and `AskUserQuestion`
  surface as native UI, not terminal prompts
- **Workspace switching** — directory-tree browser (Windows drives, `/`)
- **Token-authed LAN sharing** — `0.0.0.0` bind, `?token=` or
  `Authorization: Bearer`, runtime on/off toggle with friendly 403 page
- **Token auth: default-on (v1.0.1)** — on first start, the server
  auto-generates a 32-hex token, persists it to
  `~/.mcode-webui/settings.json`, and prints it to stdout once.
  The settings card shows the token until you click
  "我已保存 / I have saved it" — after that the server stops
  sending it over `/api/settings`. Set `TOKEN` env to override.
- **Token auth: reset + live broadcast (v1.0.1)** — "重置 token"
  button generates a new value, persists it, and broadcasts
  `auth.token_rotated` over SSE. All connected clients update their
  `localStorage` + `Authorization` header **in place** — no reload
  required. Offline clients get a fresh URL on their next visit.
- **Token auth: acknowledged state (v1.0.1)** — after acknowledging,
  the server stops including `currentToken` in `/api/settings`
  responses. The UI shows a "Saved" placeholder. To view the
  token again you must hit "Reset token" (which produces a new
  value). Persisted across restarts.
- **Mobile responsive** — `<900px` drawers, `<600px` single column
- **Bilingual UI** — English / 简体中文, instant toggle
- **Monochrome theme** — "Ink & Paper" dark / light, follows system
- **Two transports** — `mcode acp` (default, multi-turn) with
  `mcode exec` fallback for old clients / degraded mode
- **Session control (v1.0.2, mcode 0.2.4+)** — fork (从指定消息分叉),
  queue (LLM 响应中排队), steer (引导当前 turn), resume (接续最近),
  mode switch (plan/permission/model) — 10 个新 acp RPC + 4 个新
  sessionUpdate 通知 + 8 条新 webui 路由

## Quick start

```bash
git clone https://github.com/Wzdhehe/Mcode-webui.git
cd Mcode-webui
node server.js                 # Mcode CLI auto-detected
# → http://127.0.0.1:8080/     (LAN: http://<lan-ip>:8080/)

# Recommended on shared networks:
TOKEN=$(openssl rand -hex 16) node server.js
# → open http://127.0.0.1:8080/?token=$TOKEN
```

## Configuration

All env vars, all optional:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP listen port (default was `7890` before v0.5) |
| `HOST` | `0.0.0.0` | Bind address (override to `127.0.0.1` for loopback-only) |
| `TOKEN` | (empty) | Required token for non-local requests. **v1.0.1**: if unset, server auto-generates a 32-hex token on first start (see "Token auth" below). |
| `MCODE_WEBUI_SETTINGS_PATH` | `~/.mcode-webui/settings.json` | **v1.0.1**: override the settings file location (tests, non-default installs). |
| `MCODE_MODEL` | `minimax_api/MiniMax-M3` | Default model |
| `MCODE_CMD` | auto-detect | `mcode` / `mcode.cmd` path |
| `MCODE_WEBUI_UPLOAD_DIR` | auto | Attachment directory |
| `MCODE_RUNTIME_DB` | `~/.minimax/v2/...` | mcode runtime db (tests use copies) |

## Token auth (v1.0.1)

Token auth is the headline change in v1.0.1 — it addresses PR #16
reviewer feedback that `SECURITY-NOTES.md §2` documented
`?token=` / `Authorization: Bearer` but the code had no real auth
gate. v1.0.1 implements three pieces, each documented as a
separate concern below.

### Token auth: default-on

On first start with no `TOKEN` env set, the server **auto-generates
a 32-hex-char token** (`crypto.randomBytes(16).toString('hex')`),
persists it to `~/.mcode-webui/settings.json` (mode `0600` on Unix;
best-effort on Windows), and **prints it to stdout exactly once**
(never to `.server.log` — copy it from the terminal before it
scrolls off). The settings card in the bottom-left sub-card
shows the token on first open; until you click
"我已保存 / I have saved it", `GET /api/settings` and the SSE
state push keep including the `currentToken` field. Setting
`TOKEN` env still wins (the env path is unchanged — this is
purely additive).

### Token auth: reset + live broadcast

The settings card has a "重置 token / Reset token" button. Click
it → confirm → the server generates a new 32-hex value,
persists it, and **broadcasts an `auth.token_rotated` SSE
event** with the new token to every connected client. Each
client that receives the event updates its `localStorage`
(`webui_token` key) and the live `HEADERS.Authorization`
object **in place** — subsequent `fetch()` calls use the new
token automatically, no reload required. Offline clients
that missed the broadcast will get a `401` on their next
request, at which point they need to be re-sent the new URL
(with `?token=`) manually. `rotateToken` is **crash-safe**:
persists to disk first, then commits in-memory state; if
disk write fails, in-memory is rolled back and the API
returns `500`.

### Token auth: acknowledged state machine

After clicking "我已保存 / I have saved it" in the settings
card, the server records `tokenAcknowledged=true` and
**stops including `currentToken` in subsequent
`GET /api/settings` responses and SSE state pushes**. The
UI replaces the value/mask row with a `✓ 已保存 — 查看请点
"重置" / Saved — click "Reset" to view again` placeholder
(show / copy buttons disappear). To view the token again
you must hit "Reset token" (which produces a new value and
a new broadcast). The acknowledged flag prevents accidental
token disclosure in `/api/settings` responses if a stale
client or external monitor is scraping the endpoint. The
state is persisted alongside the token itself, so the
acknowledged flag survives server restarts.

### Token auth: round 8 — token never travels in HTTP/SSE payloads

v1.0.1 round 8 (CSRF / bootstrap-token-disclosure fix) tightened
the above: `currentToken` is now ALWAYS the empty string in every
`GET /api/settings` response and SSE state push, the
`auth.token_rotated` event carries `{rotated: true, at}` only
(no token value), and the reset response no longer echoes the new
token. The operator reads the token from server stdout or
`~/.mcode-webui/settings.json`. Cross-origin requests can no
longer bypass the token check via loopback, and CORS is per-origin
(`MCODE_WEBUI_ALLOWED_ORIGINS` allowlist) instead of `*`.

## Known limitations (mcode 0.1.5 acp)

Reported upstream 2026-08: `session/set_mode`, `session/cancel`,
`session/fork`, `session/delete`… return "Method not found". The webui
whitelists these in `mcode-rpc.js` and degrades gracefully (toast +
fallback) — no fake UI buttons. Full matrix:
[docs/CAPABILITIES.md](docs/CAPABILITIES.md).

## Documentation

| Doc | What |
|-----|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module topology, SSE schema, request lifecycle |
| [docs/CAPABILITIES.md](docs/CAPABILITIES.md) | What works / doesn't / workarounds |
| [docs/API.md](docs/API.md) | Every HTTP endpoint |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Dev setup, adding routes / commands / panels |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common errors + verified fixes |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [SECURITY-NOTES](plugins/Wzdhehe/mcode-webui/references/SECURITY-NOTES.md) | Canonical security disclosure |

## Plugin packaging

`plugins/Wzdhehe/mcode-webui/` holds the Agent Plugins 1.0 packaging
(skills layout, security notes, validator) — submitted to the
[community registry](https://github.com/MiniMax-AI/MiniMax-Code-Plugins).

```bash
npm run validate-plugin   # contract checks (mirrors the registry gate)
npm run package:plugin    # dist/Wzdhehe/mcode-webui/ + .zip
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` (382 passing + 1 skipped) and
`npm run lint` must stay green; plugin-tree copies sync from root.

## License

MIT — see [LICENSE](plugins/Wzdhehe/mcode-webui/LICENSE).

