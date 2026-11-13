import { pageMetadata } from "../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Thematic baskets",
  description:
    "Explore the companies and allocations behind Aroma’s thematic stock baskets.",
});
import { AromaApp } from "../../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="baskets" />;
}
