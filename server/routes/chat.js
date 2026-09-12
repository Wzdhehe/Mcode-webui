// webui/server/routes/chat.js
// POST /api/send — main chat entry
// POST /api/stop — kill running child for cid
// POST /api/cmd — webui button-driven commands

import { randomUUID } from "node:crypto";
import {
  loadSessions,
  saveSessions,
  persistCurrentChat,
} from "../lib/sessions.js";
import { pushStateFor, getActiveChild, GOAL_STATUSES } from "../lib/state-bus.js";
import { handleLocalSlash, handleCmdCommand } from "../lib/slash.js";
import { runMcodeAcp } from "../lib/mcode-acp.js";
import { collectExecResult, runMcodeExec } from "../lib/mcode-exec.js";
import { DEFAULT_MODEL } from "../lib/config.js";

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

// POST /api/send — main chat entry, fire-and-forget (response = ack; output via /api/events SSE)
export async function handleSend(req, res, ctx) {
  const cs = ctx.cs;
  const cid = ctx.cid;
  const payload = await readJson(req);
  let content = (payload.content || "").trim();
  if (!content) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "content required" }));
  }
  // v0.5.bx-13: ask_user 弹窗答案 — 不当 user message 加到 chat
  const isAskAnswer = payload.isAskAnswer === true;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true }));

  // v0.5.ai: per-cid — 操作 cs (ask 答案跳过, chat 保持干净)
  if (!isAskAnswer) {
    cs.chat = [...(cs.chat || []), `› ${content}`];
    // v0.5.bx-32: 真正发消息时记 lastUsedWorkspace — sidebar 排序时该工作区置顶
    //   之前切 session 也写,用户点 c 区对话 (不发消息) c 区就自动置顶了 — 体验不对
    //   切 session 不算发消息,所以切 session 时不写 (在 routes/sessions.js handleSwitchSession 已删)
    //   ask_user 答案不算发消息,也不写
    cs.lastUsedWorkspace = (cs.workspace && cs.workspace.dir) || null;
    pushStateFor(ctx.cid);
    persistCurrentChat(cs);
  }

  // v0.5.ak: 发首条消息时如果 cs.sessionId 为空，先建一个 webui session entry
  if (!cs.sessionId) {
    const all = loadSessions();
    const id = randomUUID();
    const item = {
      id,
      title: "New session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      chat: cs.chat || [],
    };
    all.unshift(item);
    saveSessions(all);
    cs.sessionId = id;
  }

  // Detect slash commands that we can satisfy without spawning mcode
  const slashResult = await handleLocalSlash(content, cs, cid);
  if (slashResult.handled) {
    if (slashResult.continueMcode && slashResult.rewriteContent !== undefined) {
      content = slashResult.rewriteContent;
      // fall through to mcode call
    } else {
      return;
    }
  }

  // v1.1.1: turn 运行中直接 session/prompt 会被 0.4.2 runtime 拒绝
  //   ("Session already has an active Turn. Use queue send to deliver the
  //   message after it.") — TUI 语义是运行中发消息自动排队, webui 同样处理:
  //   转入 queue (enqueue), 队列徽标经 cs.mcodeQueue + pushStateFor 亮起。
  //   enqueue 失败 (如 0.2.x 无此 RPC) 则照旧走 prompt, 让错误如实暴露。
  //   目标 session 取 cs.running.sessionId (prompt 开始即记录) 兜底
  //   cs.mcodeSessionId (session/new 一返回即赋值, 见 mcode-acp.js)。
  if (!isAskAnswer && cs.running && cs.running.active) {
    const runningSid = cs.running.sessionId || cs.mcodeSessionId;
    // session/new 尚未完成时（首个 turn 的前几秒）短暂等待 sid 就绪
    let waitSid = runningSid;
    if (!waitSid) {
      for (let i = 0; i < 20 && !waitSid; i++) {
        await new Promise((r) => setTimeout(r, 400));
        waitSid = (cs.running && cs.running.sessionId) || cs.mcodeSessionId;
      }
    }
    if (waitSid) {
      const { McodeAcpClient } = await import("../../acp.mjs");
      const client = new McodeAcpClient({ debug: false });
      let queuedOk = false;
      try {
        await client.start();
        await Promise.resolve(
          client.loadSession?.(waitSid, (cs.workspace && cs.workspace.dir) || undefined),
        ).catch(() => {});
        const q = await client.queue(waitSid, content);
        queuedOk = true;
        // v1.1.1: 服务端台账记账（queue/list 在投递后为空, 不能做徽标数据源）
        if (q && (q.itemId || q.id)) {
          cs.mcodeQueue = [
            ...(cs.mcodeQueue || []),
            { itemId: q.itemId || q.id, text: content, createdAt: Date.now() },
          ];
        } else {
          cs.mcodeQueue = [...(cs.mcodeQueue || []), { text: content, createdAt: Date.now() }];
        }
        pushStateFor(ctx.cid);
        console.log(
          `[send] turn running → auto-queued cid=${cid} sid=${waitSid} itemId=${(q && (q.itemId || q.id)) || "?"}`,
        );
      } catch (e) {
        console.warn(`[send] auto-queue failed cid=${cid}: ${e.message} — falling through to prompt`);
      } finally {
        client.stop();
      }
      if (queuedOk) return;
    }
  }

  // v0.5.ah: 走 mcode acp 协议（默认）— MCODE_USE_ACP=0 切回 mcode exec 逃生
  const modelToUse = (cs && cs.model && cs.model.name) || DEFAULT_MODEL;
  console.log(
    `[send] cid=${cid} content=${JSON.stringify(content.slice(0, 80))} model=${modelToUse} sessionId=${cs.mcodeSessionId} workspace=${(cs && cs.workspace && cs.workspace.dir) || "null"}`,
  );
  const t0 = Date.now();
  const r =
    process.env.MCODE_USE_ACP === "0"
      ? await collectExecResult(
          runMcodeExec(content, {
            label: "prompt",
            sessionId: cs.mcodeSessionId,
            model: modelToUse,
            cs,
            cid,
          }),
        )
      : await runMcodeAcp(content, {
          label: "prompt",
          sessionId: cs.mcodeSessionId,
          model: modelToUse,
          cs,
          cid,
        });
  console.log(
    `[send] result ${Date.now() - t0}ms:`,
    JSON.stringify({
      status: r.status,
      error: r.error,
      answer: r.answer && r.answer.slice(0, 80),
      sessionId: r.sessionId,
    }).slice(0, 500),
  );
  if (r.status === "succeeded" && r.answer) {
    // v0.5.bx-4: 流式输出已经在 streamAcpPrompt/streamUpdateLine 里把 ▲ 和 ● 行写进 chat 了
    const oneLine = r.answer.replace(/\n+/g, " ").trim();
    let lastAnsIdx = -1;
    for (let i = cs.chat.length - 1; i >= 0; i--) {
      if (typeof cs.chat[i] === "string" && cs.chat[i].startsWith("● ")) {
        lastAnsIdx = i;
        break;
      }
    }
    if (lastAnsIdx >= 0) {
      cs.chat[lastAnsIdx] = `● ${oneLine}`;
    } else {
      cs.chat = [...cs.chat, `● ${oneLine}`];
    }
    cs.context.assistantLast = oneLine;
    cs.context.assistantAt = Date.now();
  } else if (r.status === "failed" || r.error) {
    const rawMsg = (r.error?.message || r.status).replace(/\n+/g, " ");
    let oneLine = rawMsg;
    let hint = "";
    if (/Questionnaire|user input/i.test(rawMsg)) {
      hint = " (Ask 工具在 webui/exec 模式不可用，请直接用输入框发问)";
    } else if (/requires.*input|interactive/i.test(rawMsg)) {
      hint = " (此工具需要交互模式，webui 暂不支持)";
    }
    cs.chat = [...cs.chat, `! [error] ${oneLine}${hint}`];
    cs.context.assistantLast = `[error] ${oneLine}`;
    cs.context.assistantAt = Date.now();
  }
  persistCurrentChat(cs);
  pushStateFor(cid);
}

