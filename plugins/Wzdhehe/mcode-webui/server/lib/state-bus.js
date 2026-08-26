// webui/server/lib/state-bus.js
// Per-cid state + SSE channel management.

import { DEFAULT_WORKSPACE, DEFAULT_MODEL } from "./config.js";
import { loadSessions } from "./sessions.js";
import {
  getCachedMcodeCommands,
  getMcodeSessionsForWorkspace,
  getMcodeSessionsCacheSync,
  getMcodeSessionsStaleSync,
} from "./acp-client.js";
import {
  getCurrentToken,
  getLanBroadcast,
  getReadOnly,
  getTokenAcknowledged,
  getTokenEnabled,
  getTokenRotatedAt,
} from "./settings.js";

// v0.5.ai: A2 per-client 架构
// 每个 webui tab 一个 client (cid = localStorage webui_cid)
// 每个 client 独立：state (chat/mcodeSessionId/context/usage/running), activeChild, SSE connection
// 缺 cid 的请求 fallback 到 'default' client (兼容老 client)

// v0.5.ai: 每个 webui tab 一个独立 state。
export function makeClientState() {
  return {
    version: "1.0", // v1.0: 首次公开发布版本 (顶栏显示 "v" + version)
    workspace: { dir: DEFAULT_WORKSPACE, branch: null, tree: null }, // v0.5.bb: 默认 null（之前是 MCODE_ROOT）
    model: { name: DEFAULT_MODEL, thinking: "On", ctx: "512k" },
    sessionId: null, // webui 侧边栏 session id (randomUUID)
    mcodeSessionId: null, // mcode acp/exec 自己的 session id (mvs_xxx)
    sessionTitle: "Untitled",
    // v0.5.bx-31: "最近 active session 所属工作区" — 独立于 state.workspace.dir
    //   之前切 session 会同步改 state.workspace.dir (v0.5.ar),导致 sidebar 排序时该工作区组永远置顶
    //   现在切 session 改 lastUsedWorkspace,不再动 workspace.dir (chip-workspace 跟它无关)
    lastUsedWorkspace: null,
    context: {
      tokens: 0,
      used: 0,
      percent: 0,
      limit: 512000,
      tps: 0,
      thinkingStatus: "Idle",
      thinkingDuration: null,
      lastUsageAt: null,
    },
    usage: {
      plan: null,
      expires: null,
      credits: null,
      fiveHourPercent: null,
      fiveHourReset: null,
      weekly: null,
      sessionInput: 0,
      sessionOutput: 0,
      sessionTotal: 0,
      raw: null,
      fetchedAt: null,
      error: null,
    },
    permissions: "Full access",
    chat: [],
    sessions: [],
    goal: { active: false, text: null, status: null, duration: null },
    todo: [],
    ask: {
      active: false,
      total: 0,
      answered: 0,
      currentIdx: 0,
      question: "",
      options: [],
    },
    plan: { active: false, title: null, summary: "", options: [] },
    running: {
      active: false,
      prompt: null,
      pid: null,
      startedAt: null,
      model: null,
      sessionId: null,
      lastDeltaAt: null,
      tps: 0,
    },
    // v1.0.2: mcode 0.2.4 control surface 字段 (per-cid 镜像, 不持久化)
    mcodeQueue: [],          // [{ itemId, text, createdAt }] — LLM 响应中排队的消息
    mcodeForks: [],          // [{ forkId, atMessageId, createdAt, title }] — 最近 5 条 fork
    mcodeSteers: [],         // [{ itemId, originalText, steeredText, at }] — 最近 20 条 steer
    goalBudget: null,        // { used, total, status: 'active'|'paused'|'blocked'|'complete'|'budget_limited' }
    activeDelegations: [],   // [{ delegationId, agent, status, ... }] — 子任务快照
    skills: [],              // [{ name, description, source }] — Round 7 用, 先占位
    runtimeReady: false,     // v1.0.2: mcode acp initialize 完成前 false, 客户端据此禁用 send
  };
}

export const clients = new Map(); // cid -> clientState
export const sseByCid = new Map(); // cid -> SSE response
export const activeChildByCid = new Map(); // cid -> child process

// v1.0.2 Round 6: Goal 5 状态 enum (cli.js bundle grep 验证)
//   跟 mcode runtime 内部 enum 一致; 客户端用这个 set 做输入校验 + UI 映射
export const GOAL_STATUSES = new Set([
  "active",          // 进行中
  "paused",          // 暂停
  "blocked",         // 阻塞 (依赖外部输入)
  "complete",        // 完成
  "budget_limited",  // 预算用尽
])

