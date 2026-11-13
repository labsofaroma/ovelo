"use client";

import { createContext, useContext } from "react";

/**
 * The wallet contract every trade surface uses (REWRITE-PLAN §5.3). It is deliberately tiny and
 * free of Solana libraries, so pages import it without shipping the wallet stack. The stack
 * (wallet-adapter, Privy, web3.js) lives in ./stack and is loaded on demand by WalletBoundary.
 *
 * A Signer turns UNSIGNED base64 transactions into SIGNED base64 transactions through the user's
 * wallet. It never sees, holds or exposes a private key (AGENTS.md rule 1).
 */
export type TransactionVersion = 0 | 1;

export type Signer = {
  address: string;
  kind: "privy" | "standard" | "adapter" | "e2e";
  /** Versions the wallet explicitly advertises for the signing method we call. */
  supportedTransactionVersions: TransactionVersion[];
  signTransactions(
    unsigned: readonly string[],
    version: TransactionVersion,
  ): Promise<string[]>;
};

export type WalletOption = {
  name: string;
  icon: string | null;
  ready: boolean;
};

export type WalletState = {
  /** "idle": the stack is not loaded yet (nothing was asked of the user). */
  status:
    | "idle"
    | "loading"
    | "disconnected"
    | "connecting"
    | "connected"
    | "wrong-network";
  signer: Signer | null;
  options: WalletOption[];
  embedded: boolean;
  error: string | null;
  /** Load the stack (if needed) and show the wallet picker. */
  open(): void;
  select(name: string): void;
  loginEmbedded(): void;
  disconnect(): void;
};

export const idleWallet: WalletState = {
  status: "idle",
  signer: null,
  options: [],
  embedded: false,
  error: null,
  open: () => {},
  select: () => {},
  loginEmbedded: () => {},
  disconnect: () => {},
};

export const WalletContext = createContext<WalletState>(idleWallet);

export function useWallet(): WalletState {
  return useContext(WalletContext);
}

/** The connected signer, or null. Components sign through this and nothing else. */
export function useSigner(): Signer | null {
  return useContext(WalletContext).signer;
}

/** "AbCd…WxYz" for display; never used for logic. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
