# Security Notes — Mcode Web UI Plugin

> **Canonical security disclosure for the Mcode-webui plugin.**
>
> Per mcode-plugin-guide [red-line 7 / 披露完整性](https://github.com/Fectivnfy112357/mcode-plugin-guide/blob/main/references/red-lines.md),
> this file is the **single source of truth**. The `SKILL.md`, `plugin.json`,
> `README.md`, and PR description all reference this file by link — do NOT
> duplicate the disclosure text inline (drift risk). If a disclosure changes
> here, only this file needs to be updated.
>
> Audience: anyone evaluating whether to install this plugin, plus reviewers
> of the upstream PR.

---

## TL;DR

- **Binds `0.0.0.0` by default** — reachable from any device on your LAN.
  Set `HOST=127.0.0.1` for loopback-only.
- **`?token=` query string** is supported as a Bearer-token equivalent for
  browser convenience. Browser URL bar can leak the token via history /
  referer / shoulder-surfing — prefer `Authorization: Bearer` header for
  any non-browser caller.
- **`DELETE /api/sessions/:id` deletes the corresponding mcode session from
  your real mavis sqlite (`~/.minimax/v2/sqlite/runtime-state.sqlite`)**.
  Pass `?dryRun=true` first to preview.
- **Reads `~/.minimax/v2/sqlite/runtime-state.sqlite`** (read-only) for
  real token usage. The plugin **never** writes that file.
- **Writes file uploads to `MCODE_WEBUI_UPLOAD_DIR`** (default
  `.webui-uploads/` next to the webui). No files outside that directory
  are written.
- **No telemetry, no remote endpoints.** All processing is local.

---

## 1. Network exposure

| Surface | Default | Override | Notes |
|---------|---------|----------|-------|
| HTTP bind | `0.0.0.0:8080` | `HOST` / `PORT` env | `0.0.0.0` is a deliberate default — browser/phone/LAN access is the primary use case. On a public / untrusted network, set `HOST=127.0.0.1` immediately. |
| LAN broadcast toggle | `true` (UI) | `/api/settings` POST `{lanBroadcast: false}` | Server returns 403 with a friendly page when off and request is non-local. Toggle is **runtime**; resets to default on restart. |
| Outbound network | **none** | n/a | The webui does not call any external service. The only outbound traffic is the `mcode` CLI subprocess and `mmx quota show` (local binary). |
| Inbound auth | none (loopback) / `?token=` or `Authorization: Bearer` (non-loopback) | `TOKEN` env | See §3. |

**`0.0.0.0` rationale**: A Kimi-Code-style web UI is meant to be opened in
a browser — on the host, on a phone on the same Wi-Fi, on a tablet. A
loopback-only default would force every user to reconfigure before first
use. The trade-off is documented; the override is one env var away.

**No upstream model API calls from the webui itself.** The webui is a
front-end for `mcode acp` / `mcode exec`, which handles the model call.
The webui only forwards stdin / parses stdout / renders the SSE stream.

---

## 2. Credentials & secrets

### 2.1 What the plugin reads
- `TOKEN` env (if set) — used to gate non-local requests. Not echoed back
  in any response or log line.
- `mcode acp` / `mcode exec` process output (model streaming, tool events).
  Not persisted to disk by the webui.

### 2.2 What the plugin does NOT do
- Does **not** read `~/.ssh/`, `~/.aws/`, `~/.config/gh/`, or any other
  tool's credential directory.
- Does **not** parse shell history.
- Does **not** offer an `--api-key` / `--show-token` style flag. The only
  way to configure the auth token is the `TOKEN` environment variable.

### 2.3 Token in URL query string
- Browser opens `http://<host>:8080/?token=<TOKEN>` and the webui
  auto-injects the token into every `fetch` / `EventSource` call as
  `?token=` AND as `Authorization: Bearer`.
- **Risk**: query string ends up in browser history, server access logs
  (if any proxy / dev-tools captures it), and `Referer` headers sent to
  any external resource (none, in our case, but the webui's static files
  are served same-origin so `Referer` stays on-host).
- **Mitigation**: use the in-UI `LAN access` chip to copy a URL that
  includes the token, but for programmatic callers always pass
  `Authorization: Bearer` header instead.

### 2.4 Error-message redaction
- Token is never included in JSON responses, error bodies, or SSE
  payloads. Error responses follow `{ok: false, error: "<message>"}` —
  no request URL or headers are reflected.
- See `test/lib-config.test.js` and `test/lib-lan.test.js` for coverage
  of the redaction paths.

---

## CORS / 跨源资源共享 (Cross-Origin Resource Sharing)

> **Disclosure scope:** CORS configuration is **intentional** for v2.0
> (LAN sharing — see §1 / `0.0.0.0` rationale). This section makes the
> exact header values, threat model, and operator-facing mitigations
> explicit per [OWASP CORS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#cross-origin-resource-sharing)
> and red-line 7 (披露完整性 / disclosure completeness).

### Configuration (verbatim)

The CORS headers are set on **every** response in
[`server/router.js`](server/router.js#L344-L348):

```js
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
```

This config is locked in by
[`test/router-cors.test.js`](test/router-cors.test.js#L35) — the test
"`Allow-Headers includes Authorization`" is a **reviewer-required
assertion** added per v1.0.1 PR #16 review feedback (without
`Authorization` in `Allow-Headers`, cross-origin `fetch()` calls with
`Bearer` tokens would fail the preflight and never reach the handler).

### Threat model — why this is intentional

The webui's primary use case is browser-based access from a device on
the same LAN as the server (phone, second laptop, tablet). Combined
with the §1 default `0.0.0.0` bind, that means the browser client is
**not** necessarily same-origin with the server — for example, a phone
on `http://192.168.1.10:8080` may be served by a webui that the
desktop launched on a different host. Without permissive CORS, those
cross-origin clients can't talk to the API.

The trade-off chosen for v2.0:

- **Permissive CORS** (`Allow-Origin: *` + `Authorization` in
  `Allow-Headers`) — enables browser clients on the LAN to authenticate
  via `Authorization: Bearer <token>` without any origin pinning.
- **Token gate stays mandatory** for non-loopback requests (see §2.3,
  §9.1) — so unauthenticated cross-origin requests still 401.

The alternative — an origin whitelist — was rejected for v2.0 because
it would force every LAN operator to enumerate their phone / tablet /
laptop origins before first use. That's a worse UX than the disclosure
load this section carries.

### Risk — cross-origin CSRF surface

`Allow-Origin: *` + `Allow-Headers: Authorization` creates a **real
cross-origin CSRF surface** when the token is in attacker-reachable
storage (URL query string, `localStorage`, XSS-injected state):

- Browsers do **not** block `fetch("http://server:8080/api/...", {
  headers: { Authorization: "Bearer <stolen-token>" } })` from
  `evil.com` because `Authorization` is a custom header, not a
  credential (cookie). CORS preflight succeeds (the server echoes
  `Allow-Headers: Content-Type, Authorization`); the actual request
  executes with the stolen token.
- The destructive endpoints in §3 — `DELETE /api/sessions/:id`,
  `POST /api/settings {resetToken: true}`, `POST /api/settings
  {readOnly: false}`, `POST /api/debug/inject` (when `DEBUG_INJECT=1`)
  — all accept `Authorization: Bearer` and run cross-origin without
  any further challenge.
- Combined with §2.3 (token may travel in `?token=` query string and
  end up in browser history / referer / proxy logs), an attacker who
  exfiltrates the token — via XSS into a benign page, browser
  extension, or proxy capture — can drive destructive operations from
  any web origin without the victim's browser warning them.

This is **not** a CSRF in the classical sense (no cookie / no GET-side
state), but it is the modern equivalent: cross-origin authenticated
request forgery, gated only by possession of the secret.

### Mitigations (recommended for operators)

In order of operational cost:

1. **Loopback-only bind** — set `HOST=127.0.0.1` (see §1). Eliminates
   the entire cross-origin surface because the server is unreachable
   from any other device, let alone any other origin. This is the
   default-recommended posture for desktop-only use.
2. **Disable LAN broadcast** — `POST /api/settings {lanBroadcast:
   false}` (see §3.3). Server returns 403 with a friendly page for
   non-local requests. Does not change CORS, but kills the cross-device
   attack surface that motivates permissive CORS in the first place.
3. **Tighten the read-only gate** — flip on the read-only toggle
   (§9): `POST /api/settings {readOnly: true}` makes non-local
   `POST` / `DELETE` return 403. Cross-origin reads still work, but
   the destructive endpoints become unreachable cross-origin.
4. **Rotate the token before any cross-origin exposure** — operators
   who open the server to the LAN and intend to use browser clients
   from multiple origins should rotate the token (§9.3) so any
   previously-leaked value becomes inert. The new value is broadcast
   over SSE to live clients and stored in their `localStorage`.
5. **Fork + patch `router.js`** for higher-security deployments —
   replace `Allow-Origin: *` with a strict whitelist (the file is
   ~3 lines; the change is reviewed in v1.0.1 PR #16 thread). Trade-off:
   every browser origin must be enumerated before first use.

### Cross-references

- §1 — `0.0.0.0` rationale and LAN broadcast toggle
- §2.3 — Token in URL query string (related exfiltration vector)
- §3 — Destructive endpoints (`DELETE /api/sessions/:id`,
  `POST /api/settings {resetToken: true}`, `/api/debug/*`)
- §9 — Token auth gate + `auth.token_rotated` SSE broadcast
- `test/router-cors.test.js` — locks the current configuration

---

## 3. Destructive operations

### 3.1 `DELETE /api/sessions/:id` — **cross-deletes into mavis sqlite**

When a webui session is deleted, the plugin ALSO deletes the
corresponding row from `local_runtime_sessions` (and 31 related tables)
in `~/.minimax/v2/sqlite/runtime-state.sqlite` — the **real mavis
runtime database** the user shares with their `mavis` desktop install.

**Why**: `mcode acp` `session/delete` returns "Method not found" (a known
mcode 0.1.4 protocol gap). Without a server-side cross-delete, the
mcode side would keep orphaned sessions forever. v1.0 extended the
table list from 9 to 32: the Mcode schema has 33 session-keyed tables,
and the old 9-table list left `local_runtime_message_rows` (message
bodies), `local_runtime_token_usage`, and `local_runtime_pi_history_rows`
orphaned. Only `questionnaire_requests` is deliberately skipped (not
`local_runtime_*`-prefixed, ownership unclear).

**Mitigations**:
1. **Preview first**: `DELETE /api/sessions/<id>?dryRun=true` returns
   `{ok: true, dryRun: true, log: [...], totalRows: N}` without
   modifying any file. Use this before committing.
2. **Atomicity**: the actual delete runs in a SQLite `transaction()` —
   either all 32 tables update or none do. No partial state.
3. **FK table awareness**: missing tables (older mcode schema) are
   swallowed per-table, not as a transaction-wide failure.
4. **Idempotent**: re-running DELETE on an already-deleted sid is a
   no-op (`{ok: true, log: []}`).

**Default behavior unchanged**: real delete. `?dryRun=true` is opt-in.

### 3.2 File upload

`POST /api/upload` writes to `MCODE_WEBUI_UPLOAD_DIR` (default
`.webui-uploads/` next to the webui). Files are stored with their
original names plus a uuid prefix to prevent collisions. The directory
is created on demand; no symlink resolution is performed on the target
path (so a hostile `MCODE_WEBUI_UPLOAD_DIR=/etc` is the user's problem,
not the plugin's).

There is no auth on upload other than the standard `TOKEN` gate.
Anyone who can reach the server can drop files into the upload dir.

### 3.3 LAN broadcast toggle

`POST /api/settings {lanBroadcast: false}` disables LAN access at
runtime. No persistent state. Restarting the server reverts to the
`HOST` env (default `0.0.0.0`).

### 3.4 `/api/debug/*` (testing only)

Endpoints under `/api/debug/*` are gated by `DEBUG_INJECT=1`. The
two currently implemented routes are `inject` (force a server-side event
into the SSE stream for testing) and `state` (return server-internal
state for debugging). **Never set `DEBUG_INJECT=1` in production** — it
bypasses the standard error handling.

### 3.5 mcode acp subprocess cache

`server/lib/acp-client.js` spawns a long-lived `mcode acp` child
process. If the webui process is killed without cleanup, the child
is orphaned until the Mcode runtime's own TTL kicks in (typically
30 minutes for the mavis-managed subprocess). The webui attempts
`SIGTERM` + 3s grace + `SIGKILL` on `process.on('exit')` and
`process.on('SIGINT')`, but a hard kill (`kill -9` the webui, OS
crash) leaves the child.

---

## 4. File-system access

| Path | Access | Purpose |
|------|--------|---------|
| `~/.minimax/v2/sqlite/runtime-state.sqlite` | **read-only** (sqlite3 `-readonly`) | Real token usage for the usage panel. See `server/lib/mavis-usage.js`. |
| `~/.minimax-code/webui/.webui-sessions.json` | read+write | webui-side session store. |
| `~/.minimax-code/webui/.webui-uploads/` | write | File upload target (configurable via `MCODE_WEBUI_UPLOAD_DIR`). |
| `<user-selected workspace>` | read+list | Workspace picker (`/api/workspace/browse`). Reads directory tree only, no execution. |
| `~/.minimax/runtime/cwd.json` | read | mcode TUI's last cwd (used as workspace default). Read-only — never written. |

**No writes to user data outside the configured upload directory.**

---

## 5. Process model

- Single Node process; default model HTTP server.
- One child process per active session (`mcode acp`). Persists across
  turns, killed on session switch / delete / server shutdown.
- One child process for `mcode quota` reads (short-lived, ~1s).
- No third-party subprocesses.

---

## 6. Host capability assumptions

- **Node 22.19+** (uses `node:test` module, `URL.parse`, `Blob.stream`).
- **Mcode CLI 0.1.4+** for `mcode acp` (default transport).
- **sqlite3 binary** on PATH (or one of the platform fallback paths —
  see `server/lib/config.js#detectSqlite3Bin`).
- **mavis 0.1.0+** desktop install (provides the runtime sqlite). If
  mavis is not installed, the usage panel shows "no data" instead of
  crashing.

If any of these are missing, the plugin degrades gracefully (warning
log + a disabled feature) — it does not crash.

---

## 7. Testing & reproducibility

- `npm test` runs `node --experimental-test-module-mocks --test
  test/*.test.js checks/*.check.mjs test/integration/*.test.js
  test/matrix/*.test.js` (mocked suites live outside `test/` so the
  flagless marketplace root gate never trips on the mock flag — see
  docs/CI.md "Test layout and suite routing").
- No lint gate exists: the `lint` script was removed in the
  2026-09-20 rigor fix (this tree never contained an ESLint or
  Prettier config; a declared gate that never ran green was deleted
  along with its unused devDependencies — see docs/CI.md honesty
  notes).
- All tests use **temp file fixtures** (`mkdtempSync`). No test writes
  to the user's real `~/.minimax/` or `~/.mcode-webui/` directory unless
  `MCODE_RUNTIME_DB` / `MCODE_WEBUI_SETTINGS_PATH` env is explicitly
  overridden.
- v1.0.1 round 4: `MCODE_BETTER_SQLITE3` env override added to
  `server/lib/db.js::getMcodeBetterSqlite3()`. The hard-coded path to
  mcode's bundled `better-sqlite3` only works in the canonical
  dev layout (`<mcode-root>/webui/`); the env override lets users on
  registry-installed or non-canonical layouts point at the right
  binary explicitly. Resolution priority: env override > `$MCODE_CMD`
  derived > dev layout fallback.
- Cross-platform: there is **no CI matrix**. The only CI is the
  marketplace root gate (single ubuntu / Node 22 job: `npm ci` +
  `npm run check`, which recursively runs every file under `test/`
  flagless). Cross-platform verification is a manual local recipe —
  see docs/CI.md "Local matrix".

---

## 9. v1.0.1 — LAN sub-card: read-only / token auth

v1.0.1 adds a secondary card under the `LAN access` chip in the bottom-left
panel. It centralizes the three most-relevant security / access controls:

| Control | What it does | Where the state lives |
|---|---|---|
| **LAN access** (toggle) | On/off for the 403 gate on non-local requests (unchanged from v0.5.ap) | In-memory only; resets to `true` on restart (intentional — admins shouldn't get locked out) |
| **Read-only mode** (toggle) | When on, non-local `POST` / `DELETE` to `/api/*` return 403 `{error: "read-only mode"}`. `GET`, `HEAD`, `OPTIONS` are exempt. Local requests are always exempt. `/api/settings` is exempt (escape hatch) | Persisted to `~/.mcode-webui/settings.json` |
| **Token auth** (toggle) | When on, non-local requests must carry `?token=` or `Authorization: Bearer`. When off, the gate is bypassed even if a token is set (LAN-only deployment mode) | Persisted |
| **Token value + reset** | First-run: server generates a 32-hex-char token (`crypto.randomBytes(16).toString('hex')`) and writes it to `~/.mcode-webui/settings.json`. The token is **printed to stdout exactly once at first start** (not to `.server.log`). The settings card shows the token until the operator clicks "我已保存" (acknowledge). After acknowledgment, the server stops sending the token in `GET /api/settings` responses — only already-connected clients keep it. `Reset token` generates a new value, persists, broadcasts an `auth.token_rotated` SSE event so other connected clients update their `localStorage` + `Authorization` header live, and resets `tokenAcknowledged` to `false` (the new token is shown again). | Persisted to `~/.mcode-webui/settings.json` (mode 0600, atomic write via `.tmp` + rename) |

### 9.1 Token resolution priority (per request)

1. `process.env.TOKEN` (highest — escape hatch for `docker run -e TOKEN=...` deploys)
2. In-memory `expectedToken` synced from `settings.js` after `init()` / `rotateToken()`
3. Static `TOKEN` from `config.js` (fallback for tests)

If all three are empty, the token-auth gate is **fail-open** (back-compat with
the v1.0.1 "loopback-only / trusted LAN" deployment). To force-fail-secure
on first run, set `TOKEN=<value>` in the environment.

### 9.2 Token storage

- `~/.mcode-webui/settings.json` (mode 0600 on Unix; best-effort on Windows).
- File is **excluded from the webui process's standard logs** — `console.log`
  on first start is the only place the token is printed.
- Backup-on-corruption: if the file fails JSON.parse, the server renames it
  to `settings.json.bak` and starts with defaults (logs a warning).
- Override path for tests / non-default installs:
  `MCODE_WEBUI_SETTINGS_PATH=/some/other/settings.json`.

### 9.3 Token rotation — SSE `auth.token_rotated`

When the operator hits "Reset token" in the UI:

1. `POST /api/settings {resetToken: true}` (must already be authenticated)
2. Server generates new 32-hex token, writes to disk
3. Server broadcasts `event: auth.token_rotated\ndata: <new-token>\n\n` to
   every connected SSE client (the connection is already authenticated,
   so the token in cleartext over SSE is no worse than the periodic state
   push that also includes `currentToken` for the same window).
4. Server also broadcasts a regular state push (`currentToken` will be in
   the JSON body until the operator clicks "我已保存").
5. Clients that receive the SSE event update their `localStorage` and the
   live `HEADERS.Authorization` object in place — subsequent `fetch` calls
   automatically use the new token.
6. Clients on the old token that didn't get the SSE event (offline, etc.)
   will see 401 on their next request and need to manually re-open with
   the new token URL.

### 9.4 `currentToken` in `/api/settings` responses

- Returned **only when `tokenAcknowledged === false`**.
- After the operator clicks "我已保存", the server omits the token from
  subsequent responses. This is a deliberate trade-off: clients that lost
  their `localStorage` (e.g. cleared browser data) will need to either
  trigger a rotation (operator-visible) or look up the token in
  `~/.mcode-webui/settings.json`.
- A programmatic / CI caller that needs the token should call
  `POST /api/settings {resetToken: true}` to force a rotation and then
  read the response's `currentToken`.

### 9.5 Files added / modified in v1.0.1

- **NEW** `server/lib/settings.js` (substantially rewritten) — owns
  persistent settings + token generation + interface lookup.
- **NEW** `server/lib/auth.js` — adds `setExpectedToken`,
  `setTokenAuthEnabled`. Per-request token check still happens here.
- `server/lib/lan.js` — no change in v1.0.1 (kept the existing
  `detectLanIp` / `isLocalRequest` / `LAN_IP`).
- `server/router.js` — adds read-only gate (in addition to the existing
  LAN and token gates). Interface-allowlist gate was prototyped in
  v1.0.1 but removed before release per PR #16 reviewer scope.
- `server/routes/settings.js` — accepts new fields, handles rotation.
- `server/lib/state-bus.js` — adds `broadcastTokenRotated`; SSE state
  push now includes `readOnly`, `tokenEnabled`, `currentToken` (when
  not acknowledged), `tokenAcknowledged`, `tokenRotatedAt`.
- `public/app/state.js` — `HEADERS` is now a live-mutable object;
  new `setToken()` + SSE `auth.token_rotated` handler.
- `public/app/render.js` — `renderLanCardContent(settings)` exported.
- `public/app/events.js` — `#chip-lan` click toggles the sub-card
  (was: directly toggled `lanBroadcast`); new handlers for each control
  inside the card.
- `public/index.html` — `<div id="lan-card" hidden>` markup; CSS in
  `public/styles/main.css`.
- `public/app/i18n.js` — 22 new keys (`lan_card_*`).
- **NEW** `test/lib-settings.test.js` — persistence + new setters.
- **NEW** `test/router-readonly.test.js` — read-only gate logic.
- Extended `test/lib-auth.test.js` (`setExpectedToken`,
  `setTokenAuthEnabled`), `test/routes-settings.test.js` (new fields,
  `resetToken`, `acknowledgeToken`), `test/_setup.js` (mock shape).


---

## 8. Reporting issues

Security-relevant bugs: open a private advisory on the
[mavis/plugins GitHub repo](https://github.com/Wzdhehe/Mcode-webui/security/advisories)
(once published). Non-security bugs: use the issue tracker.
