// webui/test/router-interface-filter.test.js
// Unit tests for the interface allowlist filter in server/router.js.
//
// When allowedInterfaces is non-empty, non-local requests whose
// localAddress (server-side, the interface the connection arrived on)
// doesn't match any interface in the allowlist are rejected with 403.
//
// We test the gate logic via the public helper isInterfaceAllowed() in
// server/lib/lan.js (which is what router.js uses internally).

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const absPath = (rel) => pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "server", rel)).href;

const { isInterfaceAllowed, getIfaceNameByAddr, getAllNetworkInterfaces } = await import(absPath("lib/lan.js"));

describe("router — interface filter (v1.0.1)", () => {
  test("empty allowlist allows all", () => {
    assert.equal(isInterfaceAllowed("192.168.1.10", []), true);
    assert.equal(isInterfaceAllowed("10.0.0.5", []), true);
  });

  test("allowlist with one iface matches by name", () => {
    const ifaces = getAllNetworkInterfaces();
    if (ifaces.length === 0) return; // skip in sandboxed env
    const target = ifaces[0];
    assert.equal(isInterfaceAllowed(target.address, [target.name]), true);
  });

  test("allowlist with wrong iface rejects", () => {
    const ifaces = getAllNetworkInterfaces();
    if (ifaces.length < 2) return; // need at least 2 to test rejection
    const allowed = ifaces[0].name;
    const wrongAddr = ifaces[1].address;
    // We allow only "allowed" but try to connect via the address of ifaces[1]
    assert.equal(isInterfaceAllowed(wrongAddr, [allowed]), false);
  });

  test("unknown localAddress returns false (fail-closed — see lan.js SECURITY)", () => {
    // SECURITY: if the localAddress doesn't match any known interface
    // (e.g. a new interface came up after server start), we fail-CLOSED.
    // The user explicitly chose "only allow these interfaces"; a
    // connection on an unknown one is suspicious. If a legitimate
    // interface was added, the operator must restart the server.
    assert.equal(isInterfaceAllowed("99.99.99.99", ["Wi-Fi"]), false);
  });

  test("null/empty localAddress returns false (fail-closed)", () => {
    assert.equal(isInterfaceAllowed("", ["Wi-Fi"]), false);
    assert.equal(isInterfaceAllowed(null, ["Wi-Fi"]), false);
  });

  test("non-array allowlist defaults to allow-all (defensive)", () => {
    assert.equal(isInterfaceAllowed("192.168.1.10", null), true);
    assert.equal(isInterfaceAllowed("192.168.1.10", undefined), true);
  });

  test("getIfaceNameByAddr returns name for known address", () => {
    const ifaces = getAllNetworkInterfaces();
    if (ifaces.length === 0) return;
    const target = ifaces[0];
    assert.equal(getIfaceNameByAddr(target.address), target.name);
  });

  test("getIfaceNameByAddr returns null for unknown address", () => {
    assert.equal(getIfaceNameByAddr("99.99.99.99"), null);
    assert.equal(getIfaceNameByAddr(""), null);
    assert.equal(getIfaceNameByAddr(null), null);
  });
});
