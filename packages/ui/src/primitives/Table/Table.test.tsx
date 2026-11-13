import { render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

describe("Table", () => {
  it("renders semantic table markup with column headers and a caption", async () => {
    const ref = createRef<HTMLTableElement>();
    const { container } = render(
      <Table ref={ref}>
        <TableCaption>Sample holdings (demo values)</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Asset</TableHead>
            <TableHead scope="col">Weight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>DEMO</TableCell>
            <TableCell>50%</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole("table", {
      name: "Sample holdings (demo values)",
    });
    expect(ref.current).toBe(table);
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(
      within(table).getByRole("cell", { name: "DEMO" }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
