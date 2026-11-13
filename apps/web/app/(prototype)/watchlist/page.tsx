import { pageMetadata } from "../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Your watchlist",
  description: "Follow the tokenized assets saved on this device.",
  robots: { index: false, follow: false },
});
import { AromaApp } from "../../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="watchlist" />;
}
