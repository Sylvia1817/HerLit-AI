import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

test("browser preserves human approval across editing, review and downloads", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(process.env.BROWSER_BASE_URL ?? "http://127.0.0.1:4173");
    await page.locator('#publication-date').fill("2026-08-17");
    await page.getByRole('button', { name: '生成今日候选' }).click();
    await page.getByRole('button', { name: "确认 Today's Pick" }).click();
    await page.getByRole('button', { name: '开始资料核验' }).click();
    await page.getByRole('button', { name: '生成编辑初稿' }).click();
    const approve = page.getByRole('button', { name: '人工审核通过', exact: true });
    const published = page.getByRole('button', { name: '导出发布版 JSON' });
    await approve.waitFor();
    assert.equal(await published.isDisabled(), true);

    async function download(label) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      const file = await pending;
      return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
    }
    const draft = await download('导出 DRAFT Markdown');
    assert.match(draft.text, /^# DRAFT/);
    assert.match(draft.name, /-draft\.md$/);
    await approve.click();
    await page.getByRole('heading', { name: '人工审核已通过' }).waitFor();
    assert.equal(await published.isEnabled(), true);

    const hook = page.locator('.block-editor article').filter({ has: page.locator('span', { hasText: /^hook$/ }) }).locator('textarea');
    const changed = '今天，让我们从一个阅读入口重新遇见她。';
    await hook.fill(changed);
    assert.equal(await approve.isDisabled(), true);
    assert.equal(await published.isDisabled(), true);
    await page.getByText('STALE · NEEDS RE-REVIEW', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重新运行 Review' }).click();
    await page.getByText('CURRENT REVIEW', { exact: true }).waitFor();
    assert.equal(await published.isDisabled(), true);
    await approve.click();
    await page.getByRole('heading', { name: '人工审核已通过' }).waitFor();
    const json = await download('导出发布版 JSON');
    const payload = JSON.parse(json.text);
    assert.equal(payload.exportStatus, 'APPROVED');
    assert.equal(payload.editorialPackage.draft.blocks.find(block => block.role === 'hook').text, changed);
    assert.equal(payload.editorialPackage.status, 'draft');
    const markdown = await download('导出发布版 Markdown');
    assert.match(markdown.name, /-approved\.md$/);
    assert.ok(markdown.text.includes(changed));
    assert.doesNotMatch(markdown.text, /^# DRAFT/);
    assert.deepEqual(errors, []);
  } catch (error) {
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/browser-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
});
