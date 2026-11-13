import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import tradeAuthorization from '../lib/server/trade-authorization.ts';
const { authorizeTrade, verifyTradeAuthorization } = tradeAuthorization;
import sdkTrade from '../lib/sdk/trade/index.ts';
const { canApproveTrade } = sdkTrade;

function fixture() {
  const wallet = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 1 })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const unsigned = Buffer.from(tx.serialize()).toString('base64');
  const authorization = authorizeTrade(unsigned, 'test-order', wallet.publicKey.toBase58(), Date.now() + 10_000, 'test-secret');
  return { wallet, tx, unsigned, authorization };
}

test('only the reviewed message with a valid wallet signature can execute', () => {
  const { wallet, tx, unsigned, authorization } = fixture();
  assert.throws(() => verifyTradeAuthorization(authorization, unsigned, 'test-secret'), /signature/);
  tx.sign([wallet]);
  const signed = Buffer.from(tx.serialize()).toString('base64');
  assert.equal(verifyTradeAuthorization(authorization, signed, 'test-secret').requestId, 'test-order');
  assert.throws(() => verifyTradeAuthorization(authorization, signed, 'wrong-secret'), /authorization/);
  tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tx.sign([wallet]);
  assert.throws(() => verifyTradeAuthorization(authorization, Buffer.from(tx.serialize()).toString('base64'), 'test-secret'), /differs/);
});

test('expired quotes and a different wallet cannot be approved', () => {
  const { wallet, unsigned } = fixture();
  const expired = authorizeTrade(unsigned, 'old-order', wallet.publicKey.toBase58(), Date.now() - 1, 'test-secret');
  assert.throws(() => verifyTradeAuthorization(expired, unsigned, 'test-secret'), /expired/);
  assert.equal(canApproveTrade({ taker: 'wallet-a', transaction: 'transaction', expiresAt: 100 }, 'wallet-b', 1), false);
  assert.equal(canApproveTrade({ taker: 'wallet-a', transaction: 'transaction', expiresAt: 100 }, 'wallet-a', 100), false);
});
