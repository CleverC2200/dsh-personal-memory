import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createMemorySettings } from "../settings.mjs";
const scope = { environment: "production", tenantId: "10", userId: "alice" };
const state = {
  scope,
  generationEnabled: false,
  revision: 0,
  bankGeneration: 0,
  count: 0,
  updatedAt: null,
};
test("settings loads the current account through HTTP, saves once, and clears on identity change", async (t) => {
  let saves = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let value;
    if (req.url.endsWith("/list")) value = { scope, state, items: [] };
    else {
      saves++;
      await gate;
      value = {
        scope,
        operationId: body.operationId,
        status: "completed",
        state: { ...state, generationEnabled: true, revision: 1 },
      };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, value }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const controller = createMemorySettings({ fetch: (path, init) => fetch(base + path, init) });
  await controller.load();
  assert.equal(controller.getSnapshot().state.generationEnabled, false);
  const saving = controller.toggle(true);
  const repeated = controller.toggle(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(saves, 1);
  release();
  await Promise.all([saving, repeated]);
  assert.equal(controller.getSnapshot().state.generationEnabled, true);
  controller.reset();
  assert.equal(controller.getSnapshot().state, null);
  assert.deepEqual(controller.getSnapshot().items, []);
});

test("unknown settings result is reconciled with the same operation id without a second write", async (t) => {
  let writes = 0;
  let saved;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url.endsWith("/settings")) {
      writes++;
      saved = {
        scope,
        operationId: body.operationId,
        status: "completed",
        state: { ...state, generationEnabled: true, revision: 1 },
      };
      req.socket.destroy();
      return;
    }
    const value = req.url.endsWith("/operations") ? saved : { scope, state, items: [] };
    if (req.url.endsWith("/operations")) assert.equal(body.operationId, saved.operationId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, value }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const controller = createMemorySettings({
    fetch: (path, init) => fetch("http://127.0.0.1:" + server.address().port + path, init),
  });
  await controller.load();
  await controller.toggle(true);
  assert.match(controller.getSnapshot().error, /待确认/);
  assert.ok(controller.getSnapshot().pending);
  await controller.toggle(true);
  assert.equal(writes, 1);
  await controller.verify();
  assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().state.generationEnabled, true);
  assert.equal(controller.getSnapshot().pending, null);
});
