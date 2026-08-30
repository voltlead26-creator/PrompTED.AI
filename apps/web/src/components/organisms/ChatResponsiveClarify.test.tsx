import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatResponsiveClarify, type ClarifyMessage } from "./ChatResponsiveClarify";

describe("ChatResponsiveClarify selectable answers", () => {
  it("renders option chips for the latest TED question and reports the tapped answer", () => {
    const onSelectOption = vi.fn();
    const messages: ClarifyMessage[] = [
      { id: "m0", role: "ted", text: "What are you trying to create?" },
      { id: "m1", role: "user", text: "A lease document" },
      {
        id: "m2",
        role: "ted",
        text: "Is this a rental or a property you own?",
        options: ["Renting", "Own"],
      },
    ];

    render(<ChatResponsiveClarify messages={messages} onSelectOption={onSelectOption} />);

    const renting = screen.getByRole("button", { name: "Renting" });
    fireEvent.click(renting);
    expect(onSelectOption).toHaveBeenCalledWith("Renting");
  });

  it("does not show options on an earlier message once the conversation has moved on", () => {
    const messages: ClarifyMessage[] = [
      {
        id: "m0",
        role: "ted",
        text: "Full-time, part-time or casual?",
        options: ["Full-time", "Part-time", "Casual"],
      },
      { id: "m1", role: "user", text: "Full-time" },
      { id: "m2", role: "ted", text: "What's the start date?" },
    ];

    render(<ChatResponsiveClarify messages={messages} />);

    expect(screen.queryByRole("button", { name: "Full-time" })).not.toBeInTheDocument();
  });

  it("shows no options for an open-ended question", () => {
    const messages: ClarifyMessage[] = [
      { id: "m0", role: "ted", text: "What's the employee's name?" },
    ];

    render(<ChatResponsiveClarify messages={messages} />);

    expect(screen.queryByRole("group", { name: "Suggested answers" })).not.toBeInTheDocument();
  });

  it("hides options while TED is thinking about the next turn", () => {
    const messages: ClarifyMessage[] = [
      {
        id: "m0",
        role: "ted",
        text: "Renting or own?",
        options: ["Renting", "Own"],
      },
    ];

    render(<ChatResponsiveClarify messages={messages} thinking />);

    expect(screen.queryByRole("button", { name: "Renting" })).not.toBeInTheDocument();
  });
});
