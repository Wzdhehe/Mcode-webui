// webui/test/routes-chat-goal.test.js
// v1.0.2 Round 6: server/routes/chat.js — 4 个 goal endpoint (POST/PATCH/DELETE/GET)
//
// 验证:
//  1. POST 缺 objective → 400
//  2. POST 正常路径 → 调 acp.goalCreate + broadcastGoalUpdate + 200
//  3. PATCH 无效 status → 400 (走 5 状态 enum 校验)
//  4. PATCH 正常 status → 调 acp.goalPatch + 200
//  5. PATCH 空 body → 400 ("no fields to patch")
//  6. DELETE 调 acp.goalClear + broadcastGoalUpdate(null) + 200
//  7. GET 返回当前 goal (cs.mcodeSessionId=null 时返 null)

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { setupMocks, absPath } from "./_setup.js";

let handleGoalCreate, handleGoalPatch, handleGoalClear, handleGoalGet;
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
        async goalGet() { return { goal: { id: "g-1", status: "active", objective: "调研" } }; }
        async goalCreate() { return { goal: { id: "g-new", status: "active", objective: "目标" } }; }
        async goalPatch() { return { goal: { id: "g-1", status: "paused" } }; }
        async goalClear() { return { cleared: true }; }
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
  handleGoalCreate = chatRoute.handleGoalCreate;
  handleGoalPatch = chatRoute.handleGoalPatch;
  handleGoalClear = chatRoute.handleGoalClear;
  handleGoalGet = chatRoute.handleGoalGet;
  getClient = stateBus.getClient;
});

describe("v1.0.2 Round 6: handleGoalCreate", () => {
  test("缺 objective → 400", async () => {
    const cs = getClient("test-gc-1");
    cs.mcodeSessionId = "mvs-1";
    const req = fakeReq({}); // 无 objective
    const res = fakeRes();
    await handleGoalCreate(req, res, { cid: "test-gc-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /objective required/);
  });

  test("正常路径 → 200 + goal + cs.goalBudget 更新", async () => {
    const cs = getClient("test-gc-2");
    cs.mcodeSessionId = "mvs-2";
    cs.goalBudget = null;
    const req = fakeReq({ objective: "调研", tokenBudget: 40000 });
    const res = fakeRes();
    await handleGoalCreate(req, res, { cid: "test-gc-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.goal.objective, "目标");
    // cs.goalBudget 应该被 broadcast 改成返回的 goal
    assert.ok(cs.goalBudget, "cs.goalBudget 应被 broadcast 更新");
    assert.equal(cs.goalBudget.objective, "目标");
  });
});

describe("v1.0.2 Round 6: handleGoalPatch", () => {
  test("无效 status (不在 5 状态 enum) → 400", async () => {
    const cs = getClient("test-gp-1");
    cs.mcodeSessionId = "mvs-3";
    const req = fakeReq({ status: "invalid_status" });
    const res = fakeRes();
    await handleGoalPatch(req, res, { cid: "test-gp-1", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /status must be one of/);
  });

  test("正常 status → 200", async () => {
    const cs = getClient("test-gp-2");
    cs.mcodeSessionId = "mvs-4";
    const req = fakeReq({ status: "paused" });
    const res = fakeRes();
    await handleGoalPatch(req, res, { cid: "test-gp-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.goal.status, "paused");
  });

  test("空 body → 400 'no fields to patch'", async () => {
    const cs = getClient("test-gp-3");
    cs.mcodeSessionId = "mvs-5";
    const req = fakeReq({});
    const res = fakeRes();
    await handleGoalPatch(req, res, { cid: "test-gp-3", cs });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /no fields to patch/);
  });
});

describe("v1.0.2 Round 6: handleGoalClear", () => {
  test("正常 → 200 + cs.goalBudget 设为 null", async () => {
    const cs = getClient("test-gcl-1");
    cs.mcodeSessionId = "mvs-6";
    cs.goalBudget = { used: 100, total: 1000, status: "active" };
    const req = fakeReq({});
    const res = fakeRes();
    await handleGoalClear(req, res, { cid: "test-gcl-1", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.cleared, true);
    assert.equal(cs.goalBudget, null, "clear 后 cs.goalBudget 必为 null");
  });
});

describe("v1.0.2 Round 6: handleGoalGet", () => {
  test("cs.mcodeSessionId=null → 200 + goal:null", async () => {
    const cs = getClient("test-gg-1");
    cs.mcodeSessionId = null;
    const req = fakeReq({});
    const res = fakeRes();
    await handleGoalGet(req, res, { cid: "test-gg-1", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.goal, null);
  });

  test("正常 → 200 + 返回 goal", async () => {
    const cs = getClient("test-gg-2");
    cs.mcodeSessionId = "mvs-7";
    const req = fakeReq({});
    const res = fakeRes();
    await handleGoalGet(req, res, { cid: "test-gg-2", cs });
    assert.equal(res._status, 200);
    assert.equal(res._body.goal.id, "g-1");
    assert.equal(res._body.goal.status, "active");
  });
});
