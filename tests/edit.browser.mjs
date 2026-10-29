import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("../../dsh-gea-plugin/node_modules/@playwright/test");
const url = process.env.MEMORY_UI_URL;
const output = process.env.MEMORY_UI_OUTPUT;
if (!url || !output) throw Error("MEMORY_UI_URL and MEMORY_UI_OUTPUT required");
test("real settings UI edits a memory, preserves conflict drafts, locks unknown operations, and opens authorized source", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    await page
      .getByRole("button", { name: /^编辑记忆：/ })
      .first()
      .waitFor();
    const edit = page.getByRole("button", { name: /^编辑记忆：/ }).first();
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "编辑记忆", exact: true });
    await dialog.waitFor();
    await page.locator("#gea-memory-edit-content").fill("");
    assert.equal(await dialog.getByRole("button", { name: "保存修改" }).isDisabled(), true);
    await page.locator("#gea-memory-edit-content").fill("我偏好先列行动步骤，再说明限制。");
    await page.locator("#gea-memory-edit-category").selectOption("habit");
    await page.screenshot({ animations: "disabled", path: join(output, "edit-1440.png") });
    await dialog.getByRole("button", { name: "保存修改" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("我偏好先列行动步骤，再说明限制。", { exact: true }).waitFor();
    assert.ok((await page.getByText(/你已编辑/).count()) > 0);
    await edit.click();
    await page.locator("#gea-memory-edit-content").fill("发生冲突也保留我的草稿");
    await page.route("**/api/gea-proof/memory/update", (route) =>
      route.fulfill({
        status: 409,
        json: { ok: false, error: { code: "MEMORY_VERSION_CONFLICT" } },
      }),
    );
    await dialog.getByRole("button", { name: "保存修改" }).click();
    await dialog.getByText(/这条记忆已在其他位置更新/).waitFor();
    assert.equal(
      await page.locator("#gea-memory-edit-content").inputValue(),
      "发生冲突也保留我的草稿",
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ animations: "disabled", path: join(output, "conflict-1280.png") });
    await dialog.getByRole("button", { name: "重新加载" }).click();
    await page.getByText(/这条记忆已在其他位置更新/).waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("#gea-memory-edit-content").inputValue(),
      "我偏好先列行动步骤，再说明限制。",
    );
    await page.unroute("**/api/gea-proof/memory/update");
    let writes = 0;
    await page.route("**/api/gea-proof/memory/update", async (route) => {
      writes++;
      const response = await route.fetch();
      assert.equal(response.ok(), true);
      await route.abort("connectionfailed");
    });
    await page.locator("#gea-memory-edit-content").fill("未知回执查询同一操作。");
    await dialog.getByRole("button", { name: "保存修改" }).click();
    await dialog.getByText(/保存结果待确认/).waitFor();
    assert.equal(await page.locator("#gea-memory-edit-content").isDisabled(), true);
    assert.equal(
      await dialog.getByRole("button", { name: "取消", exact: true }).isDisabled(),
      true,
    );
    await dialog.getByRole("button", { name: "查询结果" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(writes, 1);
    await page.getByText("未知回执查询同一操作。", { exact: true }).waitFor();
    await edit.click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await edit.evaluate((el) => el === document.activeElement), true);
    await page.route("**/api/gea-proof/memory/source", (route) =>
      route.fulfill({
        status: 403,
        json: { ok: false, error: { code: "MEMORY_SOURCE_UNAVAILABLE" } },
      }),
    );
    await page
      .getByRole("button", { name: /^查看来源：/ })
      .first()
      .click();
    await page.getByText("来源不可用或当前账号无权访问。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog", { name: "设置", exact: true }).isVisible(), true);
    await page.unroute("**/api/gea-proof/memory/source");
    await page
      .getByRole("button", { name: /^查看来源：/ })
      .first()
      .click();
    await page.getByText("已打开来源会话：synthetic-session", { exact: true }).waitFor();
    console.log(
      JSON.stringify({
        dimensions: ["1440x900", "1280x720"],
        saved: true,
        conflictDraftPreserved: true,
        unknownWriteCount: writes,
        escapeFocusRestored: true,
        authorizedSourceOpened: true,
      }),
    );
  } finally {
    await browser.close();
  }
});

test("failed initial loading shows unavailable beside the generation switch", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route("**/api/gea-proof/memory/list", (route) =>
      route.fulfill({ status: 401, json: { ok: false, error: { code: "LOGIN_REQUIRED" } } }),
    );
    await page.goto(url);
    await page.getByText("请先登录 GEA，再查看当前账号的记忆。", { exact: true }).waitFor();
    assert.equal(await page.locator(".gea-memory-toggle").innerText(), "暂不可用");
    assert.equal(await page.getByRole("switch", { name: "生成对话记忆" }).isDisabled(), true);
  } finally {
    await browser.close();
  }
});
