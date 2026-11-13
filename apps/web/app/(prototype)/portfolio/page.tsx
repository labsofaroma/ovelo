import { pageMetadata } from "../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Your portfolio",
  description: "Review your local paper account or connected wallet holdings.",
  robots: { index: false, follow: false },
});
import { AromaApp } from "../../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="portfolio" />;
}
