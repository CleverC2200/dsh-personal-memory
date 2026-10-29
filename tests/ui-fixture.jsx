import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Context } from "@deepseek-ai/cordis";
import { SlotRegistry } from "@memory-core/registry";
import { createSlotRenderer } from "@memory-core/renderer";
import { SettingsRoot } from "@memory-core/settings";
import { createSettingsShellStore } from "@memory-core/settings-store";
import { zh } from "@memory-core/locales";
import { apply, sectionId } from "../client.jsx";
import "@memory-core/theme/base.css";
import "@memory-core/theme/design-platform.css";
import "@memory-core/theme/scrollbar.css";
const ctx = new Context();
const slots = new SlotRegistry(ctx);
slots.install(createSlotRenderer());
const emptyBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
const emptySource = { getSnapshot: () => emptyBinding, subscribe: () => () => {} };
slots.installScope("session", { current: emptySource, bindingSource: () => emptySource });
const shell = createSettingsShellStore().create();
const snapshot = { scope: "synthetic-alice", state: "confirmed" };
ctx.provide("uiWorkspace", {
  openSession(sessionId) {
    document.getElementById("fixture-navigation").textContent = "已打开来源会话：" + sessionId;
  },
});
ctx.provide("geaIdentity", { getSnapshot: () => snapshot, subscribe: () => () => {} });
function Fixture({ renderSlot }) {
  const props = {
    useStore: (select) =>
      select(useSyncExternalStore(shell.subscribe, shell.getSnapshot, shell.getSnapshot)),
    actions: shell.actions,
    useShortcuts: (select) => select([]),
    useSessions: (select) =>
      select({ ids: [], byId: {}, phase: "ready", projectionsBySession: {} }),
    useSessionStatus: (select) => select(new Map()),
    usePanelInfo: (select) => select({ activePanelId: null }),
    useSessionRetainInfo: () => undefined,
    useResource: () => ({ status: "none" }),
    useWorkspaces: () => undefined,
    wide: true,
    reconnect: () => {},
    openDesktopUpdate: () => {},
    useDesktopUpdate: (select) => select({ failed: false, opening: false }),
    t: (key) => zh[key] ?? key,
    useConnectionState: (select) => select("connected"),
    useOnboardingSteps: (select) => select([]),
    useSections: (select) =>
      select(
        ctx.slots.entries("settings.section").map((entry) => ({
          id: entry.options.id,
          order: entry.options.order,
          label: entry.options.label(),
        })),
      ),
    renderSlot,
  };
  return (
    <>
      <p id="fixture-navigation" style={{ padding: 24 }}>
        个人记忆公开设置入口 · 合成 HTTP 验收
      </p>
      <SettingsRoot {...props} />
    </>
  );
}
slots.register(
  {
    name: "root",
    children: Object.fromEntries(
      ["section", "header", "trigger", "close", "action", "launcher", "onboarding"].map((key) => [
        "settings." + key,
        {
          kind: ["section", "action", "onboarding"].includes(key) ? "list" : "single",
          scope: "root",
        },
      ]),
    ),
  },
  Fixture,
);
slots.register({ name: "settings.header" }, () => "设置");
slots.register({ name: "settings.trigger" }, () => "设置");
slots.register({ name: "settings.close" }, () => "关闭设置");
slots.register(
  { name: "settings.section", id: "general", order: 0, label: () => "通用设置" },
  () => <p>通用设置</p>,
);
slots.register(
  {
    name: "settings.section",
    id: "plugin-manager",
    order: Number.MAX_SAFE_INTEGER,
    label: () => "插件管理",
  },
  () => <p>插件管理</p>,
);
apply(ctx);
shell.actions.openSection(sectionId);
createRoot(document.getElementById("root")).render(slots.renderSlot("root", {}));
