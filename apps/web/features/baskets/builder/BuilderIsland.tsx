"use client";

import { QueryProvider } from "../../shared/components/QueryProvider";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { BuilderForm, type BuilderFormProps } from "./BuilderForm";

/**
 * The builder's client entry point: TanStack Query and the lazy wallet boundary (the wallet stack
 * loads only when the creator connects), around the form. Props are plain server data.
 */
export function BuilderIsland(props: BuilderFormProps) {
  return (
    <QueryProvider>
      <WalletBoundary>
        <BuilderForm {...props} />
      </WalletBoundary>
    </QueryProvider>
  );
}
