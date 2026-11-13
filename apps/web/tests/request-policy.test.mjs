import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
function policy() {
  const exports = {};
  runInNewContext(compile("../lib/server/request-policy.ts"), {
    exports,
    TextDecoder,
    Uint8Array,
  });
  return exports;
}
test("request limiter bounds both quotas and key cardinality", () => {
  const limit = policy().createRequestLimiter(2, 1000, 2);
  assert.equal(limit("a", 1), 0);
  assert.equal(limit("a", 2), 0);
  assert.equal(limit("a", 3), 1);
  assert.equal(limit("b", 4), 0);
  assert.equal(limit("c", 5), 1);
  assert.equal(limit("c", 1002), 0);
});
test("chunked JSON bodies cannot bypass size checks", async () => {
  const { readLimitedJson } = policy();
  const request = new Request("http://localhost/", {
    method: "POST",
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"x":"'));
        c.enqueue(new TextEncoder().encode("a".repeat(100)));
        c.close();
      },
    }),
    duplex: "half",
  });
  await assert.rejects(() => readLimitedJson(request, 32), /too large/);
  const valid = await readLimitedJson(
    new Request("http://localhost/", {
      method: "POST",
      body: '{"amount":"1"}',
    }),
  );
  assert.equal(valid.amount, "1");
});

// M4: the middleware tests that were here moved to server/middleware.test.ts (Vitest), against
// the rewritten Node.js middleware (async, Upstash limiter, nonce CSP). Same assertions.
