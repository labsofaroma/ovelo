import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const Sample = () => (
  <Tabs defaultValue="overview">
    <TabsList aria-label="Research">
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="news">News</TabsTrigger>
      <TabsTrigger value="filings">Filings</TabsTrigger>
    </TabsList>
    <TabsContent value="overview">Overview panel</TabsContent>
    <TabsContent value="news">News panel</TabsContent>
    <TabsContent value="filings">Filings panel</TabsContent>
  </Tabs>
);

describe("Tabs", () => {
  it("has tablist/tab/tabpanel roles with the active tab selected", async () => {
    const { container } = render(<Sample />);
    expect(
      screen.getByRole("tablist", { name: "Research" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Overview panel");
    expect(await axe(container)).toHaveNoViolations();
  });
  it("moves with arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    render(<Sample />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "News" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Filings" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    await user.click(screen.getByRole("tab", { name: "News" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("News panel");
  });
});
