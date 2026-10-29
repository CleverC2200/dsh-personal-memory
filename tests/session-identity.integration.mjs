import test from "node:test";
import assert from "node:assert/strict";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import {
  fixture,
  alice,
  bob,
  message,
} from "../../dsh-gea-plugin/tests/fixtures/memory-session.mjs";
import { mountMemorySessionGuard } from "../../dsh-gea-plugin/src/host/memory-session-guard.ts";
test("real Core conversations remain unbound on empty OFF recall and stop after actual memory use", async (t) => {
  const f = await fixture(t);
  let recalled = [];
  f.business.memory.state = async () => ({
    scope: f.business.memoryScope(),
    generationEnabled: false,
    revision: 0,
    bankGeneration: 0,
  });
  f.business.memory.recall = async () => ({
    scope: f.business.memoryScope(),
    memories: recalled,
  });
  const service = f.service();
  f.ctx.provide("geaMemory", service);
  mountMemorySessionGuard(f.ctx, f.business, service);
  await f.ctx.plugin(await import("../index.mjs"));
  class Adapter extends LlmAdapter {
    calls = [];
    async resolveModel(provider, model) {
      return { provider, id: model, name: model };
    }
    async *stream(options) {
      this.calls.push(options);
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
  const adapter = new Adapter();
  f.ctx.llm.registerAdapter(["direct"], adapter);
  const agent = await f.create("empty-then-used");
  const send = async () => {
    agent.followup(message());
    await agent.whenIdle();
  };
  await send();
  assert.equal(await f.ledger.scope(agent.id, new AbortController().signal), undefined);
  f.swap(bob);
  await send();
  assert.equal(adapter.calls.length, 2);
  recalled = [{ id: "bob-memory", title: "偏好", content: "Bob 偏好简短回答" }];
  await send();
  assert.deepEqual(await f.ledger.scope(agent.id, new AbortController().signal), bob);
  assert.ok(adapter.calls[2].messages.some((m) => m.source.kind === "plugin:gea-personal-memory"));
  f.swap(alice);
  await send();
  assert.equal(adapter.calls.length, 3);
});

test(
  "identity changes cancel a real turn while memory is waiting before the model",
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t);
    let started, release;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    f.business.memory.state = async () => ({
      scope: alice,
      generationEnabled: false,
    });
    f.business.memory.recall = async () => {
      started();
      await gate;
      return { scope: alice, memories: [] };
    };
    const service = f.service();
    f.ctx.provide("geaMemory", service);
    mountMemorySessionGuard(f.ctx, f.business, service);
    await f.ctx.plugin(await import("../index.mjs"));
    let calls = 0;
    class Adapter extends LlmAdapter {
      async resolveModel(provider, model) {
        return { provider, id: model, name: model };
      }
      async *stream() {
        calls++;
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }
    f.ctx.llm.registerAdapter(["direct"], new Adapter());
    const agent = await f.create("recall-waiting");
    agent.followup(message());
    await ready;
    f.swap(bob);
    await agent.whenIdle();
    release();
    assert.equal(calls, 0);
    assert.equal(agent.status, "idle");
    assert.equal(
      agent.session.snapshotEvents().some((event) => event.type === "assistant/message"),
      false,
    );
  },
);
test(
  "identity changes abort the real Core model signal and ignore a provider's late answer",
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t);
    mountMemorySessionGuard(f.ctx, f.business, f.service());
    const agent = await f.create("active-model");
    await f.service().bindSession(agent.id, new AbortController().signal);
    let started, release, providerSignal;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    class Adapter extends LlmAdapter {
      async resolveModel(provider, model) {
        return { provider, id: model, name: model };
      }
      async *stream(options) {
        providerSignal = options.signal;
        started();
        await gate;
        yield { type: "block-start", index: 0, blockType: "text" };
        yield {
          type: "block-end",
          index: 0,
          block: { type: "text", text: "old account private result" },
        };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }
    f.ctx.llm.registerAdapter(["direct"], new Adapter());
    agent.followup(message());
    await ready;
    f.swap(bob);
    await agent.whenIdle();
    release();
    assert.equal(providerSignal.aborted, true);
    assert.equal(
      agent.session
        .deriveMessages()
        .some((message) =>
          message.content.some((part) => part.text?.includes("old account private result")),
        ),
      false,
    );
  },
);
