import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ExplainResult } from "@prompted/shared";
import { EditWithTED } from "./EditWithTED";
import { ExplainWithTED } from "./ExplainWithTED";

const answer: ExplainResult = {
  title: "The response deadline",
  plain_english: "The letter asks for a reply within 14 days.",
  why_it_matters: ["It gives the recipient a clear response window."],
  what_to_watch: ["Check when the 14 days start."],
  missing_or_risky: ["The sending date is not stated."],
  suggested_next_step: "Confirm the sending date before you approve the letter.",
};

describe("Workspace assistance", () => {
  it("asks for a tone before starting an edit", async () => {
    const run = vi.fn();
    render(<EditWithTED streaming={false} hasSelection onRun={run} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Change tone" }));
    expect(run).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Professional" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("change_tone", "Use a professional tone. Preserve the meaning and supplied facts.");
  });

  it("asks for the facts to add and submits the supplied detail with the correct action", async () => {
    const run = vi.fn();
    render(<EditWithTED streaming={false} hasSelection={false} onRun={run} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add detail" }));
    expect(run).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "Tell TED what to change" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "The duplicate charge was $10 on 8 September.");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("add_detail", "The duplicate charge was $10 on 8 September.");
  });

  it("retains a typed instruction when a quick edit is chosen", async () => {
    const run = vi.fn();
    render(<EditWithTED streaming={false} hasSelection onRun={run} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "Keep the date and amount.");
    await userEvent.click(screen.getByRole("button", { name: "Shorten" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("shorten", "Keep the date and amount.");
  });

  it("renders an immediately returned explanation as labelled, accessible lists", async () => {
    const run = vi.fn().mockResolvedValue(answer);
    render(<ExplainWithTED running={false} hasSelection onRun={run} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Plain English" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("Explain the selected wording in plain English.");
    const article = await screen.findByRole("article", { name: "The response deadline" });
    expect(within(article).getAllByRole("list")).toHaveLength(3);
    expect(within(article).getByRole("heading", { name: "Next step" })).toBeVisible();
    expect(article).toHaveTextContent(answer.suggested_next_step!);
  });

  it("blocks duplicate explanation clicks before a running prop update and ignores a cancelled reply", async () => {
    let resolve!: (value: ExplainResult) => void;
    const run = vi.fn(() => new Promise<ExplainResult>((yes) => { resolve = yes; }));
    const cancel = vi.fn();
    render(<ExplainWithTED running={false} hasSelection={false} onRun={run} onCancel={cancel} />);
    const button = screen.getByRole("button", { name: "Plain English" });
    fireEvent.click(button); fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => resolve(answer));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plain English" })).toBeEnabled();
  });

  it("shows an actionable failure even when no running transition occurred", async () => {
    render(<ExplainWithTED running={false} hasSelection={false} onRun={vi.fn().mockResolvedValue(null)} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Plain English" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("try again");
    expect(screen.getByRole("button", { name: "Try explanation again" })).toBeEnabled();
  });
});