// POST /api/stop — 中断正在跑的 prompt
// v0.5.by: 优先走 mcode acp session/cancel RPC (温和取消 — 让 mcode 走 finalize),
//   走不通再 hard kill child process (兜底)
// v1.0.2: mcode 0.2.4 acp 真正支持 session/cancel (cli.js grep 验证), 温和路径生效
// 旧实现: 永远 child.kill() — 太粗暴,会让 mcode acp 进程直接 SIGKILL,
//   同进程里的 background task 也会被 runtime-shutdown 杀 (子 agent 跑不完的根因之一)
export async function handleStop(_req, res, ctx) {
  const cid = ctx.cid;
  const cs = ctx.cs;
  const child = getActiveChild(cid);
  const wasRunning = !!child;
  let cancelled = false;
  let hardKilled = false;
  // 1. 温和路径: 调 mcode acp session/cancel RPC
  //    v1.0.2 改用真 McodeAcpClient (acp.mjs) 替代 mcode-rpc.js 的 UNSUPPORTED 占位
  //    mcode 0.2.4 acp 真正支持 session/cancel (cli.js grep 验证)
  if (cs && cs.mcodeSessionId) {
    try {
      const { McodeAcpClient } = await import("../../acp.mjs");
      const client = new McodeAcpClient({ debug: false });
      try {
        await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
          // v1.1: mcode 0.3+ 没有 session/cancel — acp.mjs 内部回退到
        // close + load；cwd 必须给对，否则 load 挂错工作区
        await client.cancel(
          cs.mcodeSessionId,
          (cs.workspace && cs.workspace.dir) || undefined,
        );
        cancelled = true;
        console.log(`[stop] session/cancel OK cid=${cid} mvsId=${cs.mcodeSessionId}`);
      } finally {
        client.stop();
      }
    } catch (e) {
      // 真错 (mcode 0.2.4 应该支持, 任何失败都记下来排查)
      console.warn(
        `[stop] session/cancel failed cid=${cid} mvsId=${cs.mcodeSessionId}: ${e.message}`,
      );
    }
  }
  // 2. 兜底路径: hard kill child (RPC 不支持或失败)
  if (child && !cancelled) {
    try {
      child.kill();
    } catch {}
    hardKilled = true;
  }
  // 3. 兜底路径 2: 设个 2s timeout, 如果 mcode acp 没通过 cancel 退出, 也强 kill
  //    (避免 mcode 还在 prompt 不响应时 webui 显示 "已停止" 但实际还在跑)
  //    缓存 child.child 引用, 因为 2s 后 child.stop() 可能已经把它置 null
  if (child) {
    const rawChild = child.child; // 缓存 node child_process 实例
    setTimeout(() => {
      try {
        if (rawChild && !rawChild.killed && rawChild.exitCode === null) {
          console.log(
            `[stop] cid=${cid} child still alive 2s after stop, force-killing`,
          );
          child.kill();
        }
      } catch {}
    }, 2000).unref();
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  return res.end(
    JSON.stringify({
      ok: true,
      wasRunning,
      cancelled,
      hardKilled,
      note: cancelled
        ? "gentle cancel"
        : "hard kill (mcode 0.1.5 acp 不支持 session/cancel)",
    }),
  );
}

// POST /api/cmd — webui button-driven commands
export async function handleCmd(req, res, ctx) {
  const cs = ctx.cs;
  const cid = ctx.cid;
  const payload = await readJson(req);
  const cmd = (payload.cmd || "").trim();
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true }));
  await handleCmdCommand(cmd, cs, cid);
}

