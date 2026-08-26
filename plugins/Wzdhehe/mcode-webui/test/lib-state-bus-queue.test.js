// webui/test/lib-state-bus-queue.test.js
// v1.0.2: mcode 0.2.4 control surface — state-bus 新增 cs 字段 + broadcast
//
// 验证:
//  1. makeClientState() 默认包含 mcodeQueue/mcodeForks/mcodeSteers/goalBudget/activeDelegations/skills/runtimeReady
//  2. broadcastQueueUpdate 更新 cs.mcodeQueue 并通过 SSE 推送
//  3. broadcastForked 把 fork 加到 cs.mcodeForks, 保留最近 5 条
//  4. broadcastSteered 把 steer 加到 cs.mcodeSteers, 保留最近 20 条

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { setupMocks, absPath } from "./_setup.js";

let makeClientState, getClient, broadcastQueueUpdate, broadcastForked, broadcastSteered, sseByCid;

before(async (t) => {
  await setupMocks(t, { lanBroadcast: false });
  const mod = await import(absPath("lib/state-bus.js"));
  makeClientState = mod.makeClientState;
  getClient = mod.getClient;
  broadcastQueueUpdate = mod.broadcastQueueUpdate;
  broadcastForked = mod.broadcastForked;
  broadcastSteered = mod.broadcastSteered;
  sseByCid = mod.sseByCid;
});

describe("v1.0.2: state-bus 新增 control surface 字段", () => {
  test("makeClientState 默认包含 6 个新字段", () => {
    const cs = makeClientState();
    assert.deepEqual(cs.mcodeQueue, [], "mcodeQueue 默认 []");
    assert.deepEqual(cs.mcodeForks, [], "mcodeForks 默认 []");
    assert.deepEqual(cs.mcodeSteers, [], "mcodeSteers 默认 []");
    assert.equal(cs.goalBudget, null, "goalBudget 默认 null");
    assert.deepEqual(cs.activeDelegations, [], "activeDelegations 默认 []");
    assert.deepEqual(cs.skills, [], "skills 默认 [] (Round 7 用)");
    assert.equal(cs.runtimeReady, false, "runtimeReady 默认 false");
  });

  test("broadcastQueueUpdate 更新 cs.mcodeQueue", () => {
    const fakeRes = { written: [], write(d) { this.written.push(d); } };
    sseByCid.set("cid-q1", fakeRes);
    const cs1 = getClient("cid-q1");
    const items = [{ itemId: "q-1", text: "再查一下 Y", createdAt: 100 }];
    broadcastQueueUpdate("cid-q1", items);
    assert.deepEqual(cs1.mcodeQueue, items);
    // SSE 推送过 (至少 1 次)
    assert.ok(fakeRes.written.length >= 1, "SSE 推送过");
  });

  test("broadcastForked 加 fork 到 mcodeForks, 保留最近 5 条", () => {
    const fakeRes = { written: [], write(d) { this.written.push(d); } };
    sseByCid.set("cid-f1", fakeRes);
    const cs = getClient("cid-f1");
    // 加 7 条, 应该只保留 5 条
    for (let i = 1; i <= 7; i++) {
      broadcastForked("cid-f1", { forkId: `f-${i}`, atMessageId: `m-${i}` });
    }
    assert.equal(cs.mcodeForks.length, 5, "保留 5 条");
    assert.equal(cs.mcodeForks[0].forkId, "f-7", "最新在最前");
    assert.equal(cs.mcodeForks[4].forkId, "f-3", "最旧在最后");
  });

  test("broadcastSteered 加 steer 到 mcodeSteers, 保留最近 20 条", () => {
    const fakeRes = { written: [], write(d) { this.written.push(d); } };
    sseByCid.set("cid-s1", fakeRes);
    const cs = getClient("cid-s1");
    for (let i = 1; i <= 25; i++) {
      broadcastSteered("cid-s1", { itemId: `s-${i}`, steeredText: `t${i}` });
    }
    assert.equal(cs.mcodeSteers.length, 20, "保留 20 条");
    assert.equal(cs.mcodeSteers[0].itemId, "s-25");
    assert.equal(cs.mcodeSteers[19].itemId, "s-6");
  });
});
