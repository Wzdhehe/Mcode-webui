// webui/server/routes/workspace.js
// POST /api/workspace, GET /api/workspace/browse
// v1.2 (feat-workspace-lhl): + GET /api/workspace/tree（工作区→会话树，sessions
//   store 分组）+ GET /api/workspace/resolve（文件夹名 → 绝对路径候选）

import { basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  handleWorkspaceChange,
  browseWorkspace,
  resolveWorkspaceCandidates,
} from "../lib/workspace.js";
import { DEFAULT_WORKSPACE } from "../lib/config.js";
import { loadSessions } from "../lib/sessions.js";

export async function handleWorkspace(req, res, ctx) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    payload = {};
  }
  const result = handleWorkspaceChange(ctx.cs, ctx.cid, payload);
  res.writeHead(
    result.ok
      ? 200
      : result.error && result.error.includes("不存在")
        ? 400
        : 200,
    { "Content-Type": "application/json; charset=utf-8" },
  );
  return res.end(JSON.stringify(result));
}

export function handleWorkspaceBrowse(req, res, _ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.searchParams.get("path");
  const result = browseWorkspace(rawPath);
  res.writeHead(result.ok ? 200 : 400, {
    "Content-Type": "application/json; charset=utf-8",
  });
  return res.end(JSON.stringify(result));
}

// v1.2 (feat-workspace-lhl): GET /api/workspace/tree
//   工作区→会话树形结构（webui sessions store 按 workspace 分组）。
//   chip 锚定下拉 / Switch Workspace 弹层的工作区下拉都用它。
//   响应: { ok, current, defaultWorkspace, home, tmpDir, platform,
//           workspaces: [{ dir, name, sessionCount, lastActiveAt, current, sessions[] }] }
export function handleWorkspaceTree(req, res, ctx) {
  const current = (ctx.cs && ctx.cs.workspace && ctx.cs.workspace.dir) || "";
  const all = loadSessions();
  const groups = new Map();
  for (const s of all) {
    const ws = (s.workspace || "").trim();
    if (!ws) continue; // 无工作区的旧 session 不分组
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws).push({
      id: s.id,
      mcodeSessionId: s.mcodeSessionId || null,
      title: s.title || "Untitled",
      updatedAt: s.updatedAt || s.createdAt || 0,
    });
  }
  const workspaces = [...groups.entries()].map(([dir, sessions]) => {
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      dir,
      name: basename(dir) || dir,
      sessionCount: sessions.length,
      lastActiveAt: sessions[0] ? sessions[0].updatedAt : 0,
      current: dir === current,
      sessions,
    };
  });
  // 当前工作区即使还没有任何 session 也出现在树顶（新建会话最常选它）
  if (current && !groups.has(current)) {
    workspaces.unshift({
      dir: current,
      name: basename(current) || current,
      sessionCount: 0,
      lastActiveAt: 0,
      current: true,
      sessions: [],
    });
  }
  workspaces.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.lastActiveAt - a.lastActiveAt;
  });
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  return res.end(
    JSON.stringify({
      ok: true,
      current,
      defaultWorkspace: DEFAULT_WORKSPACE,
      home: homedir(),
      // 「无需工作空间」按钮用: linux /tmp, macOS /var/folders/..., win32 %TEMP%
      tmpDir: tmpdir(),
      platform: process.platform,
      workspaces,
    }),
  );
}

// v1.2 (feat-workspace-lhl): GET /api/workspace/resolve?name=<folder-name>
//   零弹窗目录选择（webkitdirectory input）只给前端返回文件夹名，不出绝对路径。
//   server 与浏览器同机，这里按名字在常见根目录里搜候选绝对路径，交给用户确认。
export function handleWorkspaceResolve(req, res, _ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = url.searchParams.get("name") || "";
  const result = resolveWorkspaceCandidates(name);
  res.writeHead(result.ok ? 200 : 400, {
    "Content-Type": "application/json; charset=utf-8",
  });
  return res.end(JSON.stringify(result));
}
