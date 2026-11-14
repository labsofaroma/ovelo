/** Sends one transaction through kit and waits for confirmation. */
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

export type Connection = ReturnType<typeof connect>;

export function connect(
  url: string,
  wsUrl = url
    .replace(/^http/, "ws")
    .replace(/:(\d+)$/, (_, p: string) => `:${Number(p) + 1}`),
) {
  const rpc = createSolanaRpc(url);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const confirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  async function send(
    feePayer: TransactionSigner,
    instructions: Instruction[],
  ): Promise<string> {
    const { value: blockhash } = await rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    await confirm(tx as Parameters<typeof confirm>[0], {
      commitment: "confirmed",
      skipPreflight: false,
    });
    return getSignatureFromTransaction(tx);
  }
  return { url, rpc, rpcSubscriptions, send };
}
