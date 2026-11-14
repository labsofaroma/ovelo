import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, scrub } from "./log";

const key = Array.from({ length: 64 }, (_, i) => (i * 13) % 256);

describe("redacted JSON logs", () => {
  it("removes key material and secret-named fields, keeps addresses and amounts", () => {
    expect(
      scrub({
        keypair: key,
        nested: { apiKey: "abc", wallet: "9xQe", amount: 10n },
        list: [key],
        blob: JSON.stringify(key),
        bytes: new Uint8Array(64),
      }),
    ).toEqual({
      keypair: REDACTED,
      nested: { apiKey: REDACTED, wallet: "9xQe", amount: "10" },
      list: [REDACTED],
      blob: REDACTED,
      bytes: REDACTED,
    });
    const err = Object.assign(new Error("boom"), { secretToken: "x" });
    expect(scrub(err)).toMatchObject({
      name: "Error",
      message: "boom",
      secretToken: REDACTED,
    });
  });

  it("writes one JSON line per event without secrets", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = createLogger("info", sink);
    log.info({ KEEPER_KEYPAIR: JSON.stringify(key), plan: "p1" }, "hello");
    await new Promise((r) => setTimeout(r, 10));
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      msg: "hello",
      plan: "p1",
      service: "aroma-keeper",
      KEEPER_KEYPAIR: REDACTED,
    });
    expect(lines.join("")).not.toContain(String(key[5]) + "," + String(key[6]));
  });
});
