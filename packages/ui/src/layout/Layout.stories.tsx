import { Compass, Layers3, Repeat2, Wallet2 } from "lucide-react";
import { Button } from "../primitives/Button";
import { DEMO, Row } from "../stories/helpers";
import {
  Callout,
  EmptyState,
  NetworkBadge,
  Section,
  SourceStamp,
  Stack,
  StatTile,
  StickyActionBar,
  MobileTabBar,
} from ".";

export default { title: "Layout/Wide cards" };

const time = () => "10:30";

export const PageStack = () => (
  <Stack className="max-w-5xl">
    <Section
      variant="hero"
      headingLevel="h1"
      eyebrow="Discover"
      title="Own the companies you believe in."
      description={DEMO}
      actions={<Button>Explore baskets</Button>}
    />
    <Section
      title="Summary"
      description="Figures with their source and time."
      actions={<Button variant="secondary">Refresh</Button>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Value"
          value="—"
          detail={DEMO}
          source={
            <SourceStamp source="Pyth" observedAt={0} formatTime={time} />
          }
        />
        <StatTile
          label="Last price"
          value="—"
          source={
            <SourceStamp
              source="Jupiter"
              observedAt={0}
              state="stale"
              formatTime={time}
            />
          }
        />
        <StatTile
          label="24h volume"
          value="—"
          source={<SourceStamp source="Jupiter" />}
        />
      </div>
    </Section>
    <Section title="Trade" id="trade">
      <div className="flex flex-col gap-3">
        <NetworkBadge kind="mainnet-spot" />
        <Button variant="solid">Review purchase</Button>
      </div>
    </Section>
    <Section title="Nothing here yet">
      <EmptyState
        title="No saved assets"
        description="Save a stock to follow it here."
        action={<Button>Browse stocks</Button>}
      />
    </Section>
  </Stack>
);

export const Notices = () => (
  <div className="flex max-w-xl flex-col gap-3">
    <Row label="Network badges">
      <NetworkBadge kind="mainnet-spot" />
      <NetworkBadge kind="devnet-test" />
      <NetworkBadge kind="paper" />
    </Row>
    <Callout title="Heads up">Information note.</Callout>
    <Callout tone="warning" title="Thin liquidity">
      Quotes may move.
    </Callout>
    <Callout tone="danger" title="Route check failed" />
  </div>
);

export const Bars = () => (
  <div className="relative h-80">
    <StickyActionBar label="Quick buy" className="absolute! bottom-20!">
      <span className="text-small">Buy {DEMO}</span>
      <Button variant="solid" size="sm">
        Buy
      </Button>
    </StickyActionBar>
    <MobileTabBar
      className="absolute! flex!"
      tabs={[
        { href: "#", label: "Discover", icon: Compass, active: true },
        { href: "#", label: "Baskets", icon: Layers3 },
        { href: "#", label: "Invest", icon: Repeat2 },
        { href: "#", label: "Portfolio", icon: Wallet2 },
      ]}
    />
  </div>
);
