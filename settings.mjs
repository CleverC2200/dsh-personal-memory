export function createMemorySettings({ fetch: transport = globalThis.fetch } = {}) {
  let snapshot = {
    state: null,
    items: [],
    loading: false,
    saving: false,
    error: "",
    pending: null,
  };
  const listeners = new Set();
  let lifetime = new AbortController();
  let loading;
  const publish = (patch) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  async function request(endpoint, body, identity) {
    const response = await transport("/api/gea-proof/memory/" + endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([identity.signal, AbortSignal.timeout(12000)]),
    });
    const result = await response.json();
    identity.signal.throwIfAborted();
    if (!response.ok || result.ok !== true)
      throw Error(result.error?.code ?? "MEMORY_REQUEST_FAILED");
    return result.value;
  }
  const message = (error) => {
    if (error.message === "MEMORY_NOT_CONFIGURED") return "记忆服务尚未配置，请联系管理员。";
    if (["LOGIN_REQUIRED", "MEMORY_UNAUTHENTICATED"].includes(error.message))
      return "请先登录 GEA，再查看当前账号的记忆。";
    if (error.message === "MEMORY_VERSION_CONFLICT")
      return "记忆设置已在其他位置更新，请重新加载。";
    return "记忆服务暂时不可用，请重试。";
  };
  async function load() {
    if (loading) return loading;
    const identity = lifetime;
    publish({ loading: true, error: "" });
    loading = (async () => {
      try {
        const result = await request("list", {}, identity);
        if (identity !== lifetime) return;
        publish({ state: result.state, items: result.items });
      } catch (error) {
        if (identity === lifetime && !identity.signal.aborted) publish({ error: message(error) });
      } finally {
        if (identity === lifetime) {
          loading = undefined;
          publish({ loading: false });
        }
      }
    })();
    return loading;
  }
  async function save(pending, verify) {
    const identity = lifetime;
    publish({ saving: true, error: "", pending });
    try {
      let result;
      if (verify) {
        try {
          result = await request("operations", { operationId: pending.operationId }, identity);
        } catch (error) {
          if (error.message !== "MEMORY_NOT_FOUND") throw error;
        }
      }
      if (!result) result = await request("settings", pending, identity);
      if (identity !== lifetime) return;
      if (result.status !== "completed") {
        publish({ error: "设置结果待确认，请查询结果后继续。" });
        return;
      }
      publish({ state: result.state, pending: null });
    } catch (error) {
      if (identity !== lifetime || identity.signal.aborted) return;
      if (
        [
          "MEMORY_VERSION_CONFLICT",
          "MEMORY_OPERATION_CONFLICT",
          "MEMORY_INVALID_REQUEST",
          "MEMORY_UNAUTHENTICATED",
          "LOGIN_REQUIRED",
        ].includes(error.message)
      )
        publish({ error: message(error), pending: null });
      else publish({ error: "设置结果待确认，请查询结果后继续。" });
    } finally {
      if (identity === lifetime) publish({ saving: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    toggle(enabled) {
      if (snapshot.saving || snapshot.pending || !snapshot.state) return Promise.resolve();
      return save(
        {
          generationEnabled: enabled,
          expectedRevision: snapshot.state.revision,
          operationId: crypto.randomUUID(),
        },
        false,
      );
    },
    verify() {
      if (!snapshot.pending || snapshot.saving) return Promise.resolve();
      return save(snapshot.pending, true);
    },
    reset() {
      lifetime.abort();
      lifetime = new AbortController();
      loading = undefined;
      publish({ state: null, items: [], loading: false, saving: false, error: "", pending: null });
    },
    dispose() {
      lifetime.abort();
      listeners.clear();
    },
  };
}
