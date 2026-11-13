import { pageMetadata } from "../../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Basket details",
  description:
    "Understand a thematic basket’s allocations, companies and available market data.",
});
import { AromaApp } from "../../../../components/aroma/AromaApp";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AromaApp page="basket" basketId={id} />;
}
