/** Minimal JSON-RPC client. `readOnly()` refuses every method that could change chain state. */
export type JsonRpc = <T = unknown>(
  method: string,
  params?: unknown[],
) => Promise<T>;

export function httpRpc(url: string): JsonRpc {
  return async <T>(method: string, params: unknown[] = []) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as {
      result?: T;
      error?: { message: string };
    };
    if (!response.ok || body.error)
      throw new Error(
        `${method} failed: ${body.error?.message ?? response.status}`,
      );
    return body.result as T;
  };
}

export const READ_METHODS = new Set([
  "getGenesisHash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getSlot",
]);

export function readOnly(rpc: JsonRpc): JsonRpc {
  return (method, params) => {
    if (!READ_METHODS.has(method))
      throw new Error(
        `Refusing ${method}: this tool only reads public chain state.`,
      );
    return rpc(method, params);
  };
}
