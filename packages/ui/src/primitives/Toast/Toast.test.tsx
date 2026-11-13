import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { ToastProvider, useToast } from "./Toast";

function Trigger({ type }: { type?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.add({
          title: "Saved",
          description: "Sample message",
          type,
          timeout: 0,
        })
      }
    >
      Notify
    </button>
  );
}

describe("Toast", () => {
  it("shows a toast with title and description, and can be dismissed", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Notify" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Sample message")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Dismiss notification"));
    await waitFor(() => expect(screen.queryByText("Saved")).toBeNull());
  });
  it("passes axe with a visible toast", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(
      <ToastProvider>
        <Trigger type="error" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Notify" }));
    await screen.findByText("Saved");
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
