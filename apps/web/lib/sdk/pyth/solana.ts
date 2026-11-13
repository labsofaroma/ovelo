/** On-chain Pyth price account reader. */

import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { PythOracleError, type PythPriceData } from "./types";

// ---------------------------------------------------------------------------
// On-Chain Pyth Solana Client
// ---------------------------------------------------------------------------

/** Pyth Solana Receiver Program ID */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);
export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT",
);

/**
 * On-chain reader for Pyth oracle feeds on Solana.
 * Reads long-lived price feed accounts directly using Solana RPC Connection.
 */
export class PythSolanaClient {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Derives the PDA address for a Pyth long-lived price feed account.
   * Seeds: [shard_id (2-byte le), feed_id (32 bytes)] against the Push Oracle program (the account owner remains Receiver).
   */
  getPriceFeedAccountAddress(shardId: number, feedIdHex: string): PublicKey {
    if (
      !Number.isInteger(shardId) ||
      shardId < 0 ||
      shardId > 65535 ||
      !/^(0x)?[a-fA-F0-9]{64}$/.test(feedIdHex)
    )
      throw new PythOracleError(
        "A u16 shard and 32-byte hex feed ID are required.",
      );
    const cleanHex = feedIdHex.replace(/^0x/, "");
    const feedIdBuffer = Buffer.from(cleanHex, "hex");
    const shardBuffer = Buffer.alloc(2);
    shardBuffer.writeUInt16LE(shardId);

    const [pubkey] = PublicKey.findProgramAddressSync(
      [shardBuffer, feedIdBuffer],
      PYTH_PUSH_ORACLE_PROGRAM_ID,
    );
    return pubkey;
  }

  /**
   * Reads and parses a Pyth price feed account from the Solana blockchain.
   */
  async getOnChainPrice(
    shardId: number,
    feedIdHex: string,
  ): Promise<PythPriceData | null> {
    try {
      const pda = this.getPriceFeedAccountAddress(shardId, feedIdHex);
      const accountInfo = await this.connection.getAccountInfo(pda);
      if (
        !accountInfo ||
        !accountInfo.owner.equals(PYTH_RECEIVER_PROGRAM_ID) ||
        accountInfo.executable
      )
        return null;
      const data = accountInfo.data;
      // Anchor PriceUpdateV2: discriminator + write_authority + Full enum tag
      // + PriceFeedMessage + posted_slot. Partial updates are never accepted.
      if (
        data.length < 133 ||
        !data
          .subarray(0, 8)
          .equals(Buffer.from([34, 241, 35, 99, 157, 126, 244, 205])) ||
        data[40] !== 1
      )
        return null;
      const cleanHex = feedIdHex.replace(/^0x/, "").toLowerCase();
      if (data.subarray(41, 73).toString("hex") !== cleanHex) return null;
      const priceOffset = 73;
      const rawPriceBigInt = data.readBigInt64LE(priceOffset);
      const rawConfBigInt = data.readBigUInt64LE(priceOffset + 8);
      const expo = data.readInt32LE(priceOffset + 16);
      const publishTimeBigInt = data.readBigInt64LE(priceOffset + 20);
      const publishTime = Number(publishTimeBigInt);
      const age = Date.now() / 1000 - publishTime;
      const factor = Math.pow(10, expo);
      const price = Number(rawPriceBigInt) * factor;
      const confidence = Number(rawConfBigInt) * factor;
      if (
        !Number.isSafeInteger(publishTime) ||
        age < -30 ||
        age > 60 ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(confidence)
      )
        return null;

      return {
        feedId: feedIdHex.startsWith("0x") ? feedIdHex : `0x${feedIdHex}`,
        price,
        confidence,
        expo,
        rawPrice: rawPriceBigInt.toString(),
        rawConfidence: rawConfBigInt.toString(),
        publishTime: Number(publishTimeBigInt),
        status: "unknown", // A fresh price does not establish market trading hours.
      };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// xStocks `/public/oracles` Route Integration
// ---------------------------------------------------------------------------