// --- v1.0.2: mcode 0.2.4 control surface handlers ---

// POST /api/chat/queue — 排队一条消息 (LLM 响应进行中)
//   body: { text: string }
//   调 mcode acp session/queue RPC
export async function handleQueue(req, res, ctx) {
  const cs = ctx.cs;
  const payload = await readJson(req);
  const text = (payload.text || "").trim();
  if (!text) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "text required" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "no active mcode session" }),
    );
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      const r = await client.queue(cs.mcodeSessionId, text);
    // v1.1.1: 0.4.2 的 queue 是"当前 turn 结束后自动投递"语义, enqueue 后
    // queue/list 立即变空 — 队列徽标的数据源改用服务端台账 (finalize 时
    // 用 queue/list 对账清零), 不依赖 client 端的 refreshQueueList
    if (r && (r.itemId || r.id)) {
      cs.mcodeQueue = [
        ...(cs.mcodeQueue || []),
        { itemId: r.itemId || r.id, text, createdAt: Date.now() },
      ];
      pushStateFor(ctx.cid);
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, item: r || null }));
  } catch (e) {
    console.warn(`[chat.queue] cid=${ctx.cid} error: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// GET /api/chat/queue — 队列快照
//   v1.1.1: 数据源为服务端台账 cs.mcodeQueue（0.4.2 的 queue/list 在条目
//   入队后即进入投递管线返回 []，不能做徽标数据源；台账也免去每次拉取
//   新起 acp 进程的开销）
export async function handleQueueList(req, res, ctx) {
  const cs = ctx.cs;
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "no active mcode session" }));
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, items: cs.mcodeQueue || [] }));
}

export async function handleConfigOptions(req, res, ctx) {
  const cs = ctx.cs;
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "no active mcode session" }));
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      const cwd = (cs.workspace && cs.workspace.dir) || undefined;
    await client.loadSession(cs.mcodeSessionId, cwd);
    const configOptions = client.getSessionConfigOptions(cs.mcodeSessionId) || [];
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, configOptions }));
  } catch (e) {
    console.warn(`[chat.configOptions] cid=${ctx.cid} error: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// POST /api/chat/queue/update — 改写队列里某条
//   body: { itemId, text }
export async function handleQueueUpdate(req, res, ctx) {
  const cs = ctx.cs;
  const payload = await readJson(req);
  const itemId = payload.itemId;
  const text = (payload.text || "").trim();
  if (!itemId || !text) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "itemId and text required" }),
    );
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "no active mcode session" }),
    );
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      const r = await client.queueUpdate(cs.mcodeSessionId, itemId, text);
    // v1.1.1: 服务端台账同步改写 + 推送
    cs.mcodeQueue = (cs.mcodeQueue || []).map((it) =>
      it.itemId === itemId ? { ...it, text } : it,
    );
    pushStateFor(ctx.cid);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, item: r || null }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// POST /api/chat/queue/delete — 从队列删一条
