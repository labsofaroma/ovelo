// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type WeightRow, WeightEditor } from "./WeightEditor";

afterEach(cleanup);

const MINTS = [
  "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
];

let latest: WeightRow[] = [];
function Harness({ initial }: { initial: number[] }) {
  const [rows, setRows] = useState<WeightRow[]>(
    initial.map((weightBps, i) => ({
      mint: MINTS[i]!,
      symbol: ["AAPLx", "NVDAx", "TSLAx"][i]!,
      weightBps,
    })),
  );
  latest = rows;
  return (
    <WeightEditor
      rows={rows}
      onChange={setRows}
      onRemove={(mint) => setRows(rows.filter((row) => row.mint !== mint))}
    />
  );
}

const status = () => screen.getByRole("status");
const weights = () => latest.map((row) => row.weightBps);
const input = (symbol: string) =>
  screen.getByRole("textbox", { name: `${symbol} weight, percent` });

describe("WeightEditor", () => {
  it("shows the live sum and what is left to assign", () => {
    render(<Harness initial={[5000, 2500, 0]} />);
    expect(status().textContent).toBe(
      "Total is 75.00%. 25.00% left to assign.",
    );
    expect(input("AAPLx")).toHaveProperty("value", "50.00");
  });

  it("reports totals over 100% and zero-weight assets", () => {
    render(<Harness initial={[6000, 5000]} />);
    expect(status().textContent).toBe("Total is 110.00%. 10.00% over 100%.");
    cleanup();
    render(<Harness initial={[10_000, 0]} />);
    expect(status().textContent).toBe(
      "Total is 100.00%, but one asset has no weight.",
    );
  });

  it("equal weights give the remainder to the first rows, summing to exactly 10,000", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[1, 1, 1]} />);
    await user.click(screen.getByRole("button", { name: "Equal weights" }));
    expect(weights()).toEqual([3334, 3333, 3333]);
    expect(status().textContent).toBe("Total is 100.00%. Ready to preview.");
  });

  it("normalizes proportionally with deterministic rounding", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[1000, 2000, 0]} />);
    await user.click(screen.getByRole("button", { name: "Normalize to 100%" }));
    expect(weights()).toEqual([3333, 6667, 0]);
    expect(
      screen.getByRole("button", { name: "Normalize to 100%" }),
    ).toHaveProperty("disabled", false); // a zero weight still needs attention
  });

  it("accepts typed percentages with two decimals, on Enter and on blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[5000, 5000]} />);
    await user.clear(input("AAPLx"));
    await user.type(input("AAPLx"), "33.34{Enter}");
    expect(weights()).toEqual([3334, 5000]);
    await user.clear(input("NVDAx"));
    await user.type(input("NVDAx"), "66,66");
    await user.tab();
    expect(weights()).toEqual([3334, 6666]);
    expect(status().textContent).toBe("Total is 100.00%. Ready to preview.");
  });

  it("marks invalid text and keeps the last valid weight", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[5000, 5000]} />);
    await user.clear(input("AAPLx"));
    await user.type(input("AAPLx"), "12.345");
    expect(input("AAPLx").getAttribute("aria-invalid")).toBe("true");
    await user.tab();
    expect(weights()).toEqual([5000, 5000]);
  });

  it("is keyboard operable: arrows step by 1 bp, Shift+arrows by 100 bp, clamped to 0..10,000", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[5000, 5000]} />);
    await user.click(input("AAPLx"));
    await user.keyboard("{ArrowUp}");
    expect(weights()[0]).toBe(5001);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(weights()[0]).toBe(4901);
    expect(input("AAPLx")).toHaveProperty("value", "49.01");
    await user.click(input("NVDAx"));
    for (let i = 0; i < 60; i += 1)
      await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(weights()[1]).toBe(10_000);
  });

  it("removes an asset with an accessible button", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[5000, 5000]} />);
    await user.click(screen.getByRole("button", { name: "Remove NVDAx" }));
    expect(latest.map((row) => row.symbol)).toEqual(["AAPLx"]);
  });
});
