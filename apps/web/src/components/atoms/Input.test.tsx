import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Input, Textarea } from "./Input";

describe("Input", () => {
  it("associates the label with the field", () => {
    render(<Input label="Your name" />);
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
  });

  it("links a hint via aria-describedby", () => {
    render(<Input label="ABN" hint="11 digits, no spaces" />);
    const field = screen.getByLabelText("ABN");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByText("11 digits, no spaces")).toHaveAttribute(
      "id",
      describedBy!,
    );
  });

  it("marks the field invalid and announces the error", () => {
    render(<Input label="Email" error="That email looks off" />);
    const field = screen.getByLabelText("Email");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("That email looks off");
  });

  it("keeps the label for screen readers when visually hidden", () => {
    render(<Input label="Search" hideLabel />);
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
  });

  it("has no axe violations (input and textarea, with error)", async () => {
    const { container } = render(
      <>
        <Input label="Name" hint="As it appears on documents" />
        <Textarea multiline label="Notes" error="Required" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
