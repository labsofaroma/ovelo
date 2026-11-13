import { pageMetadata } from "../../lib/metadata";
export const metadata = pageMetadata({
  title: "Recurring investment plans",
  description:
    "Practice recurring paper investments or review stock and basket plans using valueless devnet test tokens.",
});
import { AromaApp } from "../../components/aroma/AromaApp";
export default function Page() {
  return <AromaApp page="plans" />;
}
