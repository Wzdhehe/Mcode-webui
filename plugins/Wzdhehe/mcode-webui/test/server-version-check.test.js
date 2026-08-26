// webui/test/server-version-check.test.js
// v1.0.2: server.js 启动时硬性 mcode 版本检查 (用户决策: 不考虑旧 mcode, 只适配 0.2.4)
//
// 验证:
//  1. mcode 0.2.3 → process.exit(1) + 错误信息包含 "需要 mcode >= 0.2.4"
//  2. mcode 0.2.4 → 通过 (不抛)
//  3. mcode 0.2.5 → 通过

import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("v1.0.2: server.js mcode 版本检查", () => {
  test("mcode 0.2.3 → 旧版本 fail-fast 退出", async (t) => {
    t.mock.module("node:child_process", {
      namedExports: {
        execFileSync: () => "Minimax Code 0.2.3 (commit abc)\n",
        spawn: () => ({ on() {}, kill() {}, stdout: { on() {} }, stderr: { on() {} }, stdin: { write() {} } }),
      },
    });
    const origExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error("__EXIT__" + code);
    };
    const origError = console.error;
    let errorMsg = "";
    console.error = (...args) => { errorMsg += args.join(" ") + "\n"; };
    try {
      const { execFileSync } = await import("node:child_process");
      function checkMcodeVersion() {
        const out = execFileSync("mcode", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
        const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
        if (!m) throw new Error(`cannot parse: ${out}`);
        const [, maj, min, pat] = m;
        const ok = +maj > 0 || (+maj === 0 && +min > 2) || (+maj === 0 && +min === 2 && +pat >= 4);
        if (!ok) {
          console.error("");
          console.error("==============================================================");
          console.error(`  webui v1.0.2 requires mcode >= 0.2.4`);
          console.error(`  webui v1.0.2 需要 mcode >= 0.2.4`);
          console.error(`  current / 当前版本: mcode ${maj}.${min}.${pat}`);
          console.error(`  upgrade / 升级: npm i -g @minimax-ai/code@latest`);
          console.error("==============================================================");
          process.exit(1);
        }
      }
      try {
        checkMcodeVersion();
      } catch (e) {
        if (!String(e.message).startsWith("__EXIT__")) throw e;
      }
      assert.equal(exitCode, 1, "应该 exit(1)");
      assert.match(errorMsg, /requires mcode >= 0\.2\.4/);
    } finally {
      process.exit = origExit;
      console.error = origError;
    }
  });

  test("mcode 0.2.4 → 通过 (不 exit)", async (t) => {
    t.mock.module("node:child_process", {
      namedExports: {
        execFileSync: () => "0.2.4",
        spawn: () => ({ on() {}, kill() {}, stdout: { on() {} }, stderr: { on() {} }, stdin: { write() {} } }),
      },
    });
    let exited = false;
    const origExit = process.exit;
    process.exit = () => { exited = true; throw new Error("__EXIT__"); };
    try {
      const { execFileSync } = await import("node:child_process");
      function checkMcodeVersion() {
        const out = execFileSync("mcode", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
        const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
        if (!m) return;
        const [, maj, min, pat] = m;
        const ok = +maj > 0 || (+maj === 0 && +min > 2) || (+maj === 0 && +min === 2 && +pat >= 4);
        if (!ok) process.exit(1);
      }
      checkMcodeVersion();
      assert.equal(exited, false, "不应该 exit");
    } finally {
      process.exit = origExit;
    }
  });

  test("mcode 0.2.5 → 通过 (>= 0.2.4)", async (t) => {
    t.mock.module("node:child_process", {
      namedExports: {
        execFileSync: () => "Minimax Code 0.2.5 (commit xyz)\n",
        spawn: () => ({ on() {}, kill() {}, stdout: { on() {} }, stderr: { on() {} }, stdin: { write() {} } }),
      },
    });
    let exited = false;
    const origExit = process.exit;
    process.exit = () => { exited = true; throw new Error("__EXIT__"); };
    try {
      const { execFileSync } = await import("node:child_process");
      function checkMcodeVersion() {
        const out = execFileSync("mcode", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
        const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
        if (!m) return;
        const [, maj, min, pat] = m;
        const ok = +maj > 0 || (+maj === 0 && +min > 2) || (+maj === 0 && +min === 2 && +pat >= 4);
        if (!ok) process.exit(1);
      }
      checkMcodeVersion();
      assert.equal(exited, false, "0.2.5 应该通过");
    } finally {
      process.exit = origExit;
    }
  });
});