//   body: { itemId }
export async function handleQueueDelete(req, res, ctx) {
  const cs = ctx.cs;
  const payload = await readJson(req);
  const itemId = payload.itemId;
  if (!itemId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "itemId required" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "no active mcode session" }),
    );
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      await client.queueDelete(cs.mcodeSessionId, itemId);
    // v1.1.1: 服务端台账同步移除 + 推送（徽标即时减少）
    cs.mcodeQueue = (cs.mcodeQueue || []).filter((it) => it.itemId !== itemId);
    pushStateFor(ctx.cid);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// POST /api/chat/steer — 引导当前 turn (不打断)
//   body: { text }
export async function handleSteer(req, res, ctx) {
  const cs = ctx.cs;
  const payload = await readJson(req);
  const itemId = payload.itemId;
  let text = (payload.text || "").trim();
  // v1.1.1: 队列条目引导 — itemId 来源时从台账取文案，消费后移除
  if (!text && itemId) {
    const item = (cs.mcodeQueue || []).find((it) => it.itemId === itemId);
    text = ((item && item.text) || "").trim();
  }
  if (!text) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "text required" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "no active mcode session" }),
    );
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      await client.steer(cs.mcodeSessionId, text);
    // 记录 steer 事件到 cs (环形 buffer 20 条)
    const { broadcastSteered } = await import("../lib/state-bus.js");
    broadcastSteered(ctx.cid, {
      itemId: `steer-${Date.now()}`,
      originalText: itemId ? (cs.mcodeQueue || []).find((it) => it.itemId === itemId)?.text || "(queued item)" : "(current turn)",
      steeredText: text,
      at: Date.now(),
    });
    if (itemId) {
      cs.mcodeQueue = (cs.mcodeQueue || []).filter((it) => it.itemId !== itemId);
      pushStateFor(ctx.cid);
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// POST /api/chat/mode — 切 session 模式 (plan / default / acceptEdits / bypassPermissions)
export async function handleSetMode(req, res, ctx) {
  const cs = ctx.cs;
  const payload = await readJson(req);
  const mode = (payload.mode || "").trim();
  if (!mode) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "mode required" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "no active mcode session" }),
    );
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      await client.setMode(cs.mcodeSessionId, mode);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, mode }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// POST /api/chat/config-option — 改 session config (e.g. model)
//   body: { key, value }
export async function handleSetConfigOption(req, res, ctx) {
  const cs = ctx.cs;
  const payload = await readJson(req);
  const key = (payload.key || "").trim();
  const value = payload.value;
  if (!key) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "key required" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: false, error: "no active mcode session" }),
    );
  }
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      await client.setConfigOption(cs.mcodeSessionId, key, value);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, key, value }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    client.stop();
  }
}

