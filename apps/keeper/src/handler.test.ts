import { describe, expect, it, vi } from "vitest";
import { createHandler } from "./handler";
import { signQStashRequest } from "./qstash";
import { silent } from "./test/world";

const current = "sig_current_" + "c".repeat(24);
const next = "sig_next_" + "n".repeat(24);
const URL_RUN = "http://keeper.local/run";

function handler(run = vi.fn(async () => ({ ok: 1n }))) {
  return {
    run,
    handle: createHandler({
      log: silent,
      cluster: "devnet",
      currentKey: current,
      nextKey: next,
      run,
    }),
  };
}
const call = (body: string, signature?: string, init: RequestInit = {}) =>
  new Request(URL_RUN, {
    method: "POST",
    body,
    headers: signature ? { "Upstash-Signature": signature } : {},
    ...init,
  });

describe("keeper HTTP handler", () => {
  it("runs only with a valid QStash signature (current or next key)", async () => {
    const { run, handle } = handler();
    expect((await handle(call("{}"))).status).toBe(401);
    expect(
      (
        await handle(
          call(
            "{}",
            signQStashRequest({
              key: "x".repeat(30),
              url: URL_RUN,
              body: "{}",
            }),
          ),
        )
      ).status,
    ).toBe(401);
    expect(run).not.toHaveBeenCalled();
    const ok = await handle(
      call("{}", signQStashRequest({ key: current, url: URL_RUN, body: "{}" })),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: "1" });
    expect(
      (
        await handle(
          call(
            "{}",
            signQStashRequest({ key: next, url: URL_RUN, body: "{}" }),
          ),
        )
      ).status,
    ).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("health, unknown paths, wrong methods, oversized bodies, a failing run and an overlapping run", async () => {
    const { handle } = handler(
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(
      await (await handle(new Request("http://keeper.local/health"))).json(),
    ).toEqual({ ok: true, cluster: "devnet" });
    expect((await handle(new Request("http://keeper.local/nope"))).status).toBe(
      404,
    );
    expect((await handle(new Request(URL_RUN))).status).toBe(405);
    expect((await handle(call("x".repeat(20_000)))).status).toBe(413);
    const failed = await handle(
      call("{}", signQStashRequest({ key: current, url: URL_RUN, body: "{}" })),
    );
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toMatch(/boom/);
    let release: () => void = () => {};
    const slow = handler(
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: 0n });
          }),
      ),
    );
    const first = slow.handle(
      call("{}", signQStashRequest({ key: current, url: URL_RUN, body: "{}" })),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(
      (
        await slow.handle(
          call(
            "{}",
            signQStashRequest({ key: current, url: URL_RUN, body: "{}" }),
          ),
        )
      ).status,
    ).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });
});
