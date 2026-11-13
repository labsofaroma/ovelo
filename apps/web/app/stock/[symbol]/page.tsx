import { pageMetadata } from "../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Stock research",
  description:
    "Company overview, sourced fundamentals, technicals and mainnet token prices.",
});
import { AromaApp } from "../../../components/aroma/AromaApp";
export default async function Page({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <AromaApp page="stock" symbol={symbol} />;
}
