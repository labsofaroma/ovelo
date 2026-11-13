import { pageMetadata } from "../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Discover",
  description:
    "Discover Solana tokenized stocks, current market activity and thematic baskets.",
});
import { AromaApp } from "../../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="discover" />;
}
