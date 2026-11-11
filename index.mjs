import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { pluginMessage, promptText, originalInputs } from "./vendor/capture.mjs";
import { wrapContext } from "./vendor/recall-context.mjs";
export { pluginPackageVersion } from "./package-version.mjs";

export const name = "gea-personal-memory";
export const inject = ["geaMemory"];
export const Config = z.object({});

export function apply(ctx) {
  const admissions = new Map();
  const tasks = new Set();
  let queue = Promise.resolve();
  ctx.geaMemory.watch(() => admissions.clear());
  ctx.on(
    "agent/pre-step",
    async ({ agent, messages, turn, signal }, next) => {
      const identity = ctx.geaMemory.identitySignal();
      const requestSignal = AbortSignal.any([signal, identity]);
      await untilAborted(
        () => ctx.geaMemory.assertSession(agent.session.id, requestSignal),
        requestSignal,
      );
      const decision = await next();
      const active = () =>
        !signal.aborted &&
        !identity.aborted &&
        identity === ctx.geaMemory.identitySignal() &&
        ctx.geaMemory.authenticated();
      if (agent.session?.header?.origin === "subagent" || decision.kind !== "enter" || !active())
        return decision;
      const originals = originalInputs(messages);
      const query = promptText(messages);
      if (!query) {
        const hasUserInput = messages.some(
          (message) => message.role === "user" && message.source?.kind === "user",
        );
        return hasUserInput ? withRecallStatus(decision, "skipped") : decision;
      }
      try {
        const sessionId = agent.session.id;
        const state = await untilAborted(() => ctx.geaMemory.state(requestSignal), requestSignal);
        if (!active()) return decision;
        if (state.generationEnabled && typeof sessionId === "string") {
          await untilAborted(
            () => ctx.geaMemory.bindSession(sessionId, requestSignal),
            requestSignal,
          );
          if (!active()) return decision;
          const key = sessionId + ":" + turn;
          const accepted = admissions.get(key) ?? new Map();
          for (const { message, text } of originals) {
            if (!accepted.has(message.id))
              accepted.set(message.id, {
                identity,
                committed: false,
                state,
                text,
                source: {
                  sessionId,
                  messageId: message.id,
                  time: new Date().toISOString(),
                },
              });
          }
          admissions.set(key, accepted);
        }
        if ([...query].length > 2000) return withRecallStatus(decision, "skipped");
        const recallSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(10_000)]);
        const results = await Promise.allSettled(
          recallQueries(query).map((text) =>
            untilAborted(() => ctx.geaMemory.recall(text, recallSignal), recallSignal),
          ),
        );
        if (!active()) return decision;
        for (const result of results)
          if (result.status === "rejected" && isIdentityError(result.reason)) throw result.reason;
        const failed = results.some((result) => result.status === "rejected");
        const body = mergeRecall(
          results
            .filter((result) => result.status === "fulfilled")
            .map((result) => result.value.memories),
        );
        if (!body) return withRecallStatus(decision, failed ? "unavailable" : "empty");
        const current = await untilAborted(() => ctx.geaMemory.state(requestSignal), requestSignal);
        if (!active()) return decision;
        if (current.revision !== state.revision || current.bankGeneration !== state.bankGeneration)
          return withRecallStatus(decision, "unavailable");
        if (!state.generationEnabled)
          await untilAborted(
            () => ctx.geaMemory.bindSession(sessionId, requestSignal),
            requestSignal,
          );
        if (!active()) return decision;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            pluginMessage(
              wrapContext(
                `Personal memory recall status: matched.${failed ? " One lookup was unavailable; these are the successful results." : ""}\nWhen asked about the source, describe the saved personal memory and its date in plain language. Avoid internal IDs unless specifically requested.\n\n${body}`,
              ),
              { scope: state.scope },
            ),
          ],
        };
      } catch (error) {
        if (!active()) return decision;
        if (isIdentityError(error)) throw error;
        return withRecallStatus(decision, "unavailable");
      }
    },
    { prepend: true },
  );
  ctx.on("session/event", (session, event) => {
    if (session.header?.origin === "subagent") return;
    if (event.type === "user/message") {
      for (const accepted of admissions.values()) {
        const capture = accepted.get(event.data.id);
        if (capture && capture.source.sessionId === session.id) {
          capture.source.time = new Date(event.time).toISOString();
          capture.committed = true;
        }
      }
      return;
    }
    if (event.type !== "turn/end") return;
    const key = session.id + ":" + event.data.turn;
    const accepted = admissions.get(key);
    admissions.delete(key);
    if (!accepted) return;
    for (const capture of accepted.values()) {
      if (!capture.committed) continue;
      const task = queue.then(async () => {
        if (
          capture.identity.aborted ||
          capture.identity !== ctx.geaMemory.identitySignal() ||
          !ctx.geaMemory.authenticated()
        )
          return;
        const operationId =
          "capture-" +
          createHash("sha256")
            .update(
              JSON.stringify([
                capture.state.scope,
                capture.source.sessionId,
                capture.source.messageId,
              ]),
            )
            .digest("hex");
        try {
          await ctx.geaMemory.bindSession(session.id, capture.identity);
          await ctx.geaMemory.generate(
            {
              operationId,
              expectedRevision: capture.state.revision,
              bankGeneration: capture.state.bankGeneration,
              source: capture.source,
              text: capture.text,
            },
            capture.identity,
          );
        } catch {}
      });
      queue = task.catch(() => {});
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    }
  });
  ctx.on("session/flush", async () => {
    await Promise.allSettled([...tasks]);
  });
}

