import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextIssue } from "./ContextIssue";

describe("ContextIssue", () => {
  it("keeps issue detail hidden until requested", async () => {
    render(
      <ContextIssue
        title="Employer name needed"
        message="Add the organisation so TED can finish this section."
      />,
    );

    expect(screen.queryByText(/Add the organisation/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Employer name needed/ }));
    expect(screen.getByText(/Add the organisation/)).toBeInTheDocument();
  });

  it("runs the local action and closes the popover", async () => {
    const action = vi.fn();
    render(
      <ContextIssue
        title="Section needs attention"
        message="TED could not finish this section."
        actionLabel="Try this section again"
        onAction={action}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Section needs attention/ }));
    await userEvent.click(screen.getByRole("button", { name: "Try this section again" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("TED could not finish this section.")).not.toBeInTheDocument();
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    render(
      <ContextIssue
        title="Please check this statement"
        message="TED could not confirm the wording."
      />,
    );

    const trigger = screen.getByRole("button", { name: /Please check this statement/ });
    await userEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("TED could not confirm the wording.")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
