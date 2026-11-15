import { Badge } from "@ovelo/ui";
import { CLUSTER_LABEL, type WalletCluster } from "./cluster";

/**
 * The persistent, visible cluster label (PRODUCT.md: always say whether something is a devnet
 * test). Renders nothing on mainnet. Server-renderable: no client state.
 */
export function ClusterLabel({
  cluster,
  className,
}: {
  cluster: WalletCluster;
  className?: string;
}) {
  const text = CLUSTER_LABEL[cluster];
  if (!text) return null;
  return (
    <Badge tone="warning" data-cluster={cluster} className={className}>
      {text}
    </Badge>
  );
}
