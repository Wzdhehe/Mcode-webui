// webui/test/lib-acp-goal.test.js
// v1.0.2 Round 6: McodeAcpClient session/goal RPC 包装 (4 个 method + 1 队列 method 修复)
//
// 验证:
//  1. queue() 用 session/queue/enqueue (v1.0.2 Round 5 误用 session/queue, Round 6 修)
//  2. goalGet / goalCreate / goalPatch / goalClear 用正确 method 名 + params
//  3. goalCreate 传 tokenBudget 时正确序列化, 不传时不传这个字段
//  4. 5 状态 enum 校验 (跟 cli.js bundle 验证值)

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { setupMocks, absPath } from "./_setup.js";

let McodeAcpClient;

before(async (t) => {
  const { Writable, Readable: NodeReadable } = await import("node:stream");
  function makeFakeChild() {
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    const stdout = new NodeReadable({ read() {} });
    const stderr = new NodeReadable({ read() {} });
    return {
      stdin, stdout, stderr,
      on() {}, kill() {},
    };
  }
  // mock 包含 spawnSync (server/lib/config.js 启动时调) + spawn (acp.mjs 用)
  t.mock.module("node:child_process", {
    namedExports: {
      spawn: () => makeFakeChild(),
      spawnSync: () => ({ stdout: Buffer.from("0.2.4"), status: 0 }),
    },
  });
  await setupMocks(t, {});
  const mod = await import(absPath("../acp.mjs"));
  McodeAcpClient = mod.McodeAcpClient;
});

describe("v1.0.2 Round 6 fix: queue() 用 session/queue/enqueue", () => {
  test("queue() 发 session/queue/enqueue (不是 session/queue)", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { item: { id: "q-1", text: params.text } };
    };
    await c.queue("mvs-1", "再查一下 Y");
    assert.equal(captured.method, "session/queue/enqueue",
      "v1.0.2 Round 5 误用 'session/queue', Round 6 修正");
    assert.equal(captured.params.sessionId, "mvs-1");
    assert.equal(captured.params.text, "再查一下 Y");
  });
});

describe("v1.0.2 Round 6: McodeAcpClient session/goal RPC 包装", () => {
  test("goalGet(sessionId) 发 session/goal/get", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { goal: { id: "g-1", sessionId: params.sessionId, status: "active" } };
    };
    const r = await c.goalGet("mvs-1");
    assert.equal(captured.method, "session/goal/get");
    assert.equal(captured.params.sessionId, "mvs-1");
    assert.equal(r.goal.id, "g-1");
    assert.equal(r.goal.status, "active");
  });

  test("goalCreate(sessionId, objective) 必传 objective", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { goal: { ...params, id: "g-new", status: "active" } };
    };
    const r = await c.goalCreate("mvs-1", "调研 mcode 0.2.4 控制面");
    assert.equal(captured.method, "session/goal/create");
    assert.equal(captured.params.sessionId, "mvs-1");
    assert.equal(captured.params.objective, "调研 mcode 0.2.4 控制面");
    assert.equal("tokenBudget" in captured.params, false,
      "不传 tokenBudget 时不应在 params 里");
    assert.equal(r.goal.objective, "调研 mcode 0.2.4 控制面");
  });

  test("goalCreate(sessionId, objective, tokenBudget) 传 tokenBudget", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { goal: { ...params, id: "g-new2" } };
    };
    await c.goalCreate("mvs-1", "目标", 40000);
    assert.equal(captured.params.tokenBudget, 40000);
  });

  test("goalPatch(sessionId, {status, objective}) 透传 fields", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { goal: { ...params, id: "g-1" } };
    };
    await c.goalPatch("mvs-1", { status: "paused", objective: "新目标" });
    assert.equal(captured.method, "session/goal/patch");
    assert.equal(captured.params.sessionId, "mvs-1");
    assert.equal(captured.params.status, "paused");
    assert.equal(captured.params.objective, "新目标");
  });

  test("goalClear(sessionId) 发 session/goal/clear", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { cleared: true };
    };
    const r = await c.goalClear("mvs-1");
    assert.equal(captured.method, "session/goal/clear");
    assert.equal(captured.params.sessionId, "mvs-1");
    assert.equal(r.cleared, true);
  });
});

describe("v1.0.2 Round 6: Goal 5 状态 enum (cli.js 验证值)", () => {
  // 跟 server/lib/state-bus.js GOAL_STATUSES 同步, 也跟 mcode 内部 enum 同步
  const EXPECTED = ["active", "paused", "blocked", "complete", "budget_limited"];

  test("5 状态 enum 完整 (cli.js grep 验证)", () => {
    assert.equal(EXPECTED.length, 5);
    for (const s of EXPECTED) {
      assert.ok(typeof s === "string" && s.length > 0, `${s} 应是非空字符串`);
    }
  });

  test("GOAL_STATUSES Set 包含 5 状态", async () => {
    // 实际测 state-bus 导出的 GOAL_STATUSES — 必须跟 EXPECTED 一致
    const { GOAL_STATUSES } = await import(absPath("lib/state-bus.js"));
    for (const s of EXPECTED) {
      assert.ok(GOAL_STATUSES.has(s), `GOAL_STATUSES 应包含 ${s}`);
    }
    assert.equal(GOAL_STATUSES.size, 5, "GOAL_STATUSES 大小应为 5");
  });
});
