import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { pluginMessage, promptText, originalInputs } from "./vendor/capture.mjs";
import { wrapContext } from "./vendor/recall-context.mjs";

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
      if (!query) return decision;
      try {
        const requestSignal = AbortSignal.any([signal, identity]);
        const sessionId = agent.session.id;
        await untilAborted(
          () => ctx.geaMemory.bindSession(sessionId, requestSignal),
          requestSignal,
        );
        const state = await untilAborted(() => ctx.geaMemory.state(requestSignal), requestSignal);
        if (!active()) return decision;
        if (state.generationEnabled && typeof sessionId === "string") {
          const key = sessionId + ":" + turn;
          const accepted = admissions.get(key) ?? new Map();
          for (const { message, text } of originals) {
            if (!accepted.has(message.id))
              accepted.set(message.id, {
                identity,
                committed: false,
                state,
                text,
                source: { sessionId, messageId: message.id, time: new Date().toISOString() },
              });
          }
          admissions.set(key, accepted);
        }
        if ([...query].length > 2000) return decision;
        const result = await untilAborted(
          () => ctx.geaMemory.recall(query, requestSignal),
          requestSignal,
        );
        if (!active()) return decision;
        const body = result.memories
          .map((memory) => `[${memory.id}] ${memory.title}\n${memory.content}`)
          .join("\n\n");
        if (!body) return decision;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            pluginMessage(wrapContext(body), { scope: result.scope }),
          ],
        };
      } catch {
        return decision;
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

function untilAborted(operation, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
