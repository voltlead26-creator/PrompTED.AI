import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionStepFieldsEditor } from "./ActionStepFieldsEditor";

describe("ActionStepFieldsEditor", () => {
  it("saves a short title and multiline description together", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ActionStepFieldsEditor title="Full stretching sequence" description="Gentle stretches" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Evening stretches" } });
    fireEvent.change(screen.getByLabelText("Task description"), { target: { value: "Full stretching sequence\n1. Child's pose\n2. Cat-cow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: "Evening stretches", objective: "Full stretching sequence\n1. Child's pose\n2. Cat-cow" }));
  });

  it("retains both fields on failure so the user can retry", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Save unavailable")).mockResolvedValue(undefined);
    render(<ActionStepFieldsEditor title="Stretches" description="A sequence" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Updated stretches" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not confirm/i);
    expect(screen.getByLabelText("Task title")).toHaveValue("Updated stretches");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it("cancels without saving and rejects blank wording", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ActionStepFieldsEditor title="Stretches" description="A sequence" onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
