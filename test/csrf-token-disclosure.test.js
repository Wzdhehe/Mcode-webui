// webui/test/csrf-token-disclosure.test.js
// Regression test for the CSRF / bootstrap-token-disclosure blocker
// reported by hetaoBackend on 2026-09-01 against PR #23 head 091dec5
// (server/router.js:280 sets Access-Control-Allow-Origin: *; auth.js:113
// bypasses Gate 3 for local requests; routes/settings.js returns the
// bootstrap token in the settings snapshot before acknowledgment).
//
// Attack vector (per the original report):
//   - Malicious page at https://evil.example can issue
//     fetch('http://127.0.0.1:PORT/api/settings', { method: 'POST', ... })
//   - Browser sends Origin: https://evil.example
//   - Server's CORS is `*` → browser allows the page to read the response
//   - Server's isLocalRequest(req) bypasses Gate 3 because the request
//     originates from 127.0.0.1
//   - Server returns the settings snapshot, including the bootstrap token
//   - The page now has the token and can call state-changing endpoints
//
// These tests spawn the real server.js (integration, not mocked) so they
// exercise the full middleware chain — Gate 3 in particular is what unit
// tests on router.js alone miss. Each test is RED on the unfixed code
// and should be GREEN after Round 8 lands.
//
// Strategy:
//   1. Start a fresh server with an empty settings dir (no pre-existing
//      token). The server generates a new bootstrap token and persists it
//      to the file.
//   2. Send a cross-origin request (Origin: https://evil.example).
//   3. Assert the response does NOT leak the bootstrap token AND the
//      CORS headers do not allow arbitrary cross-origin read.
//   4. SIGTERM the server.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(__dirname, "..");
const PORT = 18090; // unique per test file to avoid port collision
const SETTINGS_DIR = mkdtempSync(join(tmpdir(), "csrf-test-"));
const SETTINGS_PATH = join(SETTINGS_DIR, "settings.json");
const EVIL_ORIGIN = "https://evil.example";

let serverProc = null;
let bootstrapToken = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startServer() {
  serverProc = spawn("node", [join(SERVER_DIR, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      MCODE_WEBUI_SETTINGS_PATH: SETTINGS_PATH,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  serverProc.stdout.on("data", (d) => (stdout += d.toString()));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 50; i++) {
    if (stdout.includes("listening on")) return;
    await sleep(100);
  }
  throw new Error(`server failed to start within 5s. stdout:\n${stdout}`);
}

async function stopServer() {
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
    await new Promise((r) => serverProc.on("exit", r));
  }
}

function req({ method = "GET", path = "/api/settings", body = null, origin = EVIL_ORIGIN } = {}) {
  const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
  return new Promise((res, rej) => {
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "Content-Length": data == null ? 0 : Buffer.byteLength(data),
        },
      },
      (resp) => {
        let chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          res({
            status: resp.statusCode,
            headers: resp.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    r.on("error", rej);
    if (data != null) r.write(data);
    r.end();
  });
}

before(async () => {
  await startServer();
  // initSettings runs before server.listen, but allow a small grace
  // window for the atomic-rename write to complete on slower disks.
  for (let i = 0; i < 50; i++) {
    if (existsSync(SETTINGS_PATH)) {
      const j = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
      // settings.json stores the live token under `currentToken` (the
      // operator may have rotated it). The bootstrap token is the same
      // value until the first rotation, which never happens in a fresh
      // settings dir.
      bootstrapToken = j?.currentToken || j?.token || null;
    }
    if (bootstrapToken) break;
    await sleep(100);
  }
  if (!bootstrapToken) {
    console.error(`[diag] SETTINGS_PATH=${SETTINGS_PATH} exists=${existsSync(SETTINGS_PATH)}`);
    if (existsSync(SETTINGS_PATH)) {
      console.error(`[diag] file content: ${readFileSync(SETTINGS_PATH, "utf8").slice(0, 300)}`);
    }
  }
  assert.ok(bootstrapToken, "server must write a bootstrap token to settings file");
});

after(async () => {
  await stopServer();
  try { rmSync(SETTINGS_DIR, { recursive: true, force: true }); } catch {}
});

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

test("blocker#1: GET /api/settings with cross-origin MUST NOT return 200 with bootstrap token", async () => {
  const r = await req({ method: "GET" });
  // The response must EITHER be a non-2xx (token-protected) OR be 2xx
  // but without leaking the bootstrap token. Pre-fix: 200 + token leaked.
  const ok = r.status !== 200 || !r.body.includes(bootstrapToken);
  assert.ok(
    ok,
    `CSRF blocker present: GET /api/settings from ${EVIL_ORIGIN} returned status=${r.status} with bootstrap token in body. ` +
      `Body head: ${r.body.slice(0, 200)}`
  );
});

test("blocker#2: POST /api/settings with cross-origin MUST NOT return 200 with bootstrap token", async () => {
  const r = await req({ method: "POST", body: { lanBroadcast: true } });
  const ok = r.status !== 200 || !r.body.includes(bootstrapToken);
  assert.ok(
    ok,
    `CSRF blocker present: POST /api/settings from ${EVIL_ORIGIN} returned status=${r.status} with bootstrap token. ` +
      `Body head: ${r.body.slice(0, 200)}`
  );
});

test("blocker#3: cross-origin response MUST NOT have CORS Access-Control-Allow-Origin: *", async () => {
  const r = await req({ method: "GET" });
  const acao = r.headers["access-control-allow-origin"];
  assert.notStrictEqual(
    acao,
    "*",
    `CORS is too permissive: Access-Control-Allow-Origin: * allows ANY cross-origin reader. ` +
      `Server should echo a specific Origin (with allowlist) or omit the header for cross-origin requests.`
  );
});

test("blocker#4: DELETE /api/sessions/:id with cross-origin MUST require auth (401 or 403)", async () => {
  const r = await req({ method: "DELETE", path: "/api/sessions/csrftest-id" });
  // 404 is acceptable (session not found); 401/403 are the protected
  // responses. The bug is 200 (success on nonexistent) or any 2xx that
  // bypasses Gate 3 for cross-origin callers.
  assert.ok(
    r.status === 401 || r.status === 403 || r.status === 404,
    `Cross-origin DELETE /api/sessions/:id returned ${r.status}; expected 401/403/404. ` +
      `A 2xx here means Gate 3 (token auth) was bypassed for cross-origin requests.`
  );
});
