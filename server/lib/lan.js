// webui/server/lib/lan.js
// LAN IP detection + local request check + interface allowlist.
//
// v0.5.ap: detectLanIp / isLocalRequest / LAN_IP
// v1.0.1: getAllNetworkInterfaces / isInterfaceAllowed for the settings
//   card's "allowed interfaces" checklist. Interface list is captured at
//   module load (matches the LAN_IP behavior — restarting picks up new
//   network interfaces).

import { networkInterfaces } from "node:os";

// 检测本机局域网 IPv4（取第一个非 internal 的 IPv4）
export function detectLanIp() {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "127.0.0.1";
}

export const LAN_IP = detectLanIp();

// Snapshot at module load (used for the settings card UI + interface
// allowlist filtering). Restart picks up newly-added interfaces.
const _IFACES_SNAPSHOT = networkInterfaces();

// 判断请求是否来自本机（IPv4 / IPv6 loopback）
export function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === LAN_IP
  );
}

// getAllNetworkInterfaces — list every non-internal IPv4 interface.
// Returned as [{ name, address, family }]. The settings card renders
// one checkbox per entry. Internal (loopback) interfaces are omitted
// (the request is already a local request — isLocalRequest handles it).
export function getAllNetworkInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(_IFACES_SNAPSHOT || {})) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4") continue;
      if (a.internal) continue;
      out.push({ name, address: a.address, family: a.family });
    }
  }
  // Stable sort by interface name for predictable UI
  out.sort((x, y) => {
    if (x.name < y.name) return -1;
    if (x.name > y.name) return 1;
    return 0;
  });
  return out;
}

// getIfaceNameByAddr — given an IPv4 address (as seen on req.socket.localAddress
//   from the server's perspective — i.e. the interface the connection
//   arrived on), return the matching interface name. Returns null if
//   the address doesn't match any known external interface (e.g. it's
//   a loopback or a tunnel we don't track).
export function getIfaceNameByAddr(addr) {
  if (!addr) return null;
  for (const [name, addrs] of Object.entries(_IFACES_SNAPSHOT || {})) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4") continue;
      if (a.address === addr) return name;
    }
  }
  return null;
}

// isInterfaceAllowed — given the server-side local address (the
//   interface the connection arrived on) + the user's interface
//   allowlist, decide whether to accept. Empty allowlist = all allowed
//   (preserves the v0.5.ao "0.0.0.0 listens to everything" behavior).
//
// SECURITY: when the localAddress doesn't match any known external
// interface (snapshot taken at module load — a new interface came up
// after server start), we fail-CLOSED. The user explicitly chose
// "only allow these interfaces"; a connection on an unknown one is
// suspicious. Callers should have already bypassed loopback / local
// LAN_IP via isLocalRequest() — this gate is for remote, authenticated
// traffic only. If a legitimate interface was added after server
// start, the operator must restart the server to pick it up.
export function isInterfaceAllowed(localAddr, allowedIfaces) {
  if (!Array.isArray(allowedIfaces) || allowedIfaces.length === 0) return true;
  const name = getIfaceNameByAddr(localAddr);
  if (!name) return false; // fail-closed — see SECURITY above
  return allowedIfaces.includes(name);
}
