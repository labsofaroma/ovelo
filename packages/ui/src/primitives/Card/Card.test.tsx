import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

describe("Card", () => {
  it("composes header, content and footer with slots and a real heading", async () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Card ref={ref}>
        <CardHeader>
          <CardTitle>Basket</CardTitle>
          <CardDescription>Sample copy</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(
      screen.getByRole("heading", { name: "Basket", level: 3 }),
    ).toBeInTheDocument();
    expect(ref.current).toHaveAttribute("data-slot", "card");
    expect(await axe(container)).toHaveNoViolations();
  });
});
