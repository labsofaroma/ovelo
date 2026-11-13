import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  RootDocument,
  v1SiteUrl,
} from "@/features/shared/components/RootDocument";
import "../aroma-ui.v4.css";

/**
 * Root layout of the v1 product shell (M4). `(app)`, `(marketing)` and `(prototype)` are separate
 * root layouts, so v1 pages ship neither the prototype's providers and global CSS nor
 * `@solana/web3.js`; the wallet stack loads lazily inside the trade islands only (features/wallet).
 * Navigating between the prototype and v1 is a full page load. M7 makes this the only root.
 */
export const metadata: Metadata = {
  metadataBase: v1SiteUrl(),
  title: { default: "Aroma", template: "Aroma | %s" },
  description:
    "Research tokenized stocks, buy single names or baskets from your own wallet on Solana.",
};

export default function AppRootLayout({ children }: { children: ReactNode }) {
  return <RootDocument>{children}</RootDocument>;
}
