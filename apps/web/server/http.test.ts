import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import {
  assertSameOrigin,
  errorResponse,
  parse,
  parseValue,
  readLimitedJson,
} from "./http";

const chunked = (...parts: string[]) =>
  new Request("http://localhost/", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        for (const part of parts)
          controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    // @ts-expect-error Node's fetch requires duplex for streamed bodies.
    duplex: "half",
  });

describe("readLimitedJson (ported from request-policy.test)", () => {
  it("chunked JSON bodies cannot bypass size checks", async () => {
    const request = chunked('{"x":"', "a".repeat(100));
    await expect(readLimitedJson(request, 32)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("parses a valid body", async () => {
    const value = await readLimitedJson(
      new Request("http://localhost/", {
        method: "POST",
        body: '{"amount":"1"}',
      }),
    );
    expect(value).toEqual({ amount: "1" });
  });

  it("rejects a declared Content-Length over the cap before reading", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-length": "20000" },
      body: "{}",
    });
    await expect(readLimitedJson(request)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("requires a body", async () => {
    await expect(
      readLimitedJson(new Request("http://localhost/")),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("maps malformed JSON and invalid UTF-8 to INVALID_JSON without leaking parser text", async () => {
    const bad = new Request("http://localhost/", {
      method: "POST",
      body: "{nope",
    });
    await expect(readLimitedJson(bad)).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
    const invalidUtf8 = new Request("http://localhost/", {
      method: "POST",
      body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    });
    const error = await readLimitedJson(invalidUtf8).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).publicMessage).not.toMatch(
      /Unexpected|token|position/i,
    );
  });

  it("accepts a body exactly at the cap", async () => {
    const body = '{"a":"bbbbbbbbbbbbbbbbbbbb"}';
    const value = await readLimitedJson(
      new Request("http://localhost/", { method: "POST", body }),
      body.length,
    );
    expect(value).toEqual({ a: "bbbbbbbbbbbbbbbbbbbb" });
  });
});

describe("parse", () => {
  const schema = z.object({ amount: z.string().regex(/^\d+$/) });

  it("returns the typed value for a valid body", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      body: '{"amount":"42"}',
    });
    await expect(parse(schema)(request)).resolves.toEqual({ amount: "42" });
  });

  it("throws a zod error (mapped to VALIDATION_FAILED) for an invalid body", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      body: '{"amount":"-1"}',
    });
    await expect(parse(schema)(request)).rejects.toThrow();
    expect(() => parseValue(schema, { amount: 1 })).toThrow();
  });
});

describe("errorResponse", () => {
  it("returns { code, message } and hides internal text", async () => {
    const response = errorResponse(new Error("redis password=hunter2"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      code: "INTERNAL",
      message: "Something went wrong.",
    });
  });
});

describe("assertSameOrigin (AUDIT M-6)", () => {
  const post = (url: string, headers: Record<string, string>) =>
    new Request(url, { method: "POST", headers });
  it("accepts the origin the browser used even when request.url names localhost (next start)", () => {
    // Found by the M4 fork E2E: Next rewrote the host to localhost and a same-site POST was refused.
    expect(() =>
      assertSameOrigin(
        post("http://localhost:3200/api/v1/trade/quote", {
          host: "127.0.0.1:3200",
          origin: "http://127.0.0.1:3200",
        }),
      ),
    ).not.toThrow();
  });
  it("accepts no Origin (native clients) and refuses a foreign one", () => {
    expect(() =>
      assertSameOrigin(post("https://ovelo.example/x", {})),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        post("https://ovelo.example/x", {
          host: "ovelo.example",
          origin: "https://evil.example",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ORIGIN_FORBIDDEN" }));
  });
  it("ignores forwarded host headers unless the proxy is trusted", () => {
    const spoofed = post("https://ovelo.example/x", {
      host: "ovelo.example",
      "x-forwarded-host": "evil.example",
      origin: "https://evil.example",
    });
    expect(() => assertSameOrigin(spoofed)).toThrow();
  });
});
