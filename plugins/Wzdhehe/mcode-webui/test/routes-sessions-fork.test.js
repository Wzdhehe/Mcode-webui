// webui/test/routes-sessions-fork.test.js
// v1.0.2: POST /api/sessions/fork + POST /api/sessions/resume
//
// 验证:
//  1. handleFork 缺 atMessageId → 400
//  2. handleFork 调 McodeAcpClient.fork + 写 cs.mcodeForks
//  3. handleResume strategy=most-recent 选最近 mcode session

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { setupMocks, absPath } from "./_setup.js";

let handleFork, handleResume, getClient;

function fakeReq(body) {
  return Readable.from([Buffer.from(JSON.stringify(body || {}), "utf8")]);
}
function fakeRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: null,
    writeHead(s, h) {
      this._status = s;
      if (h) this._headers = h;
    },
    end(b) {
      this._body = b ? JSON.parse(b) : null;
    },
  };
  return res;
}

// Mock acp.mjs (避免真起 mcode 子进程)
function mockAcp(t) {
  t.mock.module(absPath("../acp.mjs"), {
    namedExports: {
      McodeAcpClient: class {
        constructor() {}
        async start() { return { capabilities: {} }; }
        async fork(sessionId, atMessageId) {
          return { sessionId: "forked-" + sessionId + "-at-" + atMessageId, title: "Forked session" };
        }
        async resume(sessionId) { return { sessionId }; }
        async stop() {}
      },
    },
  });
}

before(async (t) => {
  await setupMocks(t, {
    acp: {
      getMcodeSessionsForWorkspace: async () => [
        { sessionId: "recent-1", title: "Recent 1" },
        { sessionId: "old-2", title: "Old 2" },
      ],
    },
    mavis: { applyMavisUsageToCs: async () => {} },
  });
  mockAcp(t);
  const sessionsRoute = await import(absPath("routes/sessions.js"));
  const stateBus = await import(absPath("lib/state-bus.js"));
  handleFork = sessionsRoute.handleFork;
  handleResume = sessionsRoute.handleResume;
  getClient = stateBus.getClient;
});

describe("v1.0.2: handleFork / handleResume", () => {
  test("handleFork 缺 atMessageId → 400", async () => {
    const cs = getClient("test-fork-1");
    cs.mcodeSessionId = "mvs-orig";
    const req = fakeReq({}); // 无 atMessageId
    const res = fakeRes();
    await handleFork(req, res, { cid: "test-fork-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /atMessageId required/);
  });

  test("handleFork 调 acp.fork + 写 cs.mcodeForks", async () => {
    const cs = getClient("test-fork-2");
    cs.mcodeSessionId = "mvs-orig-2";
    const req = fakeReq({ atMessageId: "msg-7" });
    const res = fakeRes();
    await handleFork(req, res, { cid: "test-fork-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.fork.sessionId, "forked-mvs-orig-2-at-msg-7");
    // cs.mcodeForks 应有 1 条
    assert.equal(cs.mcodeForks.length, 1);
    assert.equal(cs.mcodeForks[0].atMessageId, "msg-7");
  });
});

describe("v1.0.2: handleResume", () => {
  test("strategy=most-recent 调 acp.resume(targetSid from mcodeSessions)", async () => {
    const cs = getClient("test-resume-1");
    cs.mcodeSessionId = null; // resume 不需要 pre-existing
    const req = fakeReq({ strategy: "most-recent" });
    const res = fakeRes();
    await handleResume(req, res, { cid: "test-resume-1", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    // 第一个 session (most recent) 应该是 "recent-1"
    assert.equal(res._body.sessionId, "recent-1");
    // cs.mcodeSessionId 应被更新
    assert.equal(cs.mcodeSessionId, "recent-1");
  });
});
