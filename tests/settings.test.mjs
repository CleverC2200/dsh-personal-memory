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

test("editing keeps drafts on conflict and reconciles unknown writes once through the original operation", async (t) => {
  let item = {
    id: "memory-1",
    title: "表达偏好",
    category: "preference",
    content: "旧内容",
    version: 1,
  };
  let writes = 0;
  let mode = "conflict";
  let saved;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let value;
    if (req.url.endsWith("/list")) value = { scope, state: { ...state, count: 1 }, items: [item] };
    if (req.url.endsWith("/get")) value = { scope, item };
    if (req.url.endsWith("/state")) value = state;
    if (req.url.endsWith("/update")) {
      writes++;
      if (mode === "conflict") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "MEMORY_VERSION_CONFLICT" } }));
        return;
      }
      item = {
        ...item,
        content: body.content,
        category: body.category,
        version: 3,
        manuallyEdited: true,
      };
      saved = {
        scope,
        operationId: body.operationId,
        status: "completed",
        state: { ...state, revision: 2, count: 1 },
      };
      req.socket.destroy();
      return;
    }
    if (req.url.endsWith("/operations")) {
      assert.equal(body.operationId, saved.operationId);
      value = saved;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, value }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const controller = createMemorySettings({
    fetch: (path, init) => fetch("http://127.0.0.1:" + server.address().port + path, init),
  });
  await controller.load();
  controller.edit(item);
  controller.changeEdit({ content: " \n " });
  await controller.saveEdit();
  assert.equal(writes, 0);
  controller.changeEdit({ content: "我的草稿", category: "habit" });
  await controller.saveEdit();
  assert.equal(controller.getSnapshot().editing.content, "我的草稿");
  assert.match(controller.getSnapshot().editError, /重新加载/);
  item = { ...item, content: "别处更新", version: 2 };
  await controller.reloadEdit();
  assert.equal(controller.getSnapshot().editing.content, "别处更新");
  assert.equal(controller.getSnapshot().editing.version, 2);
  mode = "unknown";
  controller.changeEdit({ content: "新草稿", category: "habit" });
  await controller.saveEdit();
  assert.ok(controller.getSnapshot().editPending);
  assert.match(controller.getSnapshot().editError, /待确认/);
  await controller.saveEdit();
  assert.equal(writes, 2);
  await controller.verifyEdit();
  assert.equal(writes, 2);
  assert.equal(controller.getSnapshot().editing, null);
  assert.equal(controller.getSnapshot().items[0].content, "新草稿");
});

test("source navigation only follows Host-authorized current memory and identity reset removes drafts", async (t) => {
  let allowed = false;
  let navigated;
  let closed = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    assert.deepEqual(JSON.parse(raw), { id: "memory-1" });
    res.writeHead(allowed ? 200 : 403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        allowed
          ? { ok: true, value: { scope, sessionId: "authorized-session" } }
          : { ok: false, error: { code: "MEMORY_SOURCE_UNAVAILABLE" } },
      ),
    );
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const controller = createMemorySettings({
    fetch: (path, init) => fetch("http://127.0.0.1:" + server.address().port + path, init),
  });
  const item = { id: "memory-1", category: "preference", content: "draft", version: 1 };
  const open = (target) => {
    navigated = target;
  };
  const close = () => {
    closed = true;
  };
  await controller.source(item, open, close);
  assert.equal(navigated, undefined);
  assert.equal(closed, false);
  assert.match(controller.getSnapshot().error, /来源不可用/);
  allowed = true;
  await controller.source(item, open, close);
  assert.equal(navigated, "authorized-session");
  assert.equal(closed, true);
  controller.edit(item);
  controller.reset();
  assert.equal(controller.getSnapshot().editing, null);
  assert.equal(controller.getSnapshot().editPending, null);
});

test("unknown edit retry reuses the original operation and processing edits cannot be repeated", async (t) => {
  const ids = [];
  let processing = true;
  const item = { id: "memory-1", category: "habit", content: "原内容", version: 1 };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let value = { scope, state, items: [item] };
    if (req.url.endsWith("/update")) {
      ids.push(body.operationId);
      value = {
        scope,
        operationId: body.operationId,
        status: ids.length > 1 ? "completed" : "unknown",
        state,
      };
    }
    if (req.url.endsWith("/operations"))
      value = {
        scope,
        operationId: body.operationId,
        status: processing ? "processing" : "unknown",
        state,
      };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, value }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const controller = createMemorySettings({
    fetch: (path, init) => fetch("http://127.0.0.1:" + server.address().port + path, init),
  });
  await controller.load();
  controller.edit(item);
  controller.changeEdit({ content: "我的修改" });
  await controller.saveEdit();
  await controller.verifyEdit();
  await controller.retryEdit();
  assert.equal(ids.length, 1);
  processing = false;
  await controller.verifyEdit();
  await controller.retryEdit();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(controller.getSnapshot().editing, null);
});
