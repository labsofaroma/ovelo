import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/aroma/Landing.tsx", import.meta.url),
  "utf8",
);

test("landing links only to existing app routes", () => {
  const routes = new Set(
    [...source.matchAll(/href="(\/[a-z/]*)"/g)].map((match) => match[1]),
  );
  for (const route of ["/app", "/markets", "/baskets", "/sip", "/portfolio"]) {
    assert.ok(routes.has(route), `missing link to ${route}`);
  }
});

test("landing carries no template crypto data or old branding", () => {
  for (const banned of ["Bitcoin", "Dogecoin", "Crypture", "APY"]) {
    assert.ok(!source.includes(banned), `unexpected ${banned}`);
  }
});

test("landing keeps hybrid-network honesty", () => {
  assert.match(source, /devnet test-token demo/);
  assert.match(source, /mainnet recurring is not available/);
});
