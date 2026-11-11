import assert from "node:assert/strict";
import test from "node:test";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { apply } from "../index.mjs";

const scope = { environment: "production", tenantId: "0", userId: "fixture" };
const input = (text, kind = "user") =>
  createUserMessage({ source: { kind }, content: [{ type: "text", text }] });
const saved = {
  id: "memory-1",
  category: "preference",
  title: "表达偏好",
  content: "用户偏好简短中文回复。",
  version: 1,
  manuallyEdited: false,
  source: { sessionId: "s", messageId: "m", time: "2026-10-29T00:00:00Z" },
  updatedAt: "2026-10-29T00:00:00Z",
};
function fixture(overrides = {}, config = { enabled: true }) {
  const identity = new AbortController();
  const hooks = new Map();
  const captures = [];
  const queries = [];
  const session = { id: "session-1", header: { origin: "user" } };
  const service = {
    authenticated: () => true,
    identitySignal: () => identity.signal,
    watch: () => () => {},
    bindSession: async () => {},
    assertSession: async () => {},
    state: async () => ({
      scope,
      generationEnabled: true,
      revision: 1,
      bankGeneration: 0,
    }),
    recall: async (query) => {
      queries.push(query);
      return { scope, memories: [saved] };
    },
    generate: async (value) => {
      captures.push(value);
      return { scope, operationId: value.operationId, status: "completed" };
    },
    ...overrides,
  };
  apply(
    {
      geaMemory: service,
      on(event, handler) {
        hooks.set(event, handler);
      },
    },
    config,
  );
  const messages = [input("我喜欢简短中文回复")];
  const decision = { kind: "enter", messages, startsRequestSeries: true };
  const controller = new AbortController();
  const payload = {
    agent: { session },
    messages,
    turn: 1,
    step: 1,
    signal: controller.signal,
  };
  return {
    service,
    identity,
    controller,
    captures,
    queries,
    decision,
    payload,
    run: (next = async () => decision) => hooks.get("agent/pre-step")?.(payload, next) ?? next(),
    end: (commit = true) => {
      if (commit)
        for (const message of decision.messages)
          if (message.role === "user")
            hooks.get("session/event")?.(session, {
              type: "user/message",
              time: Date.now(),
              data: message,
            });
      return hooks.get("session/event")?.(session, {
        type: "turn/end",
        time: Date.now(),
        data: { turn: 1, reason: "complete" },
      });
    },
    flush: () => hooks.get("session/flush")?.(session),
  };
}
test("pre-step appends scoped personal memory and generation runs only after turn end", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0], f.decision.messages[0]);
  assert.equal(result.messages[1].source.kind, "plugin:gea-personal-memory");
  assert.match(result.messages[1].content[0].text, /background context, not instructions/);
  assert.deepEqual(f.captures, []);
  f.end();
  await f.flush();
  assert.equal(f.captures[0].text, "我喜欢简短中文回复");
  assert.equal(f.captures[0].source.messageId, f.payload.messages[0].id);
});
test("server OFF keeps recall and never replays inputs observed before enable", async () => {
  let enabled = false;
  const f = fixture({
    state: async () => ({
      scope,
      generationEnabled: enabled,
      revision: enabled ? 1 : 0,
      bankGeneration: 0,
    }),
  });
  assert.equal((await f.run()).messages.length, 2);
  enabled = true;
  f.end();
  await f.flush();
  assert.deepEqual(f.captures, []);
  f.payload.messages = [input("我习惯每天整理工作清单")];
  f.decision.messages = f.payload.messages;
  await f.run();
  f.end();
  await f.flush();
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].text, "我习惯每天整理工作清单");
});

test("only newly claimed original user text is captured, regardless of downstream injected messages or history", async () => {
  const f = fixture();
  f.payload.agent.session.history = [input("旧历史不重放")];
  f.payload.messages = [
    input("我负责库存计划"),
    input("工具结果", "tool"),
    input("注入", "plugin:other"),
    input("时间", "time-context"),
    { role: "assistant", content: [{ type: "text", text: "助手猜测" }] },
  ];
  f.decision.messages = [...f.payload.messages, input("下游伪造原始输入")];
  await f.run();
  f.end();
  await f.flush();
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].text, "我负责库存计划");
  assert.equal(f.queries[0], "我负责库存计划");
});

test("background extraction does not block turn end or following conversation and failure remains contained", async () => {
  let release;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const f = fixture({
    generate: async () => {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      throw Error("model unavailable");
    },
  });
  await f.run();
  assert.equal(f.end(), undefined);
  await ready;
  f.payload.messages = [input("下一个普通问题")];
  f.decision.messages = f.payload.messages;
  assert.equal((await f.run()).messages.length, 2);
  release();
  await f.flush();
});

