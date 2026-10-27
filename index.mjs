import z from "@deepseek-ai/schemastery";
import { pluginMessage, promptText } from "./vendor/capture.mjs";
import { wrapContext } from "./vendor/recall-context.mjs";

export const name = "gea-personal-memory";
export const inject = ["geaMemory"];
export const Config = z.object({ enabled: z.boolean().default(false) });

export function apply(ctx, config = {}) {
  if (config.enabled !== true) return;
  ctx.on(
    "agent/pre-step",
    async ({ agent, signal }, next) => {
      const identity = ctx.geaMemory.identitySignal();
      const decision = await next();
      const active = () =>
        !signal.aborted &&
        !identity.aborted &&
        identity === ctx.geaMemory.identitySignal() &&
        ctx.geaMemory.authenticated();
      if (agent.session?.header?.origin === "subagent" || decision.kind !== "enter" || !active())
        return decision;
      const query = promptText(decision.messages);
      if (!query || [...query].length > 2000) return decision;
      try {
        const requestSignal = AbortSignal.any([signal, identity]);
        const capabilities = await untilAborted(
          () => ctx.geaMemory.capabilities(requestSignal),
          requestSignal,
        );
        if (!active()) return decision;
        if (!capabilities.readOnly || !capabilities.memoryTypes.includes("preferences"))
          return decision;
        const result = await untilAborted(
          () => ctx.geaMemory.recall(query, requestSignal),
          requestSignal,
        );
        if (!active()) return decision;
        const body = result.memories
          .map((memory) => `${memory.uri}\n${memory.content}`)
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
}

function untilAborted(operation, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}
