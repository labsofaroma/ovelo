import { pageMetadata } from "../../../lib/metadata";
export const metadata = pageMetadata({
  title: "Settings",
  description:
    "Manage paper activity, wallet connection and sign-in preferences.",
  robots: { index: false, follow: false },
});
import { AromaApp } from "../../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="settings" />;
}
