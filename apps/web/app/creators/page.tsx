import { pageMetadata } from "../../lib/metadata";
import { Shell } from "../../components/aroma/Shell";
import { CreatorDashboard } from "../../components/aroma/CreatorDashboard";
export const metadata = pageMetadata({
  title: "Creator studio",
  description:
    "Publish invited creator baskets, share devnet subscription Blinks and follow verified engagement on Aroma.",
});
export default function Page() {
  return (
    <Shell title="Creator studio">
      <CreatorDashboard />
    </Shell>
  );
}
