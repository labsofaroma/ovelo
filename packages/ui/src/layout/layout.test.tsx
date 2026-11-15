import { render, screen } from "@testing-library/react";
import { Compass } from "lucide-react";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  Callout,
  EmptyState,
  GradientHeading,
  MobileTabBar,
  NetworkBadge,
  Section,
  Sidebar,
  SidebarGroup,
  SidebarLink,
  SourceStamp,
  StatTile,
  StickyActionBar,
} from ".";

describe("Section", () => {
  it("is a region labelled by its title, with eyebrow, description and actions", async () => {
    const { container } = render(
      <Section
        id="trade"
        eyebrow="Step 1"
        title="Trade"
        description="Pick an amount."
        actions={<button type="button">Act</button>}
      >
        <p>Body</p>
      </Section>,
    );
    const region = screen.getByRole("region", { name: "Trade" });
    expect(region).toHaveAttribute("id", "trade");
    expect(
      screen.getByRole("heading", { level: 2, name: "Trade" }),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent("Step 1");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("hero adds decorative glow and grain hidden from assistive tech", () => {
    const { container } = render(
      <Section variant="hero" title="Hello" headingLevel="h1" />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "text-silver",
    );
    for (const el of container.querySelectorAll(
      "[data-slot=glow],[data-slot=grain]",
    ))
      expect(el).toHaveAttribute("aria-hidden", "true");
  });
});

describe("GradientHeading", () => {
  it("renders the chosen level and tone", () => {
    render(
      <GradientHeading as="h3" tone="warm">
        Title
      </GradientHeading>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass("text-warm");
  });
});

describe("SourceStamp", () => {
  const fixed = () => "10:30";
  it("shows source and time when fresh", () => {
    render(<SourceStamp source="Pyth" observedAt={0} formatTime={fixed} />);
    expect(screen.getByText("Pyth")).toBeInTheDocument();
    expect(screen.getByText("10:30").tagName).toBe("TIME");
  });
  it("labels stale data", () => {
    render(
      <SourceStamp
        source="Pyth"
        observedAt={0}
        state="stale"
        formatTime={fixed}
      />,
    );
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });
  it("falls back to unavailable without a valid time, never inventing one", () => {
    const { container } = render(<SourceStamp source="Jupiter" />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });
});

describe("NetworkBadge", () => {
  it.each([
    ["mainnet-spot", "Mainnet · spot purchase"],
    ["devnet-test", "Devnet · test tokens only"],
    ["paper", "Paper · practice, no real funds"],
  ] as const)("labels %s with fixed copy", (kind, text) => {
    render(<NetworkBadge kind={kind} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe("StatTile, Callout and EmptyState", () => {
  it("render accessibly", async () => {
    const { container } = render(
      <div>
        <StatTile
          label="Value"
          value="—"
          source={<SourceStamp source="Pyth" />}
        />
        <Callout tone="warning" title="Low liquidity">
          Routes may be thin.
        </Callout>
        <Callout tone="danger" title="Failed" />
        <EmptyState title="Nothing yet" description="Add one." />
      </div>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Navigation", () => {
  it("marks the active link with aria-current", async () => {
    const { container } = render(
      <div>
        <Sidebar brand={<span>Ovelo</span>} footer={<span>Account</span>}>
          <SidebarGroup label="Invest">
            <SidebarLink href="/app" icon={Compass} active>
              Discover
            </SidebarLink>
            <SidebarLink href="/baskets">Baskets</SidebarLink>
          </SidebarGroup>
        </Sidebar>
        <MobileTabBar
          label="Tabs"
          tabs={[
            { href: "/app", label: "Discover", icon: Compass, active: true },
          ]}
        />
        <StickyActionBar label="Quick buy">
          <button type="button">Buy</button>
        </StickyActionBar>
      </div>,
    );
    expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Quick buy" }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
