import { describe, expect, test, vi } from "vitest";
import {
  type HermesError,
  HermesUpdatesClient,
  normalizeFeedId,
} from "./hermes-updates";
import { toBase64 } from "./bytes";
import { sampleFeed, sampleUpdate } from "./test/fixtures";

const A = "a".repeat(64);
const B = "B".repeat(64);
const body = (over: Record<string, unknown> = {}) => ({
  binary: {
    encoding: "base64",
    data: [toBase64(sampleUpdate([sampleFeed(0xaa)]))],
  },
  parsed: [
    {
      id: A,
      price: {
        price: "21034500",
        conf: "12345",
        expo: -5,
        publish_time: 1_800_000_000,
      },
    },
    {
      id: B.toLowerCase(),
      price: { price: "-1", conf: "0", expo: -8, publish_time: 1_800_000_001 },
    },
  ],
  ...over,
});
const answer = (status: number, json: unknown) =>
  vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  }));

describe("Hermes binary updates client", () => {
  test("requests base64 + parsed updates with the bearer key and returns bigint prices", async () => {
    const fetch = answer(200, body());
    const client = new HermesUpdatesClient("https://hermes.example/", {
      apiKey: "k",
      fetch,
      now: () => 42,
    });
    const out = await client.latestUpdates([A, `0x${B}`, A]);
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(
      `https://hermes.example/v2/updates/price/latest?ids[]=0x${A}&ids[]=0x${"b".repeat(64)}&encoding=base64&parsed=true`,
    );
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(out.fetchedAt).toBe(42);
    expect(out.updates[0]![0]).toBe(0x50);
    expect(out.feeds).toEqual([
      {
        id: `0x${A}`,
        price: 21_034_500n,
        conf: 12_345n,
        expo: -5,
        publishTime: 1_800_000_000n,
      },
      {
        id: `0x${"b".repeat(64)}`,
        price: -1n,
        conf: 0n,
        expo: -8,
        publishTime: 1_800_000_001n,
      },
    ]);
  });

  test("no key: no Authorization header", async () => {
    const fetch = answer(200, body());
    await new HermesUpdatesClient("http://127.0.0.1:9", {
      fetch,
    }).latestUpdates([A]);
    const [, init] = fetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBeUndefined();
  });

  test("401/403 is unauthorized, 5xx is http, network failure is unreachable", async () => {
    const kind = async (
      fetch: ReturnType<typeof answer> | (() => Promise<never>),
    ) => {
      try {
        await new HermesUpdatesClient("https://h", { fetch }).latestUpdates([
          A,
        ]);
      } catch (e) {
        return (e as HermesError).kind;
      }
      return "none";
    };
    expect(await kind(answer(401, {}))).toBe("unauthorized");
    expect(await kind(answer(403, {}))).toBe("unauthorized");
    expect(await kind(answer(503, {}))).toBe("http");
    expect(
      await kind(async () => {
        throw new DOMException("timeout", "TimeoutError");
      }),
    ).toBe("unreachable");
  });

  test("a real timeout aborts the request", async () => {
    const fetch = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    await expect(
      new HermesUpdatesClient("https://h", {
        fetch,
        timeoutMs: 10,
      }).latestUpdates([A]),
    ).rejects.toMatchObject({ kind: "unreachable" });
  });

  test.each([
    ["not JSON", "throw"],
    ["binary missing", { parsed: [] }],
    ["wrong encoding", body({ binary: { encoding: "hex", data: ["00"] } })],
    ["empty binary", body({ binary: { encoding: "base64", data: [] } })],
    ["bad base64", body({ binary: { encoding: "base64", data: ["@@@"] } })],
    ["non-string item", body({ binary: { encoding: "base64", data: [1] } })],
    ["parsed missing", body({ parsed: undefined })],
    [
      "float price",
      body({
        parsed: [
          {
            id: A,
            price: { price: "1.5", conf: "1", expo: -5, publish_time: 1 },
          },
        ],
      }),
    ],
    [
      "bad id",
      body({
        parsed: [
          {
            id: "xyz",
            price: { price: "1", conf: "1", expo: -5, publish_time: 1 },
          },
        ],
      }),
    ],
    ["no price object", body({ parsed: [{ id: A }] })],
    ["requested feed missing", body({ parsed: [] })],
  ])("malformed: %s", async (_name, json) => {
    const fetch =
      json === "throw"
        ? vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error("x");
            },
          }))
        : answer(200, json);
    await expect(
      new HermesUpdatesClient("https://h", { fetch }).latestUpdates([A]),
    ).rejects.toMatchObject({ kind: "malformed" });
  });

  test("argument checks", async () => {
    expect(() => new HermesUpdatesClient("ftp://h")).toThrow(/http/);
    await expect(
      new HermesUpdatesClient("https://h").latestUpdates([]),
    ).rejects.toThrow();
    expect(() => normalizeFeedId("0x12")).toThrow(/feed id/);
  });
});
