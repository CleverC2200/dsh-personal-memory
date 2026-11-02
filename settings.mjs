export function createMemorySettings({
  fetch: transport = globalThis.fetch,
} = {}) {
  let snapshot = {
    state: null,
    items: [],
    loading: false,
    saving: false,
    error: "",
    pending: null,
    editing: null,
    editPending: null,
    editSaving: false,
    editError: "",
    editStatus: null,
    sourceBusy: null,
    identityEpoch: 0,
    removal: null,
    removalPending: null,
    removalSaving: false,
    removalError: "",
    confirmation: "",
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
    if (error.message === "MEMORY_NOT_CONFIGURED")
      return "记忆服务尚未配置，请联系管理员。";
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
        if (
          result.state.pendingCleanup &&
          !snapshot.removalPending &&
          !snapshot.pending
        ) {
          const pending = result.state.pendingCleanup;
          publish({
            removal: { kind: pending.kind },
            removalPending: pending,
            removalError: "清理结果待确认，请查询原操作后继续。",
          });
        }
      } catch (error) {
        if (identity === lifetime && !identity.signal.aborted)
          publish({ error: message(error) });
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
          result = await request(
            "operations",
            { operationId: pending.operationId },
            identity,
          );
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
  async function saveEdit(verify = false, retry = false) {
    if (
      !snapshot.editing ||
      snapshot.editSaving ||
      (!verify && snapshot.editPending && !retry)
    )
      return;
    if (!snapshot.editing.content.trim()) {
      publish({ editError: "记忆内容不能为空。" });
      return;
    }
    const identity = lifetime;
    const pending = snapshot.editPending ?? {
      id: snapshot.editing.id,
      category: snapshot.editing.category,
      content: snapshot.editing.content.trim(),
      expectedVersion: snapshot.editing.version,
      expectedRevision: snapshot.state.revision,
      bankGeneration: snapshot.state.bankGeneration,
      operationId: crypto.randomUUID(),
    };
    publish({
      editSaving: true,
      editPending: pending,
      editError: "",
      editStatus: "processing",
    });
    try {
      let result;
      if (verify) {
        try {
          result = await request(
            "operations",
            { operationId: pending.operationId },
            identity,
          );
        } catch (error) {
          if (error.message !== "MEMORY_NOT_FOUND") throw error;
        }
      }
      if (!result) result = await request("update", pending, identity);
      if (identity !== lifetime) return;
      if (result.status === "completed") {
        publish({
          state: result.state,
          editing: null,
          editPending: null,
          editError: "",
          editStatus: null,
        });
        await load();
      } else if (result.status === "failed") {
        publish({
          state: result.state,
          editPending: null,
          editStatus: null,
          editError: "保存失败，草稿已保留，请重试。",
        });
      } else
        publish({
          editStatus: result.status,
          editError: "保存结果待确认，请查询原操作后继续。",
        });
    } catch (error) {
      if (identity !== lifetime || identity.signal.aborted) return;
      if (
        [
          "MEMORY_VERSION_CONFLICT",
          "MEMORY_OPERATION_CONFLICT",
          "MEMORY_INVALID_REQUEST",
          "MEMORY_OPERATION_PENDING",
        ].includes(error.message)
      )
        publish({
          editPending: null,
          editStatus: null,
          editError:
            error.message === "MEMORY_VERSION_CONFLICT"
              ? "这条记忆已在其他位置更新，草稿已保留，请重新加载后再编辑。"
              : "保存未成功，草稿已保留，请重新加载后重试。",
        });
      else
        publish({
          editStatus: "unknown",
          editError: "保存结果待确认，请查询原操作后继续。",
        });
    } finally {
      if (identity === lifetime) publish({ editSaving: false });
    }
  }
  async function reloadEdit() {
    if (!snapshot.editing || snapshot.editSaving || snapshot.editPending)
      return;
    const identity = lifetime;
    const id = snapshot.editing.id;
    publish({ editSaving: true });
    try {
      const result = await request("get", { id }, identity);
      const state = await request("state", {}, identity);
      if (identity === lifetime)
        publish({ editing: { ...result.item }, state, editError: "" });
    } catch {
      if (identity === lifetime)
        publish({ editError: "重新加载失败，草稿已保留。" });
    } finally {
      if (identity === lifetime) publish({ editSaving: false });
    }
  }
  const busy = () =>
    snapshot.saving ||
    snapshot.pending ||
    snapshot.editSaving ||
    snapshot.editPending ||
    snapshot.removalSaving ||
    snapshot.removalPending;
  async function saveRemoval(verify = false) {
    if (
      !snapshot.removal ||
      snapshot.removalSaving ||
      (!verify && snapshot.removalPending)
    )
      return;
    if (
      snapshot.removal.kind === "clear" &&
      !snapshot.removalPending &&
      snapshot.confirmation !== "清空"
    )
      return;
    const identity = lifetime;
    const kind = snapshot.removal.kind;
    const pending = snapshot.removalPending ?? {
      operationId: crypto.randomUUID(),
      expectedRevision: snapshot.state.revision,
      bankGeneration: snapshot.state.bankGeneration,
      ...(kind === "delete"
        ? {
            id: snapshot.removal.item.id,
            expectedVersion: snapshot.removal.item.version,
          }
        : { confirmation: "清空" }),
    };
    publish({ removalSaving: true, removalPending: pending, removalError: "" });
    try {
      let result;
      try {
        result = await request(
          verify ? "operations" : kind,
          verify ? { operationId: pending.operationId } : pending,
          identity,
        );
      } catch (error) {
        if (
          !verify ||
          error.message !== "MEMORY_NOT_FOUND" ||
          pending.expectedRevision === undefined
        )
          throw error;
        result = await request(kind, pending, identity);
      }
      if (identity !== lifetime) return;
      if (result.status === "completed") {
        publish({
          state: result.state,
          removal: null,
          removalPending: null,
          removalError: "",
          confirmation: "",
        });
        await load();
      } else if (result.status === "failed") {
        publish({
          state: result.state,
          removalPending: null,
          removalError: "清理未完成，请重新加载后重试。",
        });
      } else {
        publish({
          state: result.state,
          removalError:
            "清理结果待确认，相关记忆已退出召回。请查询原操作后继续。",
        });
        await load();
      }
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
        publish({ removalPending: null, removalError: message(error) });
      else publish({ removalError: "清理结果待确认，请查询原操作后继续。" });
    } finally {
      if (identity === lifetime) publish({ removalSaving: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    remove(item) {
      if (busy() || !snapshot.state) return;
      publish({
        removal: { kind: "delete", item },
        removalError: "",
        confirmation: "",
      });
    },
    clear() {
      if (busy() || !snapshot.state) return;
      publish({
        removal: { kind: "clear" },
        removalError: "",
        confirmation: "",
      });
    },
    changeConfirmation(confirmation) {
      if (!snapshot.removalSaving && !snapshot.removalPending)
        publish({ confirmation });
    },
    cancelRemoval() {
      if (!snapshot.removalSaving && !snapshot.removalPending)
        publish({ removal: null, removalError: "", confirmation: "" });
    },
    confirmRemoval: () => saveRemoval(),
    verifyRemoval: () => saveRemoval(true),
    edit(item) {
      if (busy()) return;
      publish({ editing: { ...item }, editError: "" });
    },
    changeEdit(patch) {
      if (snapshot.editing && !snapshot.editSaving && !snapshot.editPending)
        publish({ editing: { ...snapshot.editing, ...patch }, editError: "" });
    },
    cancelEdit() {
      if (!snapshot.editSaving && !snapshot.editPending)
        publish({ editing: null, editError: "" });
    },
    saveEdit: () => saveEdit(false),
    verifyEdit: () => saveEdit(true),
    retryEdit: () =>
      snapshot.editStatus === "unknown"
        ? saveEdit(false, true)
        : Promise.resolve(),
    reloadEdit,
    async source(item, navigate, close) {
      if (snapshot.sourceBusy) return;
      const identity = lifetime;
      publish({ sourceBusy: item.id, error: "" });
      try {
        const result = await request("source", { id: item.id }, identity);
        if (identity !== lifetime) return;
        await navigate(result.sessionId);
        if (identity === lifetime) close?.();
      } catch {
        if (identity === lifetime)
          publish({ error: "来源不可用或当前账号无权访问。" });
      } finally {
        if (identity === lifetime) publish({ sourceBusy: null });
      }
    },
    toggle(enabled) {
      if (
        snapshot.saving ||
        snapshot.pending ||
        snapshot.editPending ||
        snapshot.editSaving ||
        snapshot.removalSaving ||
        snapshot.removalPending ||
        !snapshot.state
      )
        return Promise.resolve();
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
      publish({
        identityEpoch: snapshot.identityEpoch + 1,
        removal: null,
        removalPending: null,
        removalSaving: false,
        removalError: "",
        confirmation: "",
        state: null,
        items: [],
        loading: false,
        saving: false,
        error: "",
        pending: null,
        editing: null,
        editPending: null,
        editSaving: false,
        editError: "",
        editStatus: null,
        sourceBusy: null,
      });
    },
    dispose() {
      lifetime.abort();
      listeners.clear();
    },
  };
}
