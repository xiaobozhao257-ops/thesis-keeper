import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: undefined,
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Thesis Keeper product shell", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Thesis Keeper｜AI 投资决策复盘<\/title>/i);
  assert.match(html, /THESIS/);
  assert.match(html, /华星智算/);
  assert.match(html, /投资组合/);
  assert.match(html, /论点健康度仅表示|不构成证券分析/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("server-renders all six primary routes", async () => {
  const routes = [
    ["/portfolio", "投资组合"],
    ["/theses/new", "新建论点"],
    ["/theses/demo-thesis", "论点详情"],
    ["/evidence", "证据中心"],
    ["/reviews/demo-review", "论点复盘"],
    ["/decisions", "决策记录"],
  ];

  for (const [pathname, copy] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), new RegExp(copy), pathname);
  }
});
