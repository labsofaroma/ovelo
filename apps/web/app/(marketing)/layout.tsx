import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  RootDocument,
  v1SiteUrl,
} from "@/features/shared/components/RootDocument";
import "../aroma-ui.v4.css";

/**
 * Root layout of the v1 marketing pages (landing, privacy, terms) under `/v1` (M4: its own root,
 * like `(app)`). The prototype landing at `/` keeps its own root in `(prototype)` until M7.
 */
export const metadata: Metadata = {
  metadataBase: v1SiteUrl(),
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
