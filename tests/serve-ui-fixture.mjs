import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PersonalMemoryGateway } from "../../dsh-gea-plugin/src/host/memory-service.ts";
const output = process.env.MEMORY_UI_OUTPUT;
if (!output) throw Error("MEMORY_UI_OUTPUT required");
const tmp = await mkdtemp(join(tmpdir(), "memory-browser-"));
const python = spawn(
  "python3",
  [resolve("../dsh-gea-plugin/gateway/tests/ui_fixture.py"), join(tmp, "memory.sqlite")],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const line = await new Promise((resolve, reject) => {
  const reader = createInterface({ input: python.stdout });
  reader.once("line", resolve);
  python.once("exit", () => reject(Error("gateway exited")));
});
const gateway = new PersonalMemoryGateway("http://127.0.0.1:" + JSON.parse(line).port, {
  allowPrivateHttp: true,
  timeoutMs: 2000,
  identity: () => ({
    token: "a",
    scope: { environment: "production", tenantId: "10", userId: "alice" },
    signal: new AbortController().signal,
  }),
  expire: () => {},
  fetch,
});
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/gea-proof/memory/")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const endpoint = req.url.split("/").at(-1);
      const signal = new AbortController().signal;
      const methods = {
        state: () => gateway.state(signal),
        list: () => gateway.list(input, signal),
        settings: () => gateway.settings(input, signal),
        operations: () => gateway.operation(input.operationId, signal),
      };
      if (!methods[endpoint]) throw Error("MEMORY_NOT_IMPLEMENTED");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, value: await methods[endpoint]() }));
      return;
    }
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/ui-fixture.css"></head><body><div id="root"></div><script type="module" src="/ui-fixture.js"></script></body></html>',
      );
      return;
    }
    if (!["/ui-fixture.js", "/ui-fixture.css"].includes(req.url)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", req.url.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(await readFile(join(output, req.url.slice(1))));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: error.message } }));
  }
});
server.listen(0, "127.0.0.1", () =>
  console.log(JSON.stringify({ url: "http://127.0.0.1:" + server.address().port })),
);
async function stop() {
  server.close();
  python.kill();
  await rm(tmp, { recursive: true, force: true });
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