function recallQueries(query) {
  const intent = query.replace(/“[^”]*”|「[^」]*」|『[^』]*』|《[^》]*》|"[^"]*"/gu, " ");
  const topics = [];
  if (
    /(?:我是谁|我叫(?:什么|啥)|我的(?:姓名|名字|身份|职责|工作背景)|你(?:还)?记得我|who am i\b|what(?:'s| is) my (?:name|identity|role)\b)/iu.test(
      intent,
    )
  )
    topics.push("姓名、身份和个人背景");
  if (
    /(?:我的(?:表达|回答|回复|沟通|语言|格式)?偏好|我(?:喜欢|偏好)(?:什么|怎样|哪种)|my (?:communication |response )?preferences\b|how do i (?:like|prefer)\b)/iu.test(
      intent,
    )
  )
    topics.push("表达偏好、回复语言和格式");
  if (
    /(?:我的(?:工作)?习惯|我(?:平时|通常|一般)(?:怎么|如何|怎样)|my (?:work )?habits\b|how do i (?:usually|normally)\b)/iu.test(
      intent,
    )
  )
    topics.push("工作习惯和日常协作方式");
  if (!topics.length) return [query];
  const prefix = `当前用户的${topics.join("；")}。用户原话：`;
  return [query, prefix + [...query].slice(0, 2000 - [...prefix].length).join("")];
}

function mergeRecall(lists) {
  const seen = new Set();
  const entries = [];
  let size = 0;
  for (let index = 0; lists.some((list) => index < list.length); index++) {
    for (const list of lists) {
      const memory = list[index];
      if (!memory || seen.has(memory.id)) continue;
      seen.add(memory.id);
      const entry = [
        `[${memory.id}] ${memory.title}`,
        memory.content,
        `来源：${memory.manuallyEdited ? "人工维护的个人记忆" : "对话中保存的个人记忆"}${memory.updatedAt ? `；更新时间：${memory.updatedAt}` : ""}`,
      ].join("\n");
      const length = [...entry].length + (entries.length ? 2 : 0);
      if (size + length > 6000) continue;
      entries.push(entry);
      size += length;
      if (entries.length === 5) return entries.join("\n\n");
    }
  }
  return entries.join("\n\n");
}

function withRecallStatus(decision, status) {
  const description = {
    empty:
      "The personal memory search completed with no matches for this query. This does not mean the account has no memories or that cross-conversation memory is unsupported.",
    unavailable:
      "Personal memory could not be fully checked for this turn. Do not treat this as proof that nothing is remembered.",
    skipped:
      "Personal memory was not searched because the new input is outside the supported text query limits. Do not claim that no memories exist.",
  }[status];
  return {
    ...decision,
    messages: [
      ...decision.messages,
      pluginMessage(
        `<gea-memory-recall-status>\nPersonal memory recall status: ${status}. ${description}\nThis is the current turn's retrieval status, not a stored personal fact.\n</gea-memory-recall-status>`,
        { kind: "plugin:gea-personal-memory-status" },
      ),
    ],
  };
}

function isIdentityError(error) {
  return (
    error instanceof Error &&
    /^(?:STALE_SELECTION|MEMORY_(?:UNAUTHENTICATED|FORBIDDEN|IDENTITY_UNAVAILABLE|SCOPE_MISMATCH|SESSION_))/.test(
      error.message,
    )
  );
}

function untilAborted(operation, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