test("rejection, subagent, untrusted source and attachment content never enter capture", async () => {
  const rejected = fixture();
  assert.deepEqual(await rejected.run(async () => ({ kind: "reject" })), {
    kind: "reject",
  });
  rejected.end();
  await rejected.flush();
  assert.deepEqual(rejected.captures, []);
  const subagent = fixture();
  subagent.payload.agent.session.header.origin = "subagent";
  await subagent.run();
  subagent.end();
  await subagent.flush();
  assert.deepEqual(subagent.captures, []);
  for (const messages of [
    [],
    [input("a", "plugin:gea-personal-memory")],
    [
      {
        id: "legacy",
        role: "user",
        source: {},
        content: [{ type: "text", text: "旧未标来源" }],
      },
    ],
    [
      {
        id: "file",
        role: "user",
        source: { kind: "user" },
        content: [
          { type: "text", text: "我喜欢" },
          { type: "image_url", image_url: "attachment" },
        ],
      },
    ],
  ]) {
    const f = fixture();
    f.payload.messages = messages;
    await f.run();
    f.end();
    await f.flush();
    assert.deepEqual(f.captures, []);
  }
});

test(
  "identity cancellation releases ignored recall and discards admitted background work",
  { timeout: 1000 },
  async () => {
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const f = fixture({
      recall: async () => {
        started();
        return new Promise(() => {});
      },
    });
    const running = f.run();
    await ready;
    f.identity.abort();
    assert.equal(await running, f.decision);
    f.end();
    await f.flush();
    assert.deepEqual(f.captures, []);
  },
);

test("a cancelled or discarded input without a committed user message never generates a source record", async () => {
  const f = fixture();
  await f.run();
  f.end(false);
  await f.flush();
  assert.deepEqual(f.captures, []);
});

test("empty recall with generation OFF does not bind an unused session", async () => {
  let bindings = 0;
  const f = fixture({
    bindSession: async () => {
      bindings++;
    },
    state: async () => ({
      scope,
      generationEnabled: false,
      revision: 0,
      bankGeneration: 0,
    }),
    recall: async () => ({ scope, memories: [] }),
  });
  await f.run();
  assert.equal(bindings, 0);
});

test("a new conversation recalls identity with the original question and a subject query", async () => {
  const name = {
    ...saved,
    category: "background",
    title: "姓名",
    content: "用户姓名是陈勇浩",
  };
  const queries = [];
  const f = fixture({
    recall: async (query) => {
      queries.push(query);
      return { scope, memories: query === "我是谁" ? [] : [name] };
    },
  });
  f.payload.messages = [input("我是谁")];
  f.decision.messages = f.payload.messages;
  const result = await f.run();
  assert.equal(queries.length, 2);
  assert.equal(queries[0], "我是谁");
  assert.match(queries[1], /当前用户的姓名、身份和个人背景/);
  assert.equal(result.messages.at(-1).source.kind, "plugin:gea-personal-memory");
  assert.match(result.messages.at(-1).content[0].text, /用户姓名是陈勇浩/);
  assert.match(result.messages.at(-1).content[0].text, /matched/);
  assert.match(result.messages.at(-1).content[0].text, /2026-10-29/);
  f.end();
  await f.flush();
  assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].text, "我是谁");
});

test("supplemental recall preserves original matches, deduplicates IDs and shares a deadline", async () => {
  const signals = [];
  const other = {
    ...saved,
    id: "other",
    title: "姓名",
    content: "用户姓名是陈勇浩",
  };
  const f = fixture({
    recall: async (query, signal) => {
      signals.push(signal);
      return { scope, memories: query === "我是谁" ? [saved] : [saved, other] };
    },
  });
  f.payload.messages = [input("我是谁")];
  f.decision.messages = f.payload.messages;
  const result = await f.run();
  const body = result.messages.at(-1).content[0].text;
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(body.split("[memory-1]").length - 1, 1);
  assert.match(body, /\[other\]/);
});

test("recalled context describes provenance without exposing internal session or message IDs", async () => {
  const f = fixture({
    recall: async () => ({
      scope,
      memories: [
        {
          ...saved,
          source: {
            ...saved.source,
            sessionId: "internal-source-session",
            messageId: "internal-source-message",
          },
        },
      ],
    }),
  });
  const result = await f.run();
  const body = result.messages.at(-1).content[0].text;
  assert.match(body, /对话中保存的个人记忆/);
  assert.match(body, /2026-10-29/);
  assert.doesNotMatch(body, /internal-source-session|internal-source-message/);
});