export function getClient(cid) {
  if (!cid) cid = "default";
  if (!clients.has(cid)) clients.set(cid, makeClientState());
  return clients.get(cid);
}

export function getCidFromReq(req) {
  try {
    const u = new URL(req.url, "http://x");
    return u.searchParams.get("cid") || "";
  } catch {
    return "";
  }
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// pushStateFor: 推 state 给指定 cid（或 '__broadcast__' 推给所有）
//   opts.lanBroadcast: 当前 LAN 广播状态（从 settings.js 注入）
//   opts.mcodeSessions: 已过滤的 mcode sessions 数组（从 acp-client.js 注入）
// v0.5.bx-31: cache miss 时 fire-and-forget 拉一次, 拉完自动 push 给所有 SSE 客户端
// v1.0: 推送带 mcodeSessionsPending 标记 — 占位推送 (cache miss 空数组) 为 true, 权威推送为 false;
//   fetch 失败也要推终态 (否则 client 侧栏 ready 门控永远等不到权威值, loading 卡死)
const _mcodeSessionsFetchPending = new Set(); // workspace keys currently being fetched
function ensureMcodeSessionsFetchedAndPush(workspace) {
  if (_mcodeSessionsFetchPending.has(workspace)) return;
  _mcodeSessionsFetchPending.add(workspace);
  const pushAuthoritative = () => {
    for (const [c, res] of sseByCid) {
        const ccs = clients.get(c) || makeClientState();
        const cws = (ccs.workspace && ccs.workspace.dir) || "";
        // v1.0: 权威推送优先 fresh cache, 退而求其次 stale (同 ws 过期列表), 避免空列表闪跌
        const cached =
          getMcodeSessionsCacheSync(cws) ??
          getMcodeSessionsStaleSync(cws) ??
          [];
      const snapshot = {
        ...ccs,
        sessions: loadSessions(),
        mcodeSessions: cached,
        mcodeSessionsPending: false,
        availableCommands: getCachedMcodeCommands(),
        onlineCount: sseByCid.size,
        lanBroadcast: getLanBroadcast(),
        readOnly: getReadOnly(),
        tokenEnabled: getTokenEnabled(),
        // v1.0.1: 下发 currentToken 仅在未 acknowledge 时 (减少密钥暴露窗口)
        currentToken: getTokenAcknowledged() ? "" : getCurrentToken(),
        tokenAcknowledged: getTokenAcknowledged(),
        tokenRotatedAt: getTokenRotatedAt(),
      };
      try {
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } catch {}
    }
  };
  getMcodeSessionsForWorkspace(workspace)
    .then(() => {
      _mcodeSessionsFetchPending.delete(workspace);
      pushAuthoritative();
    })
    .catch((e) => {
      _mcodeSessionsFetchPending.delete(workspace);
      console.warn(
        `[webui] ensureMcodeSessionsFetchedAndPush failed: ${e.message}`,
      );
      pushAuthoritative(); // v1.0: 失败也推终态 (用当前 cache 值, 可能是空数组 — 合法)
    });
}

export function pushStateFor(cid, opts = {}) {
  const lanBroadcast =
    opts.lanBroadcast !== undefined ? opts.lanBroadcast : getLanBroadcast();
  const cachedCmds = getCachedMcodeCommands();

  if (cid === "__broadcast__") {
    for (const [c, res] of sseByCid) {
      const ccs = clients.get(c) || makeClientState();
      const cws = (ccs.workspace && ccs.workspace.dir) || "";
      const fields =
        opts.mcodeSessions !== undefined
          ? { mcodeSessions: opts.mcodeSessions, mcodeSessionsPending: false }
          : mcodeSessionsSnapshotFields(cws);
      const snapshot = {
        ...ccs,
        sessions: loadSessions(),
        ...fields,
        availableCommands: cachedCmds,
        onlineCount: sseByCid.size,
        lanBroadcast,
        readOnly: getReadOnly(),
        tokenEnabled: getTokenEnabled(),
        currentToken: getTokenAcknowledged() ? "" : getCurrentToken(),
        tokenAcknowledged: getTokenAcknowledged(),
        tokenRotatedAt: getTokenRotatedAt(),
      };
      try {
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } catch {}
    }
    return;
  }
  const cs = getClient(cid);
  // v1.0: 统一走 mcodeSessionsSnapshotFields — 过期缓存推旧值 (pending=true), 不推空占位
  const fields =
    opts.mcodeSessions !== undefined
      ? { mcodeSessions: opts.mcodeSessions, mcodeSessionsPending: false }
      : mcodeSessionsSnapshotFields((cs.workspace && cs.workspace.dir) || "");
  // 注入 sessions 列表（来自磁盘 db）— 让 webui 侧边栏 "最近会话" 不被 SSE 推送覆盖
  // v0.5.bv: 同步带 mcodeSessions（cache 命中，0 cost；cache miss 才 await）
  const snapshot = {
    ...cs,
    sessions: loadSessions(),
    ...fields,
    availableCommands: cachedCmds,
    onlineCount: sseByCid.size,
    lanBroadcast,
    readOnly: getReadOnly(),
    tokenEnabled: getTokenEnabled(),
    currentToken: getTokenAcknowledged() ? "" : getCurrentToken(),
    tokenAcknowledged: getTokenAcknowledged(),
    tokenRotatedAt: getTokenRotatedAt(),
  };
  const payload = JSON.stringify(snapshot);
  const res = sseByCid.get(cid);
  if (res) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {}
  }
}

