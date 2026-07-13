import assert from "node:assert/strict";
import test from "node:test";

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

test("server-renders the bilingual three-game tactician shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>棋局参谋 \| Assassin&#x27;s Creed Board Game AI<\/title>/i);
  assert.match(html, /棋局参谋/);
  assert.match(html, /aria-label="切换棋类"/);
  assert.match(html, />迂棋<\/button>/);
  assert.match(html, />西洋跳棋<\/button>/);
  assert.match(html, />莫里斯九子棋<\/button>/);
  assert.match(html, />EN<\/button>/);
  assert.match(html, /aria-label="迂棋棋盘，对手在上，我方在下"/);
  assert.match(html, /录入对手棋路/);
  assert.doesNotMatch(html, /aria-label="切换先手并重新开局"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
