// webui/server/routes/upload.js
// POST /api/upload — multipart file save

import { saveMultipartUpload } from "../lib/upload.js";
import { pushAlert } from "../lib/alerts.js";
// B01: append-only audit for upload events. We log the saved file's
// basename (not full path — that leaks the absolute upload dir, which
// is implementation detail), original filename, and the mtime-derived
// saved name. We never log file content (binary, large, sensitive).
// Write-ahead (2026-09-20 rigor fix): an intent line lands BEFORE
// saveMultipartUpload() writes the file; the outcome upload.create
// line lands after. Both fail closed — 5xx + alert, no silent gap.
import { append as _eventsAppend } from "../lib/events.js";
import { basename } from "node:path";

// _auditFail — mirror of routes/sessions.js#_auditFail: HTTP 5xx +
// one alert on the anomaly channel.
function _auditFail(res, e, what) {
  try {
    pushAlert({
      level: "error",
      msg: `audit write failed (${what}): ${e && e.message ? e.message : String(e)}`,
      src: "upload",
    });
  } catch {}
  console.error(`[webui] audit write failed (${what}):`, e);
  if (res && !res.headersSent) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: false,
      error: "audit write failed",
      detail: what,
    }));
  }
  return undefined;
}

export async function handleUpload(req, res, _ctx) {
  const ctype = (req.headers["content-type"] || "").toLowerCase();
  if (!ctype.startsWith("multipart/form-data")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "multipart required" }));
  }
  // Write-ahead intent: record that an upload is about to persist a
  // file BEFORE the multipart body is parsed + written. Failure →
  // 5xx + alert with nothing on disk.
  try {
    _eventsAppend("upload.create.intent", {
      target: "",
      cid: (_ctx && _ctx.cid) || "",
      actor: "user",
      payload: {
        contentType: ctype.slice(0, 128),
      },
    });
  } catch (e) {
    return _auditFail(res, e, "upload.create.intent");
  }
  try {
    const saved = await saveMultipartUpload(req);
    // B01: record successful upload. We use basename(saved.path) — the
    // full path is implementation detail; the basename is enough to
    // identify the file. Size is unknown here (saveMultipartUpload
    // doesn't return it) — left null for a future patch to populate
    // once we add size to the helper.
    try {
      _eventsAppend("upload.create", {
        target: saved.name,
        cid: (_ctx && _ctx.cid) || "",
        actor: "user",
        payload: {
          path: basename(saved.path),
          originalName: saved.name,
        },
      });
    } catch (e) {
      // Outcome failure — file already landed on disk. 5xx + alert so
      // the operator sees the unaudited artifact instead of a 200.
      return _auditFail(res, e, "upload.create");
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({ ok: true, path: saved.path, name: saved.name }),
    );
  } catch (e) {
    // B01: record failed upload too — the failure pattern is useful
    // diagnostic (e.g. "user keeps sending corrupted multipart" surfaces
    // as a stream of upload.fail events). This is a diagnostics line,
    // not an enforcement line: loud-continue to the existing 500 below
    // (do not touch `res` here — the 500 write immediately after owns
    // the response).
    try {
      _eventsAppend("upload.fail", {
        cid: (_ctx && _ctx.cid) || "",
        actor: "user",
        payload: { error: e.message },
      });
    } catch (auditErr) {
      try {
        pushAlert({
          level: "error",
          msg: `audit write failed (upload.fail): ${auditErr.message}`,
          src: "upload",
        });
      } catch {}
      console.error("[webui] audit write failed (upload.fail):", auditErr);
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}
