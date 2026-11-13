import type { Metadata } from "next";

export const socialPreview = {
  // TODO: add your 1200x630 social preview at this path.
  url: "/images/social/aroma-preview.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Aroma | Research and automate stock and basket investing",
};

export function pageMetadata({
  title,
  description,
  ...rest
}: Metadata & { title: string; description: string }): Metadata {
  const pageTitle = `Aroma | ${title}`;
  return {
    ...rest,
    title: { absolute: pageTitle },
    description,
    openGraph: {
      type: "website",
      siteName: "Aroma",
      title: pageTitle,
      description,
      images: [socialPreview],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: [socialPreview],
    },
  };
}

export const landingMetadata = pageMetadata({
  title: "Research & automate Stocks & Baskets Investing",
  description:
    "Research tokenized stocks, build a basket and invest from your own wallet on Solana. Mainnet spot purchases, a vaultless devnet SIP/DCA demo and paper practice.",
});
