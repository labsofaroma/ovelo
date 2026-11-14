import { expect, test } from "vitest";
import { setTimeout as wait } from "node:timers/promises";
import { createResearchClient } from "./client";

/** Fixture loaders return loosely-typed research objects; the cast keeps the tests focused on behaviour. */
const createClient = (...args: unknown[]) =>
  (
    createResearchClient as (
      ...a: unknown[]
    ) => ReturnType<typeof createResearchClient>
  )(...args);

// Transport fixtures live only in tests; no company values are supplied by the client cache.
const response = (mint: string, status = "available") => ({
  mint,
  symbol: "TEST",
  asOf: new Date().toISOString(),
  status,
  profile: null,
  bars: [],
  technicals: null,
  fundamentals: [],
  news: [],
  events: [],
  sources: [],
  warnings: [],
});
const signal = () => new AbortController().signal;
function deferredLoader() {
  const calls: {
    mint: string;
    signal: AbortSignal;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }[] = [];
  const loader = (mint: string, abortSignal: AbortSignal) =>
    new Promise((resolve, reject) => {
      calls.push({ mint, signal: abortSignal, resolve, reject });
      abortSignal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  return { calls, loader };
}

test("research readers coalesce, cancel independently, and reuse a fresh response", async () => {
  const { calls, loader } = deferredLoader();
  const client = createClient(loader);
  const first = new AbortController();
  const a = client.load("one", first.signal);
  const b = client.load("one", signal());
  await Promise.resolve();
  expect(calls.length).toBe(1);
  first.abort();
  await await expect(a).rejects.toMatchObject({ name: "AbortError" });
  expect(calls[0]!.signal.aborted).toBe(false);
  const value = response("one");
  calls[0]!.resolve(value);
  expect(await b).toBe(value);
  expect(await client.load("one", signal())).toBe(value);
  expect(calls.length).toBe(1);
  expect(client.peek("one")!.asOf).toBe(value.asOf);
  const forced = client.load("one", signal(), true);
  await Promise.resolve();
  expect(calls.length).toBe(2);
  calls[1]!.resolve(value);
  await forced;
});

test("stale research stays readable during revalidation and after provider failure, then expires", async () => {
  let now = 0;
  let fail = false;
  let calls = 0;
  const client = createClient(
    async (mint: string) => {
      calls += 1;
      if (fail) throw new Error("Provider unavailable");
      return response(mint);
    },
    { now: () => now, freshMs: 10, retainMs: 100 },
  );
  const value = await client.load("one", signal());
  now = 11;
  fail = true;
  const refresh = client.load("one", signal());
  expect(client.peek("one")).toBe(value);
  await await expect(refresh).rejects.toThrow(/Provider unavailable/);
  expect(client.peek("one")).toBe(value);
  expect(calls).toBe(2);
  now = 101;
  expect(client.peek("one")).toBe(null);
});

test("partial and unavailable research retry sooner than complete responses", async () => {
  let now = 0;
  const calls = new Map();
  const client = createClient(
    async (mint: string) => {
      calls.set(mint, (calls.get(mint) ?? 0) + 1);
      return response(mint, mint);
    },
    { now: () => now, freshMs: 100, partialMs: 10, unavailableMs: 5 },
  );
  for (const mint of ["available", "partial", "unavailable"])
    await client.load(mint, signal());
  now = 6;
  for (const mint of ["available", "partial", "unavailable"])
    await client.load(mint, signal());
  expect([...calls.values()]).toEqual([1, 1, 2]);
  now = 11;
  await client.load("partial", signal());
  expect(calls.get("partial")).toBe(2);
});

test("rapid remounts share the request, and the last departing reader aborts it", async () => {
  const { calls, loader } = deferredLoader();
  const client = createClient(loader, { abortGraceMs: 10 });
  const first = new AbortController();
  const a = client.load("one", first.signal);
  await Promise.resolve();
  first.abort();
  await await expect(a).rejects.toMatchObject({ name: "AbortError" });
  const second = new AbortController();
  const b = client.load("one", second.signal);
  await wait(20);
  expect(calls.length).toBe(1);
  expect(calls[0]!.signal.aborted).toBe(false);
  second.abort();
  await await expect(b).rejects.toMatchObject({ name: "AbortError" });
  await wait(20);
  expect(calls[0]!.signal.aborted).toBe(true);
  expect(client.peek("one")).toBe(null);
  const retry = client.load("one", signal());
  await Promise.resolve();
  expect(calls.length).toBe(2);
  calls[1]!.resolve(response("one"));
  await retry;
});

test("invalid identity, data arrays, dates, and status never enter the research cache", async () => {
  for (const invalid of [
    { ...response("one"), mint: "another" },
    { ...response("one"), news: null },
    { ...response("one"), asOf: "invalid date" },
    { ...response("one"), status: "unknown" },
    { ...response("one"), refreshing: "yes" },
  ]) {
    const client = createClient(async () => invalid);
    await await expect(client.load("one", signal())).rejects.toThrow(
      /invalid response/,
    );
    expect(client.peek("one")).toBe(null);
  }
});

test("the research cache evicts the least recently read response", async () => {
  const client = createClient(async (mint: string) => response(mint), {
    maxEntries: 2,
  });
  await client.load("one", signal());
  await client.load("two", signal());
  client.peek("one");
  await client.load("three", signal());
  expect(client.peek("one")).toBeTruthy();
  expect(client.peek("two")).toBe(null);
  expect(client.peek("three")).toBeTruthy();
});

test("deadline failure cancels transport and permits a later retry", async () => {
  const { calls, loader } = deferredLoader();
  const client = createClient(loader, { timeoutMs: 10 });
  await await expect(client.load("one", signal())).rejects.toThrow(
    /too long to respond/,
  );
  expect(calls[0]!.signal.aborted).toBe(true);
  const retry = client.load("one", signal());
  await Promise.resolve();
  calls[1]!.resolve(response("one"));
  expect((await retry).mint).toBe("one");
});

test("already cancelled readers never start a provider request", async () => {
  let calls = 0;
  const client = createClient(async (mint: string) => {
    calls += 1;
    return response(mint);
  });
  const controller = new AbortController();
  controller.abort();
  await await expect(
    client.load("one", controller.signal),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(calls).toBe(0);
});

test("server observation age bounds client freshness instead of restarting its TTL", async () => {
  const observedAt = Date.parse("2026-09-13T12:00:00.000Z");
  let now = observedAt + 900;
  let calls = 0;
  const value = {
    ...response("one"),
    asOf: new Date(observedAt).toISOString(),
  };
  const client = createClient(
    async () => {
      calls += 1;
      return value;
    },
    {
      now: () => now,
      freshMs: 1_000,
    },
  );
  await client.load("one", signal());
  now = observedAt + 999;
  await client.load("one", signal());
  expect(calls).toBe(1);
  now = observedAt + 1_000;
  await client.load("one", signal());
  expect(calls).toBe(2);
  now += 1;
  await client.load("one", signal());
  expect(calls).toBe(3);
  expect(client.peek("one")!.asOf).toBe(value.asOf);
});

test("refreshing server snapshots remain readable but immediately eligible for revalidation", async () => {
  let calls = 0;
  const value = response("one");
  const client = createClient(async () => {
    calls += 1;
    return { ...value, refreshing: calls === 1 };
  });
  await client.load("one", signal());
  expect(client.peek("one")!.refreshing).toBe(true);
  const completed = await client.load("one", signal());
  expect(calls).toBe(2);
  expect(completed.refreshing).toBe(false);
  expect(await client.load("one", signal())).toBe(completed);
  expect(calls).toBe(2);
  expect(completed.asOf).toBe(value.asOf);
});