// v1.0.2 Round 6: Goal 4 个 endpoint
//   POST /api/chat/goal        body: { objective, tokenBudget? }  → 创建
//   PATCH /api/chat/goal       body: { status?, objective?, tokenBudget? }  → 改
//   DELETE /api/chat/goal      body: {}  → 清空
//   GET /api/chat/goal         返回当前 goal
// 5 状态 enum (state-bus.GOAL_STATUSES) 校验 status 输入

async function withMcodeSession(cs, fn) {
  const { McodeAcpClient } = await import("../../acp.mjs");
  const client = new McodeAcpClient({ debug: false });
  try {
    await client.start();

        // v1.1: 0.4.2 ACP 会话是进程域的 — fresh client 必须先 load 才能
        // 操作 session（否则 goal/queue/mode/close 全部 Resource not found）
        if (cs.mcodeSessionId) {
          await Promise.resolve(client.loadSession?.(cs.mcodeSessionId, (cs.workspace && cs.workspace.dir) || undefined)).catch(() => {});
        }
      return await fn(client);
  } finally {
    client.stop();
  }
}

// POST /api/chat/goal — 创建
export async function handleGoalCreate(req, res, ctx) {
  const cs = ctx.cs;
  const cid = ctx.cid;
  const payload = await readJson(req);
  const objective = (payload.objective || "").trim();
  const tokenBudget = payload.tokenBudget;
  if (!objective) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "objective required" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "no active mcode session" }));
  }
  try {
    const r = await withMcodeSession(cs, (client) =>
      client.goalCreate(cs.mcodeSessionId, objective, tokenBudget),
    );
    // r 是 { goal: {...} } 形式, 取出 goal
    const goal = r && r.goal ? r.goal : r;
    // 立即 broadcast 给同 session 的所有 cid
    const { broadcastGoalUpdate } = await import("../lib/state-bus.js");
    broadcastGoalUpdate(cid, goal);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, goal }));
  } catch (e) {
    console.warn(`[chat.goal.create] cid=${cid} error: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

// PATCH /api/chat/goal — 改 status / objective / tokenBudget
export async function handleGoalPatch(req, res, ctx) {
  const cs = ctx.cs;
  const cid = ctx.cid;
  const payload = await readJson(req);
  const fields = {};
  if (payload.status !== undefined) {
    if (!GOAL_STATUSES.has(payload.status)) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: false,
        error: `status must be one of ${[...GOAL_STATUSES].join(", ")}`,
      }));
    }
    fields.status = payload.status;
  }
  if (payload.objective !== undefined) fields.objective = String(payload.objective).trim();
  if (payload.tokenBudget !== undefined) fields.tokenBudget = payload.tokenBudget;
  if (Object.keys(fields).length === 0) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "no fields to patch" }));
  }
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "no active mcode session" }));
  }
  try {
    const r = await withMcodeSession(cs, (client) =>
      client.goalPatch(cs.mcodeSessionId, fields),
    );
    const goal = r && r.goal ? r.goal : r;
    const { broadcastGoalUpdate } = await import("../lib/state-bus.js");
    broadcastGoalUpdate(cid, goal);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, goal }));
  } catch (e) {
    console.warn(`[chat.goal.patch] cid=${cid} error: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

// DELETE /api/chat/goal — 清空
export async function handleGoalClear(req, res, ctx) {
  const cs = ctx.cs;
  const cid = ctx.cid;
  if (!cs.mcodeSessionId) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "no active mcode session" }));
  }
  try {
    await withMcodeSession(cs, (client) =>
      client.goalClear(cs.mcodeSessionId),
    );
    // 清空时 cs.goalBudget 设为 null
    const { broadcastGoalUpdate } = await import("../lib/state-bus.js");
    broadcastGoalUpdate(cid, null);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, cleared: true }));
  } catch (e) {
    console.warn(`[chat.goal.clear] cid=${cid} error: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

// GET /api/chat/goal — 拿当前 goal
export async function handleGoalGet(req, res, ctx) {
  const cs = ctx.cs;
  if (!cs.mcodeSessionId) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, goal: null, reason: "no active mcode session" }));
  }
  try {
    const r = await withMcodeSession(cs, (client) =>
      client.goalGet(cs.mcodeSessionId),
    );
    const goal = r && r.goal !== undefined ? r.goal : r;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, goal: goal || null }));
  } catch (e) {
    console.warn(`[chat.goal.get] cid=${ctx.cid} error: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}
