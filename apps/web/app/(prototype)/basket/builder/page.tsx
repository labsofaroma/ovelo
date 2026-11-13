import { pageMetadata } from "../../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Basket studio",
  description:
    "Build your own tokenized stock allocation, save a private basket, or publish with a creator invite. Review real trading routes before you invest.",
});

import { AromaApp } from "../../../../components/aroma/AromaApp";

export default function Page() {
  return <AromaApp page="basket-builder" />;
}