// v1.0: 统一的 mcodeSessions 快照字段构造 — 所有 SSE 推送点必须带这两个字段。
//   之前 pushOnlineCount / SSE 首推不带, 客户端整包替换 state 后 mcodeSessions 变 undefined,
//   侧栏随机从 ~36 条闪跌到 ~16 条 (只剩 webui 本地条目), 下次完整推送又弹回。
//   v1.0 (改): 缓存过期但同 workspace 时推过期列表 (pending=true), 不再推空占位 —
//   过期值好过空值, 权威值到达前侧栏不闪跌
export function mcodeSessionsSnapshotFields(workspace) {
  const ws = workspace || "";
  const cached = getMcodeSessionsCacheSync(ws);
  if (cached !== null) {
    return { mcodeSessions: cached, mcodeSessionsPending: false };
  }
  ensureMcodeSessionsFetchedAndPush(ws);
  const stale = getMcodeSessionsStaleSync(ws);
  if (stale !== null) {
    return { mcodeSessions: stale, mcodeSessionsPending: true };
  }
  return { mcodeSessions: [], mcodeSessionsPending: true };
}

// v0.5.ak: SSE 客户端数变化时广播（让所有 tab 实时看到 onlineCount）
export function pushOnlineCount(lanBroadcast) {
  const cachedCmds = getCachedMcodeCommands();
  for (const [c, res] of sseByCid) {
    const cs = clients.get(c) || makeClientState();
    const snapshot = {
      ...cs,
      sessions: loadSessions(),
      ...mcodeSessionsSnapshotFields((cs.workspace && cs.workspace.dir) || ""),
      availableCommands: cachedCmds,
      onlineCount: sseByCid.size,
      lanBroadcast,
      readOnly: getReadOnly(),
      tokenEnabled: getTokenEnabled(),
      currentToken: getTokenAcknowledged() ? "" : getCurrentToken(),
      tokenAcknowledged: getTokenAcknowledged(),
      tokenRotatedAt: getTokenRotatedAt(),
    };
    try {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch {}
  }
}

// 把当前 cid 的 child 设为 active（acp client / exec child 都用同一个 map）
export function setActiveChild(cid, child) {
  if (cid) activeChildByCid.set(cid, child);
}

export function getActiveChild(cid) {
  return activeChildByCid.get(cid) || null;
}

export function clearActiveChild(cid) {
  if (cid) activeChildByCid.delete(cid);
}

// v0.5.bx-29: 找出所有绑定了同一个 mcodeSessionId 的 cid
//   用于 mavis db 真值更新后, 通知其它同 session 的 cid (手机 + 电脑开同一 session)
//   返回 [{cid, cs}, ...] 数组
export function getCidsByMcodeSession(mvsSessionId) {
  if (!mvsSessionId) return [];
  const out = [];
  for (const [cid, cs] of clients) {
    if (cs && cs.mcodeSessionId === mvsSessionId) {
      out.push({ cid, cs });
    }
  }
  return out;
}

// SSE channel helpers — only state-bus.js should touch sseByCid directly.
export function getSseClient(cid) {
  return sseByCid.get(cid) || null;
}

export function setSseClient(cid, res) {
  sseByCid.set(cid, res);
}

export function endSseClient(cid, res) {
  // Only clear the map entry if it still points at the same res (avoid races)
  if (sseByCid.get(cid) === res) sseByCid.delete(cid);
}

// v1.0.1: broadcastTokenRotated — push a named SSE event so all
// already-authenticated clients can update their HEADERS + localStorage
// without waiting for the periodic state push. Body is the new token
// (raw string, not JSON, to make it obvious in logs / devtools that
// this is sensitive — never log it).
//
// IMPORTANT: the token is sent in cleartext over the SSE channel. The
// connection is already authenticated (caller must have presented a
// valid token to reach the rotation handler), and SSE is in-band
// with the existing /api/events stream which the client already
// authorized. So this is no worse than the periodic state push that
// also includes currentToken in the same channel.
export function broadcastTokenRotated(token) {
  if (!token) return;
  // SSE custom event format:
  //   event: <name>\n
  //   data: <payload>\n
  //   \n
  const frame = `event: auth.token_rotated\ndata: ${token}\n\n`;
  for (const [, res] of sseByCid) {
    try {
      res.write(frame);
    } catch {}
  }
}

// --- v1.0.2: mcode 0.2.4 control surface broadcasts ---
// 状态归属 (per plan.md "状态归属" 节): mcode session 级别事件通过 mcodeSessionId 维度
// 广播给所有同 session 的 cid; UI 偏好事件只推当前 cid。

// 推 mcodeQueue 更新 (mcode 队列变化时调)
// 更新指定 cid 的 cs.mcodeQueue, 同时通知所有共享同一 mcodeSessionId 的 cid
export function broadcastQueueUpdate(cid, items) {
  const cs = getClient(cid);
  cs.mcodeQueue = Array.isArray(items) ? items : [];
  const mvsId = cs.mcodeSessionId;
  if (mvsId) {
    // 通知所有共享 mvsId 的 cid
    const peers = getCidsByMcodeSession(mvsId);
    for (const { cid: peerCid } of peers) {
      pushStateFor(peerCid);
    }
  } else {
    pushStateFor(cid);
  }
}

// 推 mcodeForks 更新 (fork 完成后调, 保留最近 5 条)
export function broadcastForked(cid, fork) {
  const cs = getClient(cid);
  const forks = Array.isArray(cs.mcodeForks) ? cs.mcodeForks.slice() : [];
  forks.unshift(fork);
  cs.mcodeForks = forks.slice(0, 5); // 环形 buffer: 保留最近 5
  pushStateFor(cid);
}

// 推 mcodeSteers 更新 (steer 触发后调, 保留最近 20 条)
export function broadcastSteered(cid, item) {
  const cs = getClient(cid);
  const steers = Array.isArray(cs.mcodeSteers) ? cs.mcodeSteers.slice() : [];
  steers.unshift(item);
  cs.mcodeSteers = steers.slice(0, 20); // 环形 buffer: 保留最近 20
  const mvsId = cs.mcodeSessionId;
  if (mvsId) {
    const peers = getCidsByMcodeSession(mvsId);
    for (const { cid: peerCid } of peers) {
      pushStateFor(peerCid);
    }
  } else {
    pushStateFor(cid);
  }
}

// 推 goalBudget 更新 (mcode goal_update 通知时调)
export function broadcastGoalUpdate(cid, goal) {
  const cs = getClient(cid);
  cs.goalBudget = goal || null;
  const mvsId = cs.mcodeSessionId;
  if (mvsId) {
    const peers = getCidsByMcodeSession(mvsId);
    for (const { cid: peerCid } of peers) {
      pushStateFor(peerCid);
    }
  } else {
    pushStateFor(cid);
  }
}

// 推 activeDelegations 更新 (mcode delegation_update 通知时调)
export function broadcastDelegationUpdate(cid, delegations) {
  const cs = getClient(cid);
  cs.activeDelegations = Array.isArray(delegations) ? delegations : [];
  const mvsId = cs.mcodeSessionId;
  if (mvsId) {
    const peers = getCidsByMcodeSession(mvsId);
    for (const { cid: peerCid } of peers) {
      pushStateFor(peerCid);
    }
  } else {
    pushStateFor(cid);
  }
}

// 推 currentSessionUpdate (mcode session 切换通知)
export function broadcastCurrentSessionUpdate(cid, info) {
  const cs = getClient(cid);
  if (info && info.mcodeSessionId) {
    cs.mcodeSessionId = info.mcodeSessionId;
  }
  if (info && info.title) {
    cs.sessionTitle = info.title;
  }
  const mvsId = cs.mcodeSessionId;
  if (mvsId) {
    const peers = getCidsByMcodeSession(mvsId);
    for (const { cid: peerCid } of peers) {
      pushStateFor(peerCid);
    }
  } else {
    pushStateFor(cid);
  }
}
