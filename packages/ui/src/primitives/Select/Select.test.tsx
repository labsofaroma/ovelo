import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../../test/axe";
import { Field } from "../Field";
import { Select, type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "usdc", label: "USDC" },
  { value: "sol", label: "SOL" },
  { value: "demo", label: "Demo token", disabled: true },
];

describe("Select", () => {
  it("opens from the keyboard, moves the highlight with arrows, and selects by click", async () => {
    // Keyboard *selection* (Enter on an option) is asserted in a real browser: e2e/keyboard.spec.ts.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select aria-label="Pay with" options={OPTIONS} onChange={onChange} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Pay with" });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "SOL" })).toHaveAttribute(
      "data-highlighted",
    );
    await user.click(screen.getByRole("option", { name: "SOL" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("sol", OPTIONS[1]),
    );
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Select aria-label="Pay with" options={OPTIONS} />);
    const trigger = screen.getByRole("combobox", { name: "Pay with" });
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("never selects a disabled option", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        aria-label="Pay with"
        options={OPTIONS}
        onChange={onChange}
        defaultOpen
      />,
    );
    await user.click(await screen.findByRole("option", { name: "Demo token" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows groups, tags, the empty state and aria-busy while loading", async () => {
    const { rerender } = render(
      <Select
        aria-label="Asset"
        defaultOpen
        showTags
        loading
        options={[
          { value: "a", label: "Alpha", group: "Demo group", tag: "demo" },
        ]}
      />,
    );
    expect(await screen.findByText("Demo group")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
    rerender(
      <Select
        aria-label="Asset"
        defaultOpen
        options={[]}
        emptyMessage="Nothing matches."
      />,
    );
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
  });

  it("is named by a surrounding Field and flags invalid state", () => {
    render(
      <Field label="Currency" error="Pick one.">
        <Select options={OPTIONS} invalid />
      </Field>,
    );
    expect(screen.getByRole("combobox", { name: /Currency/ })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("supports a searchable mode driven by the caller", async () => {
    function Searchable() {
      const [query, setQuery] = useState("");
      const shown = OPTIONS.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()),
      );
      return (
        <Select
          aria-label="Asset"
          options={shown}
          defaultOpen
          search={{
            value: query,
            onChange: setQuery,
            ariaLabel: "Search assets",
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Searchable />);
    await user.type(
      await screen.findByRole("combobox", { name: "Search assets" }),
      "sol",
    );
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("option", { name: "SOL" })).toBeInTheDocument();
  });

  it("passes axe when open", async () => {
    const { baseElement } = render(
      <Select aria-label="Pay with" options={OPTIONS} defaultOpen />,
    );
    await screen.findByRole("listbox");
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
