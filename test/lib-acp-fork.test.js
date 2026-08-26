// webui/test/lib-acp-fork.test.js
// v1.0.2: McodeAcpClient 新增 10 个 RPC 方法 (mock JSON-RPC 层, 不真起 mcode)
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
    assert.equal(calls[0].method, "session/queue/enqueue");
    assert.equal(calls[0].params.text, "text A");
    assert.equal(calls[1].method, "session/queue/update");
    assert.equal(calls[1].params.itemId, "q-1");
    assert.equal(calls[1].params.text, "text B");
    assert.equal(calls[2].method, "session/queue/delete");
    assert.equal(calls[3].method, "session/queue/steer");
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
    assert.equal(calls[0].method, "session/set_mode");
    assert.equal(calls[0].params.mode, "plan");
    assert.equal(calls[1].method, "session/set_config_option");
    assert.equal(calls[1].params.key, "model");
    assert.equal(calls[1].params.value, "claude");
  });
});
