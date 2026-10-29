import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Input, Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import { createMemorySettings } from "./settings.mjs";
import styles from "./memory.css";

export const inject = ["slots", "geaIdentity"];
export const sectionId = "gea-personal-memory";
const categories = [
  ["", "全部"],
  ["background", "工作背景"],
  ["preference", "表达偏好"],
  ["habit", "工作习惯"],
];
const categoryLabels = Object.fromEntries(categories);
function timeLabel(value) {
  if (!value) return "尚无更新";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : date.toLocaleString("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function MemoryIcon() {
  return (
    <svg
      width="20"
      height="24"
      viewBox="0 0 20 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M7 19h6M8 22h4M6 15c-5-5-3-12 4-12s9 7 4 12v2H6v-2Z" />
      <path d="M10 6v8M7 10h6" />
    </svg>
  );
}
export function MemorySection({ controller, actions, close }) {
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  useEffect(() => {
    void controller.load();
  }, [controller]);
  useEffect(() => {
    if (!view.state) {
      setQuery("");
      setCategory("");
    }
  }, [view.state]);
  const items = view.items.filter(
    (item) =>
      (!category || item.category === category) &&
      (item.title + "\n" + item.content)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="gea-memory" aria-label="记忆与进化" aria-busy={view.loading}>
      <style>{styles}</style>
      <header className="gea-memory-heading">
        <h1>记忆与进化</h1>
        <p>让 GEA 记住你的偏好与工作习惯，协作越多，越懂你。</p>
      </header>
      <div className="gea-memory-generation">
        <div className="gea-memory-generation-title">
          <MemoryIcon />
          <h2 id="gea-memory-generation">生成对话记忆</h2>
        </div>
        <div className="gea-memory-toggle">
          <span aria-live="polite">
            {view.saving
              ? "保存中…"
              : !view.state
                ? "读取中…"
                : view.state.generationEnabled
                  ? "已开启"
                  : "已关闭"}
          </span>
          <Switch
            checked={view.state?.generationEnabled === true}
            onChange={(enabled) => void controller.toggle(enabled)}
            disabled={!view.state || view.saving || !!view.pending}
            label="生成对话记忆"
          />
        </div>
        <p>允许 GEA 从后续对话中提取并更新与你有关的记忆。</p>
        <p className="gea-memory-detail">关闭后不再生成新记忆，已有记忆仍可用于回答。</p>
      </div>
      <div className="gea-memory-list-heading">
        <h2>
          我的记忆 <span>{view.state ? `${view.state.count} 条` : ""}</span>
        </h2>
        {actions?.clear && (
          <Button
            size="sm"
            className="gea-memory-danger"
            disabled={!view.items.length || view.saving}
            onClick={() => actions.clear()}
          >
            清空记忆
          </Button>
        )}
      </div>
      <p className="gea-memory-summary">
        当前账号的个人记忆 · 最近更新 {timeLabel(view.state?.updatedAt)}
      </p>
      {view.error && (
        <div className="gea-memory-error" role="alert">
          <span>{view.error}</span>
          <Button
            size="sm"
            onClick={() => void (view.pending ? controller.verify() : controller.load())}
            disabled={view.loading || view.saving}
          >
            {view.pending ? "查询结果" : "重新加载"}
          </Button>
        </div>
      )}
      <Input
        className="gea-memory-search"
        type="search"
        aria-label="搜索记忆内容"
        placeholder="搜索记忆内容"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={!view.state}
      />
      <div className="gea-memory-categories" role="group" aria-label="记忆分类">
        {categories.map(([id, label]) => (
          <Button key={id} size="sm" aria-pressed={category === id} onClick={() => setCategory(id)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="gea-memory-items" aria-live="polite">
        {view.loading && !view.state ? (
          <p className="gea-memory-empty" role="status">
            正在读取当前账号的记忆…
          </p>
        ) : !view.state ? (
          <p className="gea-memory-empty">暂时无法读取记忆，请重新加载。</p>
        ) : items.length === 0 ? (
          <div className="gea-memory-empty">
            <h3>{view.items.length ? "没有找到相关记忆" : "还没有记忆"}</h3>
            <p>
              {view.items.length
                ? "试试其他关键词或分类。"
                : "开启生成后，GEA 会从后续对话中记住你的稳定偏好。"}
            </p>
          </div>
        ) : (
          items.map((item) => (
            <article className="gea-memory-item" key={item.id}>
              <span className="gea-memory-category">{categoryLabels[item.category]}</span>
              <div className="gea-memory-item-body">
                <h3>{item.title}</h3>
                <p>{item.content}</p>
                <small>
                  {timeLabel(item.updatedAt)} · {item.manuallyEdited ? "你已编辑" : "来自对话"}
                </small>
              </div>
              {actions && (
                <div className="gea-memory-actions">
                  {actions.source && (
                    <Button
                      size="sm"
                      onClick={() => actions.source(item, close)}
                      aria-label={`查看来源：${item.title}`}
                    >
                      来源
                    </Button>
                  )}
                  {actions.edit && (
                    <Button
                      size="sm"
                      onClick={() => actions.edit(item)}
                      aria-label={`编辑记忆：${item.title}`}
                    >
                      编辑
                    </Button>
                  )}
                  {actions.delete && (
                    <Button
                      size="sm"
                      onClick={() => actions.delete(item)}
                      aria-label={`删除记忆：${item.title}`}
                    >
                      删除
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
export function apply(ctx) {
  const controller = createMemorySettings();
  let identity = JSON.stringify([
    ctx.geaIdentity.getSnapshot().scope,
    ctx.geaIdentity.getSnapshot().state,
  ]);
  ctx.effect(() => {
    const unwatch = ctx.geaIdentity.subscribe(() => {
      const current = ctx.geaIdentity.getSnapshot();
      const next = JSON.stringify([current.scope, current.state]);
      if (next !== identity) {
        identity = next;
        controller.reset();
        void controller.load();
      }
    });
    return () => {
      unwatch();
      controller.dispose();
    };
  });
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: sectionId,
        order: Number.MAX_VALUE,
        label: () => "记忆与进化",
        inject: () => ({ controller }),
      },
      MemorySection,
    ),
  );
}
