// webui/test/routes-chat-v11.test.js
// v1.1: mcode 0.3/0.4 新路由 —
//   GET  /api/chat/queue            (handleQueueList → acp.queueList)
//   GET  /api/chat/config-options   (handleConfigOptions → loadSession + sessionConfigs)
//   POST /api/sessions/acp-activate (handleAcpActivate → acp.activate)
//   POST /api/sessions/acp-close    (handleAcpClose → acp.closeSession)

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { setupMocks, absPath } from "./_setup.js";

let handleQueueList, handleConfigOptions, handleAcpActivate, handleAcpClose;
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

const CONFIG_OPTIONS = [
  {
    type: "select",
    id: "model",
    currentValue: "m:minimax:MiniMax-M3:v:thinking",
    options: [{ value: "m:minimax:MiniMax-M3:v:thinking", name: "MiniMax-M3 · thinking" }],
  },
];

function mockAcp(t) {
  t.mock.module(absPath("../acp.mjs"), {
    namedExports: {
      McodeAcpClient: class {
        constructor() {}
        async start() {
          return { capabilities: {} };
        }
        async queueList(sid) {
          return { items: [{ itemId: "q-9", text: "排队内容", position: 1 }] };
        }
        async loadSession(sid, cwd) {
          return { sessionId: sid, cwd, configOptions: CONFIG_OPTIONS };
        }
        getSessionConfigOptions(sid) {
          return CONFIG_OPTIONS;
        }
        async activate(sid) {
          return {};
        }
        async closeSession(sid) {
          return {};
        }
        async stop() {}
      },
    },
  });
}

before(async (t) => {
  await setupMocks(t, { mavis: { applyMavisUsageToCs: async () => {} } });
  mockAcp(t);
  const chatRoute = await import(absPath("routes/chat.js"));
  const sessionsRoute = await import(absPath("routes/sessions.js"));
  const stateBus = await import(absPath("lib/state-bus.js"));
  handleQueueList = chatRoute.handleQueueList;
  handleConfigOptions = chatRoute.handleConfigOptions;
  handleAcpActivate = sessionsRoute.handleAcpActivate;
  handleAcpClose = sessionsRoute.handleAcpClose;
  getClient = stateBus.getClient;
});

describe("v1.1: GET /api/chat/queue (handleQueueList)", () => {
  test("无 active mcode session → 400", async () => {
    const cs = getClient("test-v11-ql-1");
    const res = fakeRes();
    await handleQueueList(fakeReq(), res, { cid: "test-v11-ql-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /no active mcode session/);
  });

  test("调 acp.queueList → 返回 items", async () => {
    const cs = getClient("test-v11-ql-2");
    cs.mcodeSessionId = "mvs-ql-2";
    const res = fakeRes();
    await handleQueueList(fakeReq(), res, { cid: "test-v11-ql-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.items.length, 1);
    assert.equal(res._body.items[0].itemId, "q-9");
    assert.equal(res._body.items[0].text, "排队内容");
  });
});

describe("v1.1: GET /api/chat/config-options (handleConfigOptions)", () => {
  test("无 active mcode session → 400", async () => {
    const cs = getClient("test-v11-co-1");
    const res = fakeRes();
    await handleConfigOptions(fakeReq(), res, { cid: "test-v11-co-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /no active mcode session/);
  });

  test("loadSession 后返回 configOptions (model 下拉数据源)", async () => {
    const cs = getClient("test-v11-co-2");
    cs.mcodeSessionId = "mvs-co-2";
    cs.workspace = { dir: "C:/tmp/ws" };
    const res = fakeRes();
    await handleConfigOptions(fakeReq(), res, { cid: "test-v11-co-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.configOptions[0].id, "model");
    assert.equal(res._body.configOptions[0].currentValue, "m:minimax:MiniMax-M3:v:thinking");
  });
});

describe("v1.1: POST /api/sessions/acp-activate + acp-close", () => {
  test("activate 缺 sessionId → 400", async () => {
    const res = fakeRes();
    await handleAcpActivate(fakeReq({}), res, { cid: "test-v11-a-1", cs: getClient("test-v11-a-1") });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /sessionId required/);
  });

  test("activate 调 acp.activate → ok", async () => {
    const res = fakeRes();
    await handleAcpActivate(fakeReq({ sessionId: "mvs-a-2" }), res, {
      cid: "test-v11-a-2",
      cs: getClient("test-v11-a-2"),
    });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.sessionId, "mvs-a-2");
  });

  test("close 缺 sessionId → 400", async () => {
    const res = fakeRes();
    await handleAcpClose(fakeReq({}), res, { cid: "test-v11-c-1", cs: getClient("test-v11-c-1") });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /sessionId required/);
  });

  test("close 调 acp.closeSession → ok", async () => {
    const res = fakeRes();
    await handleAcpClose(fakeReq({ sessionId: "mvs-c-2" }), res, {
      cid: "test-v11-c-2",
      cs: getClient("test-v11-c-2"),
    });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.sessionId, "mvs-c-2");
  });
});
