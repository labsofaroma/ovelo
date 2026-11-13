import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata({
  title: "Your activity",
  description: "Review paper orders and activity saved on this device.",
  robots: { index: false, follow: false },
});
import { AromaApp } from "../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="activity" />;
}
