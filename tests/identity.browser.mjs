import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("../../dsh-gea-plugin/node_modules/@playwright/test");
const url = process.env.MEMORY_UI_URL;
if (!url) throw Error("MEMORY_UI_URL required");
test("real Core settings clears drafts, filters and late receipts when the identity projection changes", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    await page.goto(url);
    await page
      .getByRole("button", { name: /^编辑记忆：/ })
      .first()
      .waitFor();
    await page.getByRole("button", { name: "工作习惯", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜索记忆内容" }).fill("我");
    await page
      .getByRole("button", { name: /^编辑记忆：/ })
      .first()
      .click();
    const edit = page.getByRole("dialog", { name: "编辑记忆", exact: true });
    await page
      .locator("#gea-memory-edit-content")
      .fill("旧身份的草稿和迟到回执");
    let release;
    let started;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const submitted = new Promise((resolve) => {
      started = resolve;
    });
    const alice = {
      environment: "production",
      tenantId: "10",
      userId: "alice",
    };
    await page.route("**/api/gea-proof/memory/update", async (route) => {
      const operationId = route.request().postDataJSON().operationId;
      started();
      await gate;
      await route
        .fulfill({
          json: {
            ok: true,
            value: {
              scope: alice,
              operationId,
              status: "completed",
              state: {
                scope: alice,
                generationEnabled: true,
                revision: 999,
                bankGeneration: 0,
                count: 99,
                updatedAt: null,
              },
            },
          },
        })
        .catch(() => {});
    });
    await edit.getByRole("button", { name: "保存修改", exact: true }).click();
    await submitted;
    const bob = { ...alice, userId: "bob" };
    await page.route("**/api/gea-proof/memory/list", (route) =>
      route.fulfill({
        json: {
          ok: true,
          value: {
            scope: bob,
            state: {
              scope: bob,
              generationEnabled: false,
              revision: 0,
              bankGeneration: 0,
              count: 0,
              updatedAt: null,
            },
            items: [],
          },
        },
      }),
    );
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("memory-fixture-identity", { detail: "synthetic-bob" }),
      ),
    );
    await edit.waitFor({ state: "hidden" });
    await page.getByText("还没有记忆", { exact: true }).waitFor();
    release();
    await page.waitForTimeout(50);
    assert.equal(
      await page.getByRole("searchbox", { name: "搜索记忆内容" }).inputValue(),
      "",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "全部", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.match(
      await page.locator(".gea-memory-list-heading").innerText(),
      /0 条/,
    );
    assert.equal(
      await page
        .getByRole("switch", { name: "生成对话记忆", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    await page.getByRole("button", { name: "清空记忆", exact: true }).click();
    const clear = page.getByRole("dialog", {
      name: "清空所有记忆？",
      exact: true,
    });
    await clear.getByLabel("输入“清空”以确认").fill("清空");
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("memory-fixture-identity", {
          detail: "synthetic-next-identity",
        }),
      ),
    );
    await clear.waitFor({ state: "hidden" });
    await page.getByText("还没有记忆", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清空记忆", exact: true }).click();
    assert.equal(await clear.getByLabel("输入“清空”以确认").inputValue(), "");
    console.log(
      JSON.stringify({
        identityProjectionReset: true,
        editDraftCleared: true,
        typedConfirmationCleared: true,
        lateReceiptIgnored: true,
        filtersReset: true,
      }),
    );
  } finally {
    await browser.close();
  }
});
