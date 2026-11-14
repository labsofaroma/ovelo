import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootDocument } from "@/features/shared/components/RootDocument";
import { siteUrl } from "@/features/shared/site";
import "../aroma-ui.css";

/**
 * Root layout of the v1 marketing pages (landing, privacy, terms) at the root (M4: its own root,
 * like `(app)`). The prototype landing at `/` keeps its own root in `(prototype)` until M7.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "Aroma", template: "Aroma | %s" },
  description:
    "Own real stocks on Solana from your own wallet: research, single names and themed baskets.",
};

export default function MarketingRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <RootDocument>{children}</RootDocument>;
}
