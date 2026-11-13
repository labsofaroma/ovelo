import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, scrub } from "./logger";

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: createLogger({ level: "debug", destination }) };
}

const keypair = Array.from({ length: 64 }, (_, i) => (i * 7) % 256);

describe("logger redaction", () => {
  it("writes JSON lines with level and service", () => {
    const { lines, logger } = capture();
    logger.info({ route: "/api/v1/health" }, "hello");
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      service: "aroma-web",
      route: "/api/v1/health",
      msg: "hello",
    });
  });

  it("redacts authorization headers, secrets and tokens by key", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        headers: {
          authorization: "Bearer abc.def.ghi",
          cookie: "s=1",
          "x-ok": "visible",
        },
        apiKey: "k-123",
        nested: { password: "pw", token: "tok" },
      },
      "request",
    );
    const text = lines.join("");
    expect(text).not.toMatch(/abc\.def\.ghi|k-123|"pw"|"tok"|s=1/);
    expect(text).toContain("visible");
    expect(text).toContain(REDACTED);
  });

  it("redacts keypairs given as byte arrays, JSON strings or 128-char hex, under any key", () => {
    const { lines, logger } = capture();
    logger.warn(
      { weird: keypair, other: JSON.stringify(keypair), hex: "ab".repeat(64) },
      "keypair leak attempt",
    );
    const text = lines.join("");
    expect(text).not.toContain("ab".repeat(64));
    expect(text).not.toContain(JSON.stringify(keypair));
    expect(text).not.toContain(`[${keypair.slice(0, 4).join(",")}`);
    expect(text).toContain(REDACTED);
  });

  it("scrubs bearer tokens and URL credentials out of messages and error text", () => {
    const { lines, logger } = capture();
    logger.error(
      { err: new Error("failed postgres://admin:s3cret@db.example.com/x") },
      "Bearer topsecrettoken failed",
    );
    const text = lines.join("");
    expect(text).not.toMatch(/s3cret|topsecrettoken/);
  });

  it("scrubs inline key=value secrets in error text", () => {
    const { lines, logger } = capture();
    logger.error(
      { err: new Error("connect failed password=hunter2 token: abc123") },
      "db error",
    );
    expect(lines.join("")).not.toMatch(/hunter2|abc123/);
  });

  it("never throws on odd `err` values (non-Error objects, strings, undefined, messageless errors)", () => {
    const { lines, logger } = capture();
    const messageless = Object.assign(new Error("x"), { message: undefined });
    for (const err of [
      { type: "error", target: {} },
      "just a string",
      undefined,
      null,
      42,
      messageless,
    ]) {
      expect(() => logger.warn({ err }, "dependency failed")).not.toThrow();
    }
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("scrubs secrets inside a non-Error err object", () => {
    const { lines, logger } = capture();
    logger.warn(
      { err: { detail: "Bearer abc.def", note: "password=hunter2" } },
      "failed",
    );
    expect(lines.join("")).not.toMatch(/abc\.def|hunter2/);
  });

  it("leaves ordinary values alone", () => {
    expect(
      scrub({
        slot: 123,
        mint: "So11111111111111111111111111111111111111112",
        list: [1, 2, 3],
      }),
    ).toEqual({
      slot: 123,
      mint: "So11111111111111111111111111111111111111112",
      list: [1, 2, 3],
    });
  });
});
