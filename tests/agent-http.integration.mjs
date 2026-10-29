import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime, { createUserMessage, LlmAdapter } from "@deepseek-ai/dsh-llm";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import {
  createGeaMemoryService,
  PersonalMemoryGateway,
} from "../../dsh-gea-plugin/src/host/memory-service.ts";
import { MemorySessionLedger } from "../../dsh-gea-plugin/src/host/memory-session-ledger.ts";
import { mountMemorySessionGuard } from "../../dsh-gea-plugin/src/host/memory-session-guard.ts";
import * as MemoryPlugin from "../index.mjs";

const core = process.env.DSH_CORE_PATH ?? resolve("../../official-latest-standard");
const load = (path) => import(pathToFileURL(join(core, path, "lib/index.js")).href);
const [
  { default: SessionStore, SessionId },
  { default: SessionProjection },
  { default: SystemPrompt },
  { default: Tools },
  { default: AgentLoop },
  { default: Typert },
  { default: SessionController },
] = await Promise.all([
  load("packages/core/session"),
  load("packages/session/session-projection"),
  load("packages/core/system-prompt"),
  load("packages/core/tools"),
  load("packages/core/agent-loop"),
  load("packages/typert/registry"),
  load("packages/api/session-controller"),
]);
class ChatAdapter extends LlmAdapter {
  requests = [];
  async resolveModel(provider, model) {
    return { provider, id: model, name: model };
  }
  async *stream(options) {
    this.requests.push(options);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: "收到" };
    yield {
      type: "block-end",
      index: 0,
      block: { type: "text", text: "收到" },
    };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

test(
  "ordinary bundle config runs real Agent loop through Host, gateway, model and Hindsight HTTP",
  { timeout: 15000 },
  async (t) => {
    const temp = await mkdtemp(join(tmpdir(), "memory-agent-http-"));
    const python = spawn(
      "python3",
      [
        resolve("../dsh-gea-plugin/gateway/tests/generation_fixture.py"),
        join(temp, "metadata.sqlite"),
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    t.after(async () => {
      python.kill();
      await once(python, "exit");
      await rm(temp, { recursive: true, force: true });
    });
    const line = await new Promise((resolve, reject) => {
      createInterface({ input: python.stdout }).once("line", resolve);
      python.once("exit", () => reject(Error("fixture exited")));
    });
    const epoch = new AbortController();
    const gateway = new PersonalMemoryGateway("http://127.0.0.1:" + JSON.parse(line).port, {
      allowPrivateHttp: true,
      timeoutMs: 3000,
      identity: () => ({
        token: "a",
        scope: { environment: "production", tenantId: "10", userId: "alice" },
        signal: epoch.signal,
      }),
      expire() {},
      fetch,
    });
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    await ctx.plugin(Typert);
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjection);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    const adapter = new ChatAdapter();
    ctx.llm.registerAdapter(["fixture"], adapter);
    ctx.provide("fileUploads", { registerAgentResolver: () => () => {} });
    const sessions = new SessionController(ctx, { nativeOpen: false });
    const scope = {
      environment: "production",
      tenantId: "10",
      userId: "alice",
    };
    const business = {
      memory: gateway,
      memoryScope: () => scope,
      identitySignal: () => epoch.signal,
      status: () => ({ authenticated: true }),
      watchIdentity: () => () => {},
    };
    const ledger = new MemorySessionLedger(temp);
    const service = createGeaMemoryService(business, { ledger, sessions });
    ctx.provide("geaMemory", service);
    mountMemorySessionGuard(ctx, business, service);
    const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
    assert.doesNotMatch(patch, /enabled:\s*false/);
    await ctx.plugin(MemoryPlugin);
    const agent = await ctx.agentLoop.create(SessionId("real-memory-session"), {
      provider: "fixture",
      model: "fixture",
    });
    const send = async (text) => {
      agent.followup(
        createUserMessage({
          source: { kind: "user" },
          content: [{ type: "text", text }],
        }),
      );
      await agent.whenIdle();
      await ctx.parallel("session/flush", agent.session);
    };
    await send("我喜欢简短中文回复");
    assert.equal((await gateway.list({}, epoch.signal)).items.length, 0);
    assert.equal(await ledger.scope(agent.id, epoch.signal), undefined);
    await gateway.settings(
      {
        generationEnabled: true,
        expectedRevision: 0,
        operationId: "enable-from-bundle",
      },
      epoch.signal,
    );
    await send("我喜欢简短中文回复");
    const list = await gateway.list({}, epoch.signal);
    assert.equal(list.items.length, 1);
    assert.deepEqual(await new MemorySessionLedger(temp).scope(agent.id, epoch.signal), scope);
    assert.deepEqual(await service.source(list.items[0].id, epoch.signal), {
      scope,
      sessionId: agent.id,
    });
    const source = agent.session
      .snapshotEvents()
      .find(
        (event) =>
          event.type === "user/message" && event.data.id === list.items[0].source.messageId,
      );
    assert.ok(source);
    assert.equal(list.items[0].source.time, new Date(source.time).toISOString());
    await gateway.settings(
      {
        generationEnabled: false,
        expectedRevision: list.state.revision,
        operationId: "disable-from-bundle",
      },
      epoch.signal,
    );
    await send("请根据我的表达偏好回答");
    assert.ok(
      agent.session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === "user/message" &&
            event.data.source.kind === "plugin:gea-personal-memory",
        ),
    );
    assert.equal((await gateway.list({}, epoch.signal)).items.length, 1);
    assert.equal(adapter.requests.length, 3);
  },
);