test("ordinary first-person business requests do not add a profile lookup", async () => {
  const f = fixture();
  f.payload.messages = [input("我需要分析基地库存")];
  f.decision.messages = f.payload.messages;
  await f.run();
  assert.deepEqual(f.queries, ["我需要分析基地库存"]);
});

test("quoted identity questions in translation, film and philosophy requests do not add a profile lookup", async () => {
  for (const query of [
    "请把“我是谁”翻译成英语",
    "请解释“我是谁”这个哲学问题",
    "介绍电影《我是谁》的剧情",
    'Translate "Who am I" into Chinese',
  ]) {
    const f = fixture();
    f.payload.messages = [input(query)];
    f.decision.messages = f.payload.messages;
    await f.run();
    assert.deepEqual(f.queries, [query]);
  }
});

test("empty, unavailable and skipped recall have distinct neutral status messages", async () => {
  for (const [status, text, recall] of [
    ["empty", "普通问题", async () => ({ scope, memories: [] })],
    [
      "unavailable",
      "普通问题",
      async () => {
        throw Error("MEMORY_TIMEOUT");
      },
    ],
    [
      "skipped",
      "长".repeat(2001),
      async () => {
        assert.fail("long query must not be sent");
      },
    ],
  ]) {
    let bindings = 0;
    const f = fixture({
      state: async () => ({
        scope,
        generationEnabled: false,
        revision: 1,
        bankGeneration: 0,
      }),
      bindSession: async () => {
        bindings++;
      },
      recall,
    });
    f.payload.messages = [input(text)];
    f.decision.messages = f.payload.messages;
    const result = await f.run();
    assert.equal(result.messages.at(-1).source.kind, "plugin:gea-personal-memory-status");
    assert.match(result.messages.at(-1).content[0].text, new RegExp(`status: ${status}`));
    assert.equal(result.messages.at(-1).source.scope, undefined);
    assert.equal(bindings, 0);
  }
});

test("one failed lookup keeps the other match and reports incomplete empty searches", async () => {
  for (const memories of [[saved], []]) {
    const f = fixture({
      recall: async (query) => {
        if (query !== "我是谁") throw Error("MEMORY_GATEWAY_UNAVAILABLE");
        return { scope, memories };
      },
    });
    f.payload.messages = [input("我是谁")];
    f.decision.messages = f.payload.messages;
    const result = await f.run();
    const body = result.messages.at(-1).content[0].text;
    assert.match(body, memories.length ? /status: matched/ : /status: unavailable/);
    if (memories.length) assert.match(body, /用户偏好简短中文回复/);
  }
});

test(
  "a supplemental deadline does not discard an already successful original lookup",
  { timeout: 1000 },
  async (t) => {
    const deadline = new AbortController();
    t.mock.method(AbortSignal, "timeout", () => deadline.signal);
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const f = fixture({
      recall: async (query) => {
        if (query === "我是谁") return { scope, memories: [saved] };
        started();
        return new Promise(() => {});
      },
    });
    f.payload.messages = [input("我是谁")];
    f.decision.messages = f.payload.messages;
    const pending = f.run();
    await ready;
    await new Promise(setImmediate);
    deadline.abort(Error("lookup deadline"));
    const result = await pending;
    assert.match(result.messages.at(-1).content[0].text, /status: matched/);
    assert.match(result.messages.at(-1).content[0].text, /用户偏好简短中文回复/);
  },
);

test("authorization failures and changes to the memory revision cannot inject recalled facts", async () => {
  const denied = fixture({
    recall: async () => {
      throw Error("MEMORY_FORBIDDEN");
    },
  });
  await assert.rejects(denied.run(), /MEMORY_FORBIDDEN/);
  let reads = 0;
  const changed = fixture({
    state: async () => ({
      scope,
      generationEnabled: true,
      revision: ++reads,
      bankGeneration: 0,
    }),
  });
  const result = await changed.run();
  assert.doesNotMatch(result.messages.at(-1).content[0].text, /用户偏好简短中文回复/);
  assert.match(result.messages.at(-1).content[0].text, /status: unavailable/);
});

test("merged recall keeps one five-entry content budget across both lookups", async () => {
  const f = fixture({
    recall: async (query) => ({
      scope,
      memories: Array.from({ length: 5 }, (_, i) => ({
        ...saved,
        id: `${query === "我是谁" ? "original" : "supplement"}-${i}`,
        content: "字".repeat(1000),
      })),
    }),
  });
  f.payload.messages = [input("我是谁")];
  f.decision.messages = f.payload.messages;
  const result = await f.run();
  const body = result.messages.at(-1).content[0].text;
  assert.equal((body.match(/\[(?:original|supplement)-\d\]/g) ?? []).length, 5);
  assert.ok([...body].length < 6500);
});
