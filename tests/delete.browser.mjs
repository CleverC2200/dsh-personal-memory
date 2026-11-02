import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("../../dsh-gea-plugin/node_modules/@playwright/test");
const url = process.env.MEMORY_UI_URL;
const output = process.env.MEMORY_UI_OUTPUT;
if (!url || !output) throw Error("MEMORY_UI_URL and MEMORY_UI_OUTPUT required");
test("real Core settings confirms one delete then clears every category with typed confirmation", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(url);
    const remove = page.getByRole("button", { name: /^删除记忆：/ }).first();
    await remove.waitFor();
    const before = await page.locator(".gea-memory-item").count();
    await remove.click();
    const dialog = page.getByRole("dialog", {
      name: "删除这条记忆？",
      exact: true,
    });
    await dialog.waitFor();
    assert.equal(await page.locator(".gea-memory-item").count(), before);
    await page.screenshot({
      animations: "disabled",
      path: join(output, "delete-confirm-1440.png"),
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await remove.evaluate((el) => el === document.activeElement),
      true,
    );
    await remove.click();
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".gea-memory-item").count(), before - 1);
    const generation = await page
      .getByRole("switch", { name: "生成对话记忆", exact: true })
      .getAttribute("aria-checked");
    await page.getByRole("button", { name: "工作背景", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "搜索记忆内容" })
      .fill("没有这个关键词");
    await page.getByText("没有找到相关记忆", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清空记忆", exact: true }).click();
    const clear = page.getByRole("dialog", {
      name: "清空所有记忆？",
      exact: true,
    });
    await clear.waitFor();
    const confirm = clear.getByRole("button", {
      name: "确认清空",
      exact: true,
    });
    assert.equal(await confirm.isDisabled(), true);
    await clear.getByLabel("输入“清空”以确认").fill("清理");
    assert.equal(await confirm.isDisabled(), true);
    await clear.getByLabel("输入“清空”以确认").fill("清空");
    await page.setViewportSize({ width: 1280, height: 720 });
    const geometry = await page
      .getByRole("dialog", { name: "设置", exact: true })
      .boundingBox();
    const documentWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.equal(geometry.width, 800);
    assert.equal(geometry.height, 672);
    assert.equal(documentWidth, 1280);
    for (let index = 0; index < 6; index++) await page.keyboard.press("Tab");
    assert.equal(
      await clear.evaluate((el) => el.contains(document.activeElement)),
      true,
    );
    await writeFile(
      join(output, "geometry.json"),
      JSON.stringify(
        {
          viewport: { width: 1280, height: 720 },
          shell: geometry,
          documentWidth,
          modalFocusContained: true,
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      animations: "disabled",
      path: join(output, "clear-confirm-1280.png"),
    });
    let writes = 0;
    await page.route("**/api/gea-proof/memory/clear", async (route) => {
      writes++;
      const response = await route.fetch();
      assert.equal(response.ok(), true);
      await route.abort("connectionfailed");
    });
    await confirm.click();
    await clear.getByText(/清理结果待确认/).waitFor();
    assert.equal(await clear.getByLabel("输入“清空”以确认").isDisabled(), true);
    assert.equal(
      await clear
        .getByRole("button", { name: "取消", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await clear.isVisible(), true);
    await clear.getByRole("button", { name: "查询结果", exact: true }).click();
    await clear.waitFor({ state: "hidden" });
    assert.equal(writes, 1);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜索记忆内容" }).fill("");
    await page.getByText("还没有记忆", { exact: true }).waitFor();
    assert.equal(await page.locator(".gea-memory-item").count(), 0);
    assert.equal(
      await page
        .getByRole("switch", { name: "生成对话记忆", exact: true })
        .getAttribute("aria-checked"),
      generation,
    );
    assert.match(
      await page.locator(".gea-memory-list-heading").innerText(),
      /0 条/,
    );
    console.log(
      JSON.stringify({
        sizes: ["1440x900", "1280x720"],
        singleDeleteConfirmed: true,
        escapeFocusRestored: true,
        typedClearAllCategories: true,
        unknownClearWrites: writes,
        generationPreserved: true,
      }),
    );
  } finally {
    await browser.close();
  }
});
