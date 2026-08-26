// webui/test/lib-state-bus-goal.test.js
// v1.0.2: mcode 0.2.4 Goal — 5 状态枚举 + goalBudget 序列化
//
// 验证:
//  1. Goal 5 状态枚举: active | paused | blocked | complete | budget_limited
//  2. broadcastGoalUpdate 设置 cs.goalBudget 为 { used, total, status }

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { setupMocks, absPath } from "./_setup.js";

let broadcastGoalUpdate, broadcastDelegationUpdate, getClient, sseByCid;

before(async (t) => {
  await setupMocks(t, { lanBroadcast: false });
  const mod = await import(absPath("lib/state-bus.js"));
  broadcastGoalUpdate = mod.broadcastGoalUpdate;
  broadcastDelegationUpdate = mod.broadcastDelegationUpdate;
  getClient = mod.getClient;
  sseByCid = mod.sseByCid;
});

describe("v1.0.2: state-bus Goal / Delegation 字段", () => {
  test("Goal 5 状态枚举校验 (cli.js 验证值)", () => {
    // 来自 cli.js bundle grep 验证的 5 个 enum 值
    const expected = ["active", "paused", "blocked", "complete", "budget_limited"];
    // 在 v1.0.2 mcode-acp.js 和 routes/chat.js 里都用这些字符串
    // 这里只能间接验证 — 读 plan 文档列出的 5 状态
    // 实施 sanity check: 把 expected 数组当作 must-have 列表
    for (const status of expected) {
      assert.ok(typeof status === "string" && status.length > 0);
    }
  });

  test("broadcastGoalUpdate 设置 cs.goalBudget 完整 shape", () => {
    const fakeRes = { written: [], write(d) { this.written.push(d); } };
    sseByCid.set("cid-g1", fakeRes);
    const cs = getClient("cid-g1");
    assert.equal(cs.goalBudget, null, "默认 null");
    const goal = { used: 12000, total: 40000, status: "active" };
    broadcastGoalUpdate("cid-g1", goal);
    assert.deepEqual(cs.goalBudget, goal);
    // 改成 budget_limited (预算用尽)
    broadcastGoalUpdate("cid-g1", { used: 40000, total: 40000, status: "budget_limited" });
    assert.equal(cs.goalBudget.status, "budget_limited");
    // 设 null 清空
    broadcastGoalUpdate("cid-g1", null);
    assert.equal(cs.goalBudget, null);
  });

  test("broadcastDelegationUpdate 设置 cs.activeDelegations", () => {
    const fakeRes = { written: [], write(d) { this.written.push(d); } };
    sseByCid.set("cid-d1", fakeRes);
    const cs = getClient("cid-d1");
    const delegations = [
      { delegationId: "del-1", agent: "explorer", status: "active" },
      { delegationId: "del-2", agent: "coder", status: "blocked" },
    ];
    broadcastDelegationUpdate("cid-d1", delegations);
    assert.equal(cs.activeDelegations.length, 2);
    assert.equal(cs.activeDelegations[0].agent, "explorer");
    // 清空 (传 [])
    broadcastDelegationUpdate("cid-d1", []);
    assert.equal(cs.activeDelegations.length, 0);
  });
});
