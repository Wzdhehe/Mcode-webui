# Contributing to Mcode Web UI

Thanks for your interest in Mcode Web UI! This document covers
the day-to-day contribution workflow. For the bigger picture (plugin
packaging, release process), see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
and [`README.md`](README.md).

## Code of conduct

Be kind. We review for substance, not for style preferences. If a
change makes the webui more correct / faster / easier to use, it's
in scope.

## Development setup

Requirements:

- **Node 22.19+** (uses `node:test`, `URL.parse`, `Blob.stream`)
- **Mcode CLI 0.1.4+** on `PATH` (or `MCODE_CMD` pointing to it)
- A POSIX-like shell on Windows: PowerShell 7+ or Git Bash

Clone and run:

```bash
git clone https://github.com/Wzdhehe/Mcode-webui.git
cd Mcode-webui
npm install               # only devDeps (eslint, prettier, c8)
npm test                  # 382 unit tests + 1 skipped (383 total)
npm run lint              # eslint flat config, must be 0 warnings
npm run dev               # node server.js
# → http://127.0.0.1:8080/
```

`npm test` and `npm run lint` **must pass** before opening a PR.

## Repository layout

Since v1.1 the repo root **is** the plugin tree (the old
`plugins/Wzdhehe/mcode-webui/` mirror was retired):

```
Mcode-webui/                          # ← dev tree = plugin source
├── server/  public/  test/          # Node + frontend + tests
├── docs/  references/  skills/mcode-webui/
├── acp.mjs  server.js  package.json
├── plugin.json  LICENSE             # official plugin manifests
│
└── scripts/                         # repo-infra — excluded from packaging
    └── package-plugin.mjs           #   → dist/Wzdhehe/mcode-webui/
```

`npm run package:plugin` assembles the shippable artifact under
`dist/Wzdhehe/mcode-webui/` (repo-infra files like `scripts/`,
`node_modules/`, `coverage/`, `dist/`, logs and `docs/PROGRESS.md`
are excluded); `npm run validate:plugin` validates that artifact
against the official plugin contract.

## Editing flow

1. **Edit at the repo root** (`server/`, `public/`, `test/`) — there
   is no mirror to keep in sync anymore.
2. **Run the gate**:
   ```bash
   npm test
   npm run lint
   npm run package:plugin && npm run validate:plugin
   ```
3. **Commit** with a conventional message (see below).
4. **Push** to a feature branch and open a PR.

## Commit message format

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body — explain WHY, not what>
<footer — refs, BREAKING CHANGE, etc.>
```

Common types:

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — internal change, no behavior diff
- `test:` — test-only change
- `docs:` — documentation only
- `chore:` — build / CI / tooling

Scope is the area (`server`, `public`, `plugin`, `acp`, `test`, `docs`).

Example:

```
fix(acp): retry session/fork once on "Method not found"

mcode 0.1.5 returns "Method not found" for session/fork on the
first attempt but accepts it on retry. One retry is enough in
practice; log + continue.
```

## Pull request checklist

- [ ] `npm test` passes
- [ ] `npm run lint` is clean (0 warnings)
- [ ] `npm run package:plugin && npm run validate:plugin` is clean
      (mirrors official gate, validates the dist artifact)
- [ ] No personal data in commit content (no IPs, no usernames, no
      real session IDs)
- [ ] New env vars documented in `docs/API.md` and `plugin.json`
- [ ] New endpoints / events documented in `docs/API.md`
- [ ] `CHANGELOG.md` updated under an "Unreleased" section
- [ ] If destructive behavior changes, the security note
      `references/SECURITY-NOTES.md` is updated (and
      `plugin.json`'s `extensions.securityNotes` summary stays in sync)

## Adding a new route / event / panel

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for recipes. The
short version:

- **Route**: drop a file in `server/routes/<name>.js` exporting
  `(req, res, deps) => …`, register in `server/router.js`.
- **SSE event**: emit via `state-bus` in the route; consume in
  `public/app/render.js`.
- **UI panel**: add a `state` slice in `public/app/state.js`,
  a renderer in `public/app/render.js`, a handler in
  `public/app/events.js`, and an i18n key in `public/app/i18n.js`.

## Style guide

- **ESM only** — no CommonJS, no `require()`.
- **No runtime npm deps** — only `devDependencies`. Everything
  runtime must be Node 22+ stdlib.
- **No silent failures** — every catch either re-throws, returns
  an explicit error response, or logs a warning with a `console.warn`
  tag. No `try { … } catch {}` blocks.
- **No fake UI buttons** — if mcode acp doesn't support a method
  (see `docs/CAPABILITIES.md`), don't render a button that
  pretends to work. Use a toast + skip.
- **i18n first** — every user-visible string in the frontend goes
  through `i18n.t()`. No inline English / Chinese literals.
- **Token-aware error messages** — never echo the request URL
  or headers into error bodies (token leak risk).

## Release process

1. Bump `version` in `package.json` (root).
2. Move "Unreleased" section in `CHANGELOG.md` to a dated
   versioned section.
3. `npm run package:plugin` — produces `dist/Wzdhehe/mcode-webui/`
   + `dist/Wzdhehe/mcode-webui.zip` from the root tree.
4. Open a PR to the community registry
   [`MiniMax-AI/MiniMax-Code-Plugins`](https://github.com/MiniMax-AI/MiniMax-Code-Plugins)
   adding the packaged tree as `plugins/Wzdhehe/mcode-webui/`
   (copy the contents of `dist/Wzdhehe/mcode-webui/` — per the
   "one folder = one plugin" model — see the official README).
5. Tag the release: `git tag v1.X.Y && git push --tags`.

## Questions?

Open an issue. If it's about a plugin-submission process (reviewer
comments, manifest fields, etc.), tag it `plugin-registry`.
