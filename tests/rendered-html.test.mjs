import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the current HerLit editorial workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>HerLit AI｜女性文学 AI 内容工作台<\/title>/);
  assert.match(html, /HerLit 女性文学内容品牌背后的 AI 编辑系统/);
  assert.match(html, /今天，写哪一位她/);
  assert.match(html, /MOCK DATA/);
  assert.match(html, /生成今日候选/);
  assert.match(html, /Human review remains the publishing gate/);
  assert.doesNotMatch(html, /弗吉尼亚·伍尔夫|Virginia Woolf/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the finished site free of disposable starter assets", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|面向个人创作者/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});

test("built server runtime executes the complete mock API flow including review binding", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  async function post(path, body) {
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), env, ctx);
    if (response.status !== 200) {
      assert.fail(`API ${path} returned ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  const candidates = await post("/api/editorial/candidates", { date: "2026-08-17" });
  const research = await post("/api/editorial/research", {
    selectionId: candidates.meta.selectionId,
    selection: candidates.data,
    candidateId: candidates.data.selectedCandidate.id,
  });
  const production = await post("/api/editorial/produce", {
    selectionId: candidates.meta.selectionId,
    researchId: research.meta.researchId,
    selection: candidates.data,
    researchPack: research.data,
  });

  assert.equal(production.data.status, "draft");
  assert.equal(production.data.review.reviewedInputBinding.algorithm, "sha256");
  assert.match(production.data.review.reviewedInputBinding.fingerprint, /^[a-f0-9]{64}$/);
  const approval = await post("/api/editorial/approve", { packageId: production.meta.packageId });
  assert.equal(approval.data.packageId, production.meta.packageId);
  const exported = await post("/api/editorial/export", {
    packageId: production.meta.packageId,
    format: "json",
    preferredTitleIndex: 0,
    publishReady: true,
  });
  assert.equal(JSON.parse(exported.data.content).exportStatus, "APPROVED");
});
