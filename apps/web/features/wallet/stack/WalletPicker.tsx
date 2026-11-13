import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@aroma/ui";
import type { WalletState } from "../context";

/**
 * Wallet chooser built from packages/ui (no wallet-adapter-react-ui and its global CSS). Lists
 * the Wallet Standard wallets the browser exposes, and Privy's email/embedded login when enabled.
 */
export function WalletPicker({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: WalletState;
}) {
  const installed = state.options.filter((option) => option.ready);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="Close wallet picker">
        <DialogTitle>Connect a Solana wallet</DialogTitle>
        <DialogDescription>
          Mainnet only. Aroma prepares each transaction; your wallet signs it.
          Aroma never sees your keys.
        </DialogDescription>
        <ul className="mt-4 grid gap-2">
          {installed.map((option) => (
            <li key={option.name}>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => state.select(option.name)}
                className="justify-start"
              >
                {option.icon ? (
                  // Wallet icons are data URIs supplied by the wallet itself.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={option.icon} alt="" width={20} height={20} />
                ) : null}
                {option.name}
              </Button>
            </li>
          ))}
          {state.embedded ? (
            <li>
              <Button
                variant="secondary"
                fullWidth
                onClick={state.loginEmbedded}
              >
                Continue with email (embedded wallet)
              </Button>
            </li>
          ) : null}
        </ul>
        {installed.length === 0 && !state.embedded ? (
          <p className="mt-4 text-small text-muted">
            No browser wallet was found. Install a Solana wallet extension, then
            reload this page.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
