// webui/test/events-ask-countdown.test.js
// v1.0.2 Round 6: Ask modal 30s 倒计时 (客户端兜底, mcode 0.2.4 文档没列 countdown 事件)
//
// 验证 (fake DOM mock 测纯函数逻辑, 跟 events.js 的真实实现镜像):
//  1. startAskCountdown 显示 banner + 设置初始 seconds
//  2. stopAskCountdown 隐藏 banner + 清 timer
//  3. 倒计时到 0 时调 askModalNextOrSend (走模板化, 跟用户点 send 一样)
//  4. start → stop → start 能重置 (无 timer 泄漏)
//  5. events.js 真实导出 startAskCountdown / stopAskCountdown 存在 (signature check,
//     避免 inline 测试跟生产代码脱节)

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// 跟 events.js:1951-1984 镜像 (pure 逻辑, 不依赖 DOM 模块加载)
// 真实 events.js 实现的纯逻辑部分 (timer + state)
let _askCountdownTimer = null;
let _askCountdownRemaining = 0;
let _banner = null;
let _secondsEl = null;
let _modal = null;
let _askModalNextOrSendCalls = 0;
let _setIntervalCalls = 0;
let _clearIntervalCalls = 0;

function _clear(handle) {
  if (handle) {
    _clearIntervalCalls += 1;
  }
}
function _start(seconds = 30) {
  if (_askCountdownTimer) _clear(_askCountdownTimer);
  _banner.hidden = false;
  _secondsEl.textContent = String(seconds);
  _askCountdownRemaining = seconds;
  _setIntervalCalls += 1;
  _askCountdownTimer = { id: _setIntervalCalls, _unref() {} };
  return _askCountdownTimer;
}
function _tick() {
  _askCountdownRemaining -= 1;
  if (_askCountdownRemaining <= 0) {
    _stop();
    if (_modal && !_modal.hidden) _askModalNextOrSendCalls += 1;
    return;
  }
  _secondsEl.textContent = String(_askCountdownRemaining);
}
function _stop() {
  if (_askCountdownTimer) {
    _clearIntervalCalls += 1;
    _askCountdownTimer = null;
  }
  if (_banner) _banner.hidden = true;
}

function _resetState() {
  _banner = { hidden: true };
  _secondsEl = { textContent: "" };
  _modal = { hidden: true };
  _askCountdownTimer = null;
  _askCountdownRemaining = 0;
  _setIntervalCalls = 0;
  _clearIntervalCalls = 0;
  _askModalNextOrSendCalls = 0;
}

describe("v1.0.2 Round 6: Ask countdown 纯逻辑 (镜像 events.js)", () => {
  test("start 显示 banner + 初始 30s", () => {
    _resetState();
    _start(30);
    assert.equal(_banner.hidden, false, "banner 应显示");
    assert.equal(_secondsEl.textContent, "30", "初始 30s");
    assert.equal(_setIntervalCalls, 1, "起 1 个 setInterval");
  });

  test("stop 隐藏 banner + 清 timer", () => {
    _resetState();
    _start(30);
    _stop();
    assert.equal(_banner.hidden, true);
    assert.equal(_clearIntervalCalls, 1, "clearInterval 调 1 次");
  });

  test("start → stop → start 能重置 (无 timer 泄漏)", () => {
    _resetState();
    _start(30);
    _stop();
    _start(15);
    assert.equal(_secondsEl.textContent, "15", "重置后 seconds = 15");
    assert.equal(_setIntervalCalls, 2, "两次 setInterval");
    assert.equal(_clearIntervalCalls, 1, "第一次 stop 清了 1 个");
  });

  test("倒计时到 0 → 调 askModalNextOrSend (模板化提交, 不是 sendAskAnswer 错对象)", () => {
    _resetState();
    _modal = { hidden: false };
    _start(2);
    _tick(); // 1
    _tick(); // 0
    assert.equal(_askModalNextOrSendCalls, 1,
      "到 0 自动调 askModalNextOrSend (R6 audit fix)");
    assert.equal(_banner.hidden, true, "banner 自动隐藏");
  });

  test("倒计时到 0 但 ask modal 没开 → 不调 askModalNextOrSend", () => {
    _resetState();
    _modal = { hidden: true };
    _start(1);
    _tick();
    assert.equal(_askModalNextOrSendCalls, 0, "modal 关闭时不调");
  });
});

describe("v1.0.2 Round 6: events.js 真实导出存在性", () => {
  test("events.js 导出 startAskCountdown / stopAskCountdown (grep 验证)", async () => {
    // 不能直接 import (会拉整个 DOM 模块链); 用 fs.readFileSync 读源文件 grep 验证
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve("public/app/events.js"),
      "utf8"
    );
    assert.ok(/export\s+function\s+startAskCountdown/.test(src),
      "events.js 应 export function startAskCountdown");
    assert.ok(/export\s+function\s+stopAskCountdown/.test(src),
      "events.js 应 export function stopAskCountdown");
  });
});
