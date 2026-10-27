import assert from "node:assert/strict";
import test from "node:test";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { apply } from "../index.mjs";

const scope = { environment: "production", tenantId: "0", userId: "fixture" };
const uri = "viking://user/u-Zml4dHVyZQ/memories/preferences/user/format.md";
const input = (text, kind = "user") =>
  createUserMessage({
    source: { kind },
    content: [{ type: "text", text }],
  });

function fixture(config = { enabled: true }, overrides = {}) {
  const identity = new AbortController();
  const listeners = new Set();
  const requests = [];
  const service = {
    authenticated: () => true,
    identitySignal: () => identity.signal,
    watch: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    capabilities: async () => ({
      scope,
      readOnly: true,
      memoryTypes: ["preferences"],
    }),
    recall: async (query, signal) => {
      requests.push({ query, signal });
      return {
        scope,
        memories: [{ uri, content: "用户偏好简短中文回复。", score: 0.9 }],
      };
    },
    ...overrides,
  };
  let hook;
  apply(
    {
      geaMemory: service,
      on(event, handler, options) {
        assert.equal(event, "agent/pre-step");
        assert.deepEqual(options, { prepend: true });
        assert.equal(hook, undefined);
        hook = handler;
      },
    },
    config,
  );
  const controller = new AbortController();
  const messages = [input("请按我的偏好回答这个问题。")];
  const decision = { kind: "enter", messages, startsRequestSeries: true };
  const payload = {
    agent: { session: { header: { origin: "user" } } },
    messages,
    signal: controller.signal,
  };
  return {
    service,
    requests,
    controller,
    identity,
    listeners,
    decision,
    payload,
    run: (next = async () => decision) => (hook ? hook(payload, next) : next()),
    changeIdentity: () => {
      identity.abort();
      for (const listener of listeners) listener();
    },
  };
}

test("enabled pre-step appends one scoped Core message and preserves downstream decisions and original input", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.startsRequestSeries, true);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0], f.decision.messages[0]);
  assert.equal(f.requests[0].query, "请按我的偏好回答这个问题。");
  const recalled = result.messages[1];
  assert.equal(recalled.role, "user");
  assert.equal(typeof recalled.id, "string");
  assert.ok(Object.isFrozen(recalled));
  assert.ok(Object.isFrozen(recalled.content));
  assert.equal(recalled.source.kind, "plugin:openviking-memory");
  assert.deepEqual(recalled.source.scope, scope);
  assert.match(recalled.content[0].text, /用户偏好简短中文回复。/);
  assert.match(recalled.content[0].text, /background/);
  assert.match(recalled.content[0].text, /not instructions/);
  assert.equal(f.listeners.size, 0);
});

test("memory stays off unless explicitly enabled", async () => {
  for (const config of [{}, { enabled: false }]) {
    const f = fixture(config);
    assert.equal(await f.run(), f.decision);
    assert.equal(f.requests.length, 0);
  }
});

test("subagents and downstream rejection never recall", async () => {
  const subagent = fixture();
  subagent.payload.agent.session.header.origin = "subagent";
  assert.equal(await subagent.run(), subagent.decision);
  assert.equal(subagent.requests.length, 0);
  const rejected = fixture();
  const decision = { kind: "reject" };
  assert.equal(await rejected.run(async () => decision), decision);
  assert.equal(rejected.requests.length, 0);
});

test("only original user text enters recall, and empty or oversized user input skips it", async () => {
  for (const messages of [
    [],
    [input("  ")],
    [input("x".repeat(2001))],
    [
      input("时间背景", "time-context"),
      input("工具结果", "tool"),
      input("插件记忆", "plugin:other"),
    ],
  ]) {
    const f = fixture();
    f.decision.messages = messages;
    assert.equal(await f.run(), f.decision);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture();
  f.decision.messages = [
    input("原始用户问题"),
    input("时间背景", "time-context"),
    input("工具结果", "tool"),
    input("插件记忆", "plugin:other"),
  ];
  const result = await f.run();
  assert.equal(f.requests[0].query, "原始用户问题");
  assert.deepEqual(result.messages.slice(0, -1), f.decision.messages);
});

test("pre-step counts the query budget in Unicode code points", async () => {
  const f = fixture();
  const query = "😀".repeat(2000);
  f.decision.messages = [input(query)];
  assert.equal((await f.run()).messages.length, 2);
  assert.equal(f.requests[0].query, query);
  f.decision.messages = [input(query + "😀")];
  assert.equal(await f.run(), f.decision);
  assert.equal(f.requests.length, 1);
});

test("unauthenticated or unavailable memory leaves normal chat unchanged", async () => {
  for (const overrides of [
    { authenticated: () => false },
    {
      capabilities: async () => {
        throw Error("MEMORY_FORBIDDEN");
      },
    },
    {
      recall: async () => {
        throw Error("MEMORY_BACKEND_UNAVAILABLE");
      },
    },
    { recall: async () => ({ scope, memories: [] }) },
  ]) {
    const f = fixture({ enabled: true }, overrides);
    assert.equal(await f.run(), f.decision);
    assert.equal(f.listeners.size, 0);
  }
  const f = fixture();
  const error = Error("downstream failed");
  await assert.rejects(
    f.run(async () => {
      throw error;
    }),
    error,
  );
  assert.equal(f.requests.length, 0);
});

test("cancelled turns never recall or append late memory", async () => {
  const cancelled = fixture();
  cancelled.controller.abort();
  assert.equal(await cancelled.run(), cancelled.decision);
  assert.equal(cancelled.requests.length, 0);

  let finish;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const f = fixture(
    { enabled: true },
    {
      recall: async () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  );
  const running = f.run();
  await ready;
  f.controller.abort();
  finish({ scope, memories: [{ uri, content: "迟到的偏好", score: 0.5 }] });
  assert.equal(await running, f.decision);
  assert.equal(f.listeners.size, 0);
});

test("identity changes during downstream decision, capabilities, or recall discard old background", async () => {
  const before = fixture();
  assert.equal(
    await before.run(async () => {
      before.changeIdentity();
      return before.decision;
    }),
    before.decision,
  );
  assert.equal(before.requests.length, 0);
  for (const method of ["capabilities", "recall"]) {
    let finish;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const f = fixture(
      { enabled: true },
      {
        [method]: async () => {
          started();
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      },
    );
    const running = f.run();
    await ready;
    f.changeIdentity();
    finish(
      method === "capabilities"
        ? { scope, readOnly: true, memoryTypes: ["preferences"] }
        : { scope, memories: [{ uri, content: "旧账号的偏好", score: 0.5 }] },
    );
    assert.equal(await running, f.decision);
    assert.equal(f.listeners.size, 0);
  }
});

test(
  "cancellation releases chat while a memory provider ignores abort",
  { timeout: 1000 },
  async () => {
    for (const cancel of [(f) => f.controller.abort(), (f) => f.changeIdentity()]) {
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      const f = fixture(
        { enabled: true },
        {
          recall: async () => {
            started();
            return new Promise(() => {});
          },
        },
      );
      const running = f.run();
      await ready;
      cancel(f);
      assert.equal(await running, f.decision);
      assert.equal(f.listeners.size, 0);
    }
  },
);
