"use client";

import { Button } from "@aroma/ui";
import { shortAddress, useWallet } from "./context";
import { WRONG_NETWORK_SHORT } from "./cluster";

/** Connect / connected / wrong-network control. Shows state; never asks for anything but a click. */
export function ConnectButton({ className }: { className?: string }) {
  const wallet = useWallet();
  if (wallet.status === "connected" && wallet.signer)
    return (
      <Button
        variant="secondary"
        size="sm"
        className={className}
        onClick={wallet.disconnect}
        aria-label={`Disconnect wallet ${wallet.signer.address}`}
      >
        {shortAddress(wallet.signer.address)} · Disconnect
      </Button>
    );
  if (wallet.status === "wrong-network")
    return (
      <Button
        variant="danger"
        size="sm"
        className={className}
        onClick={wallet.disconnect}
      >
        {WRONG_NETWORK_SHORT[wallet.cluster]}
      </Button>
    );
  return (
    <Button
      size="sm"
      className={className}
      loading={wallet.status === "loading" || wallet.status === "connecting"}
      onClick={wallet.open}
    >
      Connect wallet
    </Button>
  );
}
