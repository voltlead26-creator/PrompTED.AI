import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";

import { ChatInput } from "./ChatInput";
import { ExampleChips } from "./ExampleChips";
import { dailyChipSeed } from "./ExampleChips";
import { FastLane } from "./FastLane";
import { ChatResponsiveClarify, type ClarifyMessage } from "./ChatResponsiveClarify";
import { useFileAttachment, MAX_FILE_BYTES } from "@/hooks/useFileAttachment";
import { renderHook, act } from "@testing-library/react";

// next/link stub for FastLane
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const noop = () => {};

function makeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("ChatInput", () => {
  it("disables submit when empty and no attachment", () => {
    render(
      <ChatInput
        value=""
        onChange={noop}
        onSubmit={noop}
        attachment={null}
        onAttachFile={noop}
        onRemoveAttachment={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Ask TED/i })).toBeDisabled();
  });

  it("enables submit when text is present", () => {
    render(
      <ChatInput
        value="I need a job"
        onChange={noop}
        onSubmit={noop}
        attachment={null}
        onAttachFile={noop}
        onRemoveAttachment={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Ask TED/i })).toBeEnabled();
  });

  it("submits on Enter, inserts newline on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(
      <ChatInput
        value="hello"
        onChange={noop}
        onSubmit={onSubmit}
        attachment={null}
        onAttachFile={noop}
        onRemoveAttachment={noop}
      />,
    );
    const textarea = screen.getByLabelText("What are you trying to achieve?");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows attachment chip with a remove control", () => {
    const onRemove = vi.fn();
    render(
      <ChatInput
        value=""
        onChange={noop}
        onSubmit={noop}
        attachment={{
          file: makeFile("cv.pdf", "application/pdf", 1000),
          name: "cv.pdf",
          sizeBytes: 1000,
          type: "application/pdf",
        }}
        onAttachFile={noop}
        onRemoveAttachment={onRemove}
      />,
    );
    expect(screen.getByText("cv.pdf")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Remove cv.pdf/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("surfaces an attachment error as an alert", () => {
    render(
      <ChatInput
        value=""
        onChange={noop}
        onSubmit={noop}
        attachment={null}
        onAttachFile={noop}
        onRemoveAttachment={noop}
        attachError="That file type isn't supported."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't supported/);
  });

  it("passes axe", async () => {
    const { container } = render(
      <ChatInput
        value="hi"
        onChange={noop}
        onSubmit={noop}
        attachment={null}
        onAttachFile={noop}
        onRemoveAttachment={noop}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ExampleChips", () => {
  it("uses one UTC day seed for server and client rendering", () => {
    expect(dailyChipSeed(new Date("2026-08-12T23:30:00-10:00"))).toBe(
      dailyChipSeed(new Date("2026-08-13T19:30:00+10:00")),
    );
  });

  it("fills the input on pick (does not submit)", async () => {
    const onPick = vi.fn();
    render(<ExampleChips onPick={onPick} onBrowse={noop} />);
    const firstChip = screen.getAllByRole("button")[0]!;
    await userEvent.click(firstChip);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(typeof onPick.mock.calls[0]![0]).toBe("string");
  });

  it("opens browse via the Browse chip", async () => {
    const onBrowse = vi.fn();
    render(<ExampleChips onPick={noop} onBrowse={onBrowse} />);
    await userEvent.click(screen.getByRole("button", { name: /Browse all situations/i }));
    expect(onBrowse).toHaveBeenCalled();
  });
});

describe("FastLane", () => {
  it("renders nothing for first-time users (no items)", () => {
    const { container } = render(<FastLane items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the strip when outcomes exist", () => {
    render(<FastLane items={[{ id: "1", title: "Offer letter", meta: "Edited today" }]} />);
    expect(screen.getByRole("region", { name: "Jump back in" })).toBeDefined();
    expect(screen.getByText("Offer letter")).toBeDefined();
  });
});

describe("ChatResponsiveClarify", () => {
  beforeAll(() => {
    // jsdom lacks scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  const messages: ClarifyMessage[] = [
    { id: "1", role: "user", text: "I need help with my team" },
    { id: "2", role: "ted", text: "Happy to help — what's the situation?" },
    { id: "3", role: "user", text: "Someone new is starting Monday" },
    { id: "4", role: "ted", text: "Got it — full-time or casual?" },
  ];

  it("renders an unbounded thread of exchanges", () => {
    render(<ChatResponsiveClarify messages={messages} />);
    // More than two exchanges render — there is no hard cap.
    expect(screen.getByText("I need help with my team")).toBeDefined();
    expect(screen.getByText(/full-time or casual/)).toBeDefined();
    expect(screen.getAllByText("TED").length).toBe(2);
  });

  it("renders nothing when empty and not thinking", () => {
    const { container } = render(<ChatResponsiveClarify messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a labelled thinking indicator", () => {
    render(<ChatResponsiveClarify messages={[messages[0]!]} thinking />);
    expect(screen.getByText("TED is thinking")).toBeDefined();
  });

  it("passes axe", async () => {
    const { container } = render(<ChatResponsiveClarify messages={messages} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("useFileAttachment", () => {
  it("accepts a PDF", () => {
    const { result } = renderHook(() => useFileAttachment());
    act(() => {
      result.current.attach(makeFile("cv.pdf", "application/pdf", 1000));
    });
    expect(result.current.attachment?.name).toBe("cv.pdf");
    expect(result.current.error).toBeNull();
  });

  it("rejects an unsupported type with a plain message", () => {
    const { result } = renderHook(() => useFileAttachment());
    act(() => {
      result.current.attach(makeFile("virus.exe", "application/x-msdownload", 100));
    });
    expect(result.current.attachment).toBeNull();
    expect(result.current.error).toMatch(/PDF, DOCX, TXT, Markdown or CSV/i);
  });

  it("rejects files over 20MB with a plain message", () => {
    const { result } = renderHook(() => useFileAttachment());
    act(() => {
      result.current.attach(makeFile("big.pdf", "application/pdf", MAX_FILE_BYTES + 1));
    });
    expect(result.current.attachment).toBeNull();
    expect(result.current.error).toMatch(/too big/);
  });

  it("clears an attachment", () => {
    const { result } = renderHook(() => useFileAttachment());
    act(() => {
      result.current.attach(makeFile("cv.pdf", "application/pdf", 1000));
    });
    act(() => result.current.clear());
    expect(result.current.attachment).toBeNull();
  });
});
