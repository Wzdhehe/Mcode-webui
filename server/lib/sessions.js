// webui/server/lib/sessions.js
// Sessions JSON persistence + chat helpers.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SESSIONS_DB } from "./config.js";

// Sessions store (file-backed JSON; minimal)
// v0.5.bx-5: 剥 UTF-8 BOM — 之前直接 JSON.parse 在 ﻿ 上抛 syntax error，try/catch 静默吞掉返 []
//   结果：所有 session 查找都查不到，delete/switch 都 404 "session not found"（用户报"删除不掉对话"）
export function loadSessions() {
  if (!existsSync(SESSIONS_DB)) return [];
  try {
    let raw = readFileSync(SESSIONS_DB, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 剥 BOM
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveSessions(s) {
  writeFileSync(SESSIONS_DB, JSON.stringify(s, null, 2), "utf8");
}

// 重置所有 context 字段（不只是 tokens/used；percent/spent/tps 之前漏了导致切完仍显示旧的 %）
// v2 (2026-09-20 webui-manual-audit): ALSO reset the two "a run is in
//   progress" claim fields — cs.running + cs.context.thinkingStatus.
//   Before this, resetContext cleared only the counters: a mid-run
//   switch/create/new left running.active=true + thinkingStatus="Running"
//   parked in the client state, so the footer/context panel showed 思考中
//   forever and the send button stayed a stop button for a run the user
//   had navigated away from. The claim only healed if the in-flight
//   run's finalize() later fired — runs that die in their start phase
//   never heal. The idle shape is byte-mirrored from the runners'
//   finalize() (mcode-acp.js / mcode-exec.js) and chat.js's
//   resetThinkingClaim(), so switch and normal end-of-turn converge on
//   the same at-rest state. Callers (sessions.js switch/create/delete,
//   protocol.js activate-session, commands.js /clear + /new) all treat
//   cs as "no longer the session that run belongs to" — none needs the
//   claim preserved. Two deliberate boundaries:
//   (1) NO ▍ cursor stripping here — unlike chat.js's resetThinkingClaim
//       (same session, terminal failure), every resetContext caller has
//       either already replaced cs.chat with the TARGET session's chat
//       (switch: stripping would corrupt lines that belong to a
//       different, possibly live, run) or is about to clear it
//       (new/clear/delete). Chat ownership stays with the caller.
//   (2) lastUsageAt still goes null — this is a session-CHANGE path:
//       the target session has no observed usage yet, and carrying the
//       old session's freshness datum over zeroed counters would lie.
//       (resetThinkingClaim keeps it because THERE the session is the
//       same one; finalize() keeps it for the same reason.)
export function resetContext(cs) {
  cs.running = {
    active: false,
    prompt: null,
    pid: null,
    startedAt: null,
    model: null,
    sessionId: null,
    lastDeltaAt: null,
    tps: 0,
  };
  cs.context.thinkingStatus = "Idle";
  cs.context.tokens = 0;
  cs.context.used = 0;
  cs.context.percent = 0;
  cs.context.spent = 0;
  cs.context.tps = 0;
  cs.context.thinkingDuration = null;
  cs.context.assistantLast = null;
  cs.context.assistantAt = null;
  cs.context.lastUsageAt = null;
}

// v0.5.x: 把当前 state.chat 写回 db 里对应 session 的 chat 字段
// 切 session 时从这个字段加载历史（之前 db 只存 {id,title,createdAt}，导致切过去看不到聊天）
export function persistCurrentChat(cs) {
  if (!cs.sessionId) return;
  const all = loadSessions();
  const item = all.find((s) => s.id === cs.sessionId);
  if (!item) return;
  item.chat = cs.chat || [];
  item.updatedAt = Date.now();
  saveSessions(all);
}

// v0.5.ad: 流式更新 chat 数组 — 同 prefix 最后一行就地替换，否则追加
export function streamUpdateLine(chat, prefix, text) {
  const target = `${prefix} `;
  // fix: 新行开始流式前，先清掉其他行的 ▍ —— 思考(▲)→正文(●)切换时思考块不再残留闪烁光标
  for (let i = 0; i < chat.length; i++) {
    if (typeof chat[i] === "string" && chat[i].endsWith(" ▍")) {
      chat[i] = chat[i].slice(0, -2);
    }
  }
  const last = chat[chat.length - 1];
  if (last && last.startsWith(target)) {
    chat[chat.length - 1] = `${target}${text} ▍`;
  } else {
    chat.push(`${target}${text} ▍`);
  }
}

// v0.5.ak: 启动时清理空 chat + 默认标题的 session（用户点了"新建会话"但没发消息的残留）
// 保留：有 chat 内容的；或标题是用户手打的中文/英文（不是 New session/Untitled/对话 N 这种默认名）
// 额外保护：updatedAt 距离现在 > 24h 的才清掉（避免把刚 + 按钮创建的 session 也干掉）
export function cleanupEmptyDefaultSessions() {
  if (!existsSync(SESSIONS_DB)) return;
  let all;
  try {
    all = JSON.parse(readFileSync(SESSIONS_DB, "utf8"));
  } catch {
    return;
  }
  if (!Array.isArray(all) || all.length === 0) return;
  const before = all.length;
  const now = Date.now();
  const STALE_MS = 24 * 60 * 60 * 1000;
  all = all.filter((s) => {
    if (!s || !s.id) return false;
    const hasChat = Array.isArray(s.chat) && s.chat.length > 0;
    if (hasChat) return true; // 有消息就保留
    const t = (s.title || "").trim();
    // 真实标题（非默认名）也保留
    const isDefault =
      t === "New session" || t === "Untitled" || /^对话 \d+$/.test(t);
    if (!isDefault) return true;
    // 默认名 + 24h 内刚建的：保留（刚 + 按钮创建的，别误删）
    if (s.updatedAt && now - s.updatedAt < STALE_MS) return true;
    return false; // 默认名 + 老于 24h：清理
  });
  if (all.length !== before) {
    saveSessions(all);
    console.log(
      `[webui] cleanup: removed ${before - all.length} empty/default sessions, ${all.length} kept`,
    );
  }
}
