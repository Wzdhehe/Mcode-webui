// webui/test/lib-acp-fork.test.js
// v1.0.2: McodeAcpClient 新增 10 个 RPC 方法 (mock JSON-RPC 层, 不真起 mcode)
// v1.1: mcode 0.3+ 把扩展面迁到 mcode/session/* 命名空间 (probe 实测,
//   docs/acp-probe-0.4.md) — 包装层优先发新名, "Method not found" 时回退
//   0.2.x 裸名; set_mode 参数改 modeId; set_config_option 改 configId;
//   resume/fork 补 cwd。
//
// 验证:
//  1. fork() 调 session/fork (带 cwd)
//  2. queue() + queueUpdate() + queueDelete() + queueSteer() 走 mcode/session/*
//     且旧命名空间服务器上回退 session/queue/*
//  3. cancel() + resume() 调 session/cancel / session/resume (resume 带 cwd)
//  4. setMode() 发 modeId (回退 mode); setConfigOption() 发 configId (回退 key)
//
// 验证:
//  1. fork() 调 session/fork JSON-RPC
//  2. queue() + queueUpdate() + queueDelete() + queueSteer() 调正确 method 名
//  3. cancel() + resume() 调 session/cancel / session/resume
//  4. setMode() + setConfigOption() 调 session/set_mode / session/set_config_option

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { setupMocks, absPath } from "./_setup.js";

let McodeAcpClient;

before(async (t) => {
  // Mock node:child_process.spawn so the constructor doesn't try to start mcode
  // We need a fake child object with stdout/stderr pipes and stdin.
  const { Writable, Readable: NodeReadable } = await import("node:stream");
  function makeFakeChild() {
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    const stdout = new NodeReadable({ read() {} });
    const stderr = new NodeReadable({ read() {} });
    return {
      stdin,
      stdout,
      stderr,
      on() {},
      kill() {},
    };
  }
  t.mock.module("node:child_process", {
    namedExports: {
      spawn: () => makeFakeChild(),
    },
  });
  await setupMocks(t, {});
  const mod = await import(absPath("../acp.mjs"));
  McodeAcpClient = mod.McodeAcpClient;
});

describe("v1.0.2: McodeAcpClient 新增 RPC 包装 (mock JSON-RPC)", () => {
  test("fork(sessionId, atMessageId) 发 session/fork", async () => {
    const c = new McodeAcpClient();
    // Override request to capture the call
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { sessionId: "fork-1" };
    };
    await c.fork("mvs-1", "msg-5");
    assert.equal(captured.method, "session/fork");
    assert.equal(captured.params.sessionId, "mvs-1");
    assert.equal(captured.params.atMessageId, "msg-5");
  });

  test("queue / queueUpdate / queueDelete / queueSteer 调正确 method", async () => {
    const c = new McodeAcpClient();
    const calls = [];
    c.request = async (method, params) => {
      calls.push({ method, params });
      return { ok: true };
    };
    await c.queue("mvs-1", "text A");
    await c.queueUpdate("mvs-1", "q-1", "text B");
    await c.queueDelete("mvs-1", "q-1");
    await c.queueSteer("mvs-1", "q-1");
    // v1.1: 0.3+ 命名空间优先 (probe 实测, docs/acp-probe-0.4.md)
    assert.equal(calls[0].method, "mcode/session/queue/enqueue");
    assert.equal(calls[0].params.text, "text A");
    assert.equal(calls[1].method, "mcode/session/queue/update");
    assert.equal(calls[1].params.itemId, "q-1");
    assert.equal(calls[1].params.text, "text B");
    assert.equal(calls[2].method, "mcode/session/queue/delete");
    assert.equal(calls[3].method, "mcode/session/queue/steer");
  });

  test("旧命名空间 (0.2.x) 服务器: Method not found → 回退裸名", async () => {
    const c = new McodeAcpClient();
    const calls = [];
    c.request = async (method, params) => {
      calls.push({ method, params });
      if (method.startsWith("mcode/session/")) {
        const e = new Error('"Method not found": ' + method);
        e.code = -32601;
        throw e;
      }
      return { ok: true };
    };
    await c.queue("mvs-1", "text A");
    await c.steer("mvs-1", "steer text");
    assert.equal(calls[0].method, "mcode/session/queue/enqueue");
    assert.equal(calls[1].method, "session/queue/enqueue");
    // 命名空间缓存: 探测到 legacy 后, 后续调用直接走裸名 (不再试新名)
    assert.equal(calls[2].method, "session/steer");
    await c.queue("mvs-1", "text C");
    assert.equal(calls[3].method, "session/queue/enqueue");
  });

  test("queueList 发 mcode/session/queue/list (0.3+ 新增)", async () => {
    const c = new McodeAcpClient();
    let captured = null;
    c.request = async (method, params) => {
      captured = { method, params };
      return { items: [] };
    };
    await c.queueList("mvs-1");
    assert.equal(captured.method, "mcode/session/queue/list");
    assert.equal(captured.params.sessionId, "mvs-1");
  });

  test("cancel + resume 调正确 method", async () => {
    const c = new McodeAcpClient();
    const calls = [];
    c.request = async (method, params) => {
      calls.push({ method, params });
      return {};
    };
    await c.cancel("mvs-1");
    await c.resume("mvs-1");
    assert.equal(calls[0].method, "session/cancel");
    assert.equal(calls[1].method, "session/resume");
  });

  test("setMode + setConfigOption 调正确 method", async () => {
    const c = new McodeAcpClient();
    const calls = [];
    c.request = async (method, params) => {
      calls.push({ method, params });
      return {};
    };
    await c.setMode("mvs-1", "plan");
    await c.setConfigOption("mvs-1", "model", "claude");
    // v1.1: 0.3+ 形状 — modeId / configId (probe 实测)
    assert.equal(calls[0].method, "session/set_mode");
    assert.equal(calls[0].params.modeId, "plan");
    assert.equal(calls[1].method, "session/set_config_option");
    assert.equal(calls[1].params.configId, "model");
    assert.equal(calls[1].params.value, "claude");
  });

  test("setMode/setConfigOption 在 0.2.x 形状服务器上回退 mode/key", async () => {
    const c = new McodeAcpClient();
    const calls = [];
    c.request = async (method, params) => {
      calls.push({ method, params });
      if (params.modeId !== undefined || params.configId !== undefined) {
        const e = new Error("Invalid params");
        e.code = -32602;
        throw e;
      }
      return {};
    };
    await c.setMode("mvs-1", "plan");
    await c.setConfigOption("mvs-1", "model", "claude");
    assert.equal(calls[0].params.modeId, "plan");
    assert.equal(calls[1].method, "session/set_mode");
    assert.equal(calls[1].params.mode, "plan");
    assert.equal(calls[3].method, "session/set_config_option");
    assert.equal(calls[3].params.key, "model");
    assert.equal(calls[3].params.value, "claude");
  });
});
