// webui/test/routes-chat-queue.test.js
// v1.0.2: POST /api/chat/queue + /api/chat/queue/update + /api/chat/queue/delete + /api/chat/steer
//
// 验证:
//  1. handleQueue 缺 text → 400
//  2. handleQueue 调 McodeAcpClient.queue
//  3. handleSteer 调 acp.steer + 写 cs.mcodeSteers
//  4. handleSetMode 调 acp.setMode

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { setupMocks, absPath } from "./_setup.js";

let handleQueue, handleSteer, handleSetMode, handleSetConfigOption;
let getClient;

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

function mockAcp(t) {
  t.mock.module(absPath("../acp.mjs"), {
    namedExports: {
      McodeAcpClient: class {
        constructor() {}
        async start() { return { capabilities: {} }; }
        async queue(sid, text) { return { itemId: "q-1", text, sid }; }
        async queueUpdate(sid, itemId, text) { return { itemId, text, sid }; }
        async queueDelete(sid, itemId) { return { deleted: itemId }; }
        async steer(sid, text) { return { steered: true, sid, text }; }
        async setMode(sid, mode) { return { mode, sid }; }
        async setConfigOption(sid, key, value) { return { key, value, sid }; }
        async stop() {}
      },
    },
  });
}

before(async (t) => {
  await setupMocks(t, { mavis: { applyMavisUsageToCs: async () => {} } });
  mockAcp(t);
  const chatRoute = await import(absPath("routes/chat.js"));
  const stateBus = await import(absPath("lib/state-bus.js"));
  handleQueue = chatRoute.handleQueue;
  handleSteer = chatRoute.handleSteer;
  handleSetMode = chatRoute.handleSetMode;
  handleSetConfigOption = chatRoute.handleSetConfigOption;
  getClient = stateBus.getClient;
});

describe("v1.0.2: handleQueue / handleQueueUpdate / handleQueueDelete", () => {
  test("handleQueue 缺 text → 400", async () => {
    const cs = getClient("test-q-1");
    cs.mcodeSessionId = "mvs-1";
    const req = fakeReq({}); // 无 text
    const res = fakeRes();
    await handleQueue(req, res, { cid: "test-q-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /text required/);
  });

  test("handleQueue 调 acp.queue + 返回 item", async () => {
    const cs = getClient("test-q-2");
    cs.mcodeSessionId = "mvs-2";
    const req = fakeReq({ text: "再查一下 Y" });
    const res = fakeRes();
    await handleQueue(req, res, { cid: "test-q-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.item.text, "再查一下 Y");
  });
});

describe("v1.0.2: handleSteer", () => {
  test("调 acp.steer + 写 cs.mcodeSteers", async () => {
    const cs = getClient("test-steer-1");
    cs.mcodeSessionId = "mvs-steer-1";
    const req = fakeReq({ text: "别这么干, 改成 X" });
    const res = fakeRes();
    await handleSteer(req, res, { cid: "test-steer-1", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    // mcodeSteers 应有 1 条
    assert.equal(cs.mcodeSteers.length, 1);
    assert.equal(cs.mcodeSteers[0].steeredText, "别这么干, 改成 X");
  });
});

describe("v1.0.2: handleSetMode / handleSetConfigOption", () => {
  test("handleSetMode 缺 mode → 400", async () => {
    const cs = getClient("test-m-1");
    cs.mcodeSessionId = "mvs-m-1";
    const req = fakeReq({});
    const res = fakeRes();
    await handleSetMode(req, res, { cid: "test-m-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /mode required/);
  });

  test("handleSetMode 调 acp.setMode(mode)", async () => {
    const cs = getClient("test-m-2");
    cs.mcodeSessionId = "mvs-m-2";
    const req = fakeReq({ mode: "plan" });
    const res = fakeRes();
    await handleSetMode(req, res, { cid: "test-m-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.mode, "plan");
  });

  test("handleSetConfigOption 调 acp.setConfigOption(key, value)", async () => {
    const cs = getClient("test-c-1");
    cs.mcodeSessionId = "mvs-c-1";
    const req = fakeReq({ key: "model", value: "claude-3-5-sonnet" });
    const res = fakeRes();
    await handleSetConfigOption(req, res, { cid: "test-c-1", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.key, "model");
    assert.equal(res._body.value, "claude-3-5-sonnet");
  });
});
