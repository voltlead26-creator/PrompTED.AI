import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";
import type { Editor, UseEditorOptions } from "@tiptap/react";
import type { DependencyList } from "react";

const observed = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async () => {
  const actual = await vi.importActual<typeof import("@tiptap/react")>("@tiptap/react");
  return {
    ...actual,
    useEditor: function useObservedEditor(options: UseEditorOptions, deps?: DependencyList) {
      const editor = actual.useEditor(options, deps);
      observed.editor = editor;
      return editor;
    },
  };
});

const mockRun = vi.fn();
const mockApply = vi.fn();
const mockDiscard = vi.fn();
const mockRecover = vi.fn();

vi.mock("@/hooks/useAutosave", () => ({ useAutosave: vi.fn() }));
vi.mock("@/hooks/useExplainWithTED", () => ({
  useExplainWithTED: () => ({
    running: false,
    error: null,
    result: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => ({
    streaming: false,
    draft: "",
    changes: [],
    error: null,
    run: mockRun,
    applyPersisted: mockApply,
    discardPersisted: mockDiscard,
    recover: mockRecover,
    cancel: vi.fn(),
  }),
}));

import { SectionEditor } from "./SectionEditor";

function section(
  overrides: Partial<
    Section & {
      revision: number;
      ledger_binding_status: "legacy_unversioned" | "captured";
    }
  > = {},
): Section {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    document_id: "11111111-1111-4111-8111-111111111111",
    user_id: "33333333-3333-4333-8333-333333333333",
    name: "Introduction",
    order_index: 0,
    content: "<p>Hello.</p>",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    revision: 3,
    ...overrides,
  } as Section;
}

const requiredProps = {
  workspaceSaved: true,
  onApprove: vi.fn(),
  onUnapprove: vi.fn(),
  onToggleLock: vi.fn(),
  onOpenHistory: vi.fn(),
};

beforeEach(() => {
  mockRun.mockReset();
  mockApply.mockReset();
  mockDiscard.mockReset();
  mockRecover.mockReset().mockResolvedValue(null);
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ({}) as DOMRect;
  }
});

afterEach(() => {
  vi.useRealTimers();
});

async function chooseClearer(): Promise<void> {
  const trigger = screen.getByRole("button", { name: "tEdit" });
  await waitFor(() => expect(trigger).toBeEnabled());
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Make clearer" }));
}

describe("SectionEditor revision-bound TED edits", () => {
  it("offers explanation directly beside editing without opening the more menu", async () => {
    render(<SectionEditor {...requiredProps} section={section()} onEdit={vi.fn()} />);
    const explain = await screen.findByRole("button", { name: "Explain this" });
    expect(explain.closest("details")).toBeNull();
    await userEvent.click(explain);
    expect(screen.getByRole("textbox", { name: "Ask TED to explain the section" })).toBeVisible();
  });
  it("preserves imported text paragraphs and line breaks through a local edit and saved echo", async () => {
    const onEdit = vi.fn();
    const original = section({ content: "First paragraph.\n\nSecond paragraph.\nA separate line." });
    const view = render(<SectionEditor {...requiredProps} section={original} onEdit={onEdit} />);
    const textbox = await screen.findByRole("textbox", { name: "Edit Introduction" });
    await waitFor(() => expect(textbox.querySelectorAll("p")).toHaveLength(2));
    expect(textbox.querySelectorAll("p")[1]?.innerHTML).toBe("Second paragraph.<br>A separate line.");
    expect(onEdit).not.toHaveBeenCalled();

    act(() => { observed.editor!.commands.insertContentAt(1, "Updated "); });
    const expected = "<p>Updated First paragraph.</p><p>Second paragraph.<br>A separate line.</p>";
    expect(onEdit).toHaveBeenLastCalledWith(original.id, expected, { recordHistory: true });
    view.rerender(<SectionEditor {...requiredProps} section={section({ content: expected, revision: 4 })} onEdit={onEdit} />);
    expect(observed.editor!.getHTML()).toBe(expected);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("preserves paragraph structure when switching from rich text to another plain text section", async () => {
    const onEdit = vi.fn();
    const view = render(<SectionEditor {...requiredProps} section={section({ content: "<p><strong>Saved rich text.</strong></p>" })} onEdit={onEdit} />);
    await screen.findByRole("textbox", { name: "Edit Introduction" });
    expect(observed.editor!.getHTML()).toBe("<p><strong>Saved rich text.</strong></p>");
    view.rerender(<SectionEditor {...requiredProps} section={section({ id: "22222222-2222-4222-8222-222222222223", name: "Next steps", content: "- Keep the original.\n\n- Reopen the saved document." })} onEdit={onEdit} />);
    await waitFor(() => expect(observed.editor!.getHTML()).toBe("<p>- Keep the original.</p><p>- Reopen the saved document.</p>"));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it.each(["Apply", "Discard"] as const)("fences a held %s receipt from a replacement section and its new proposal", async (action) => {
    const identity = {
      operationId: "44444444-4444-4444-8444-444444444444", acceptedSectionRevision: 3,
      resultSha256: "a".repeat(64), appliedCandidateContent: "<p>Applied first section.</p>",
      appliedCandidateSha256: "b".repeat(64), requestFingerprint: "c".repeat(64),
    };
    mockRun.mockResolvedValueOnce({ content: "First proposal.", changes: [], persisted: identity })
      .mockResolvedValueOnce({ content: "Second proposal.", changes: [], persisted: {
        ...identity, operationId: "44444444-4444-4444-8444-444444444445", appliedCandidateContent: "<p>Applied second section.</p>",
      } });
    let finish!: (value: unknown) => void;
    const held = new Promise((resolve) => { finish = resolve; });
    if (action === "Apply") mockApply.mockReturnValue(held);
    else mockDiscard.mockReturnValue(held);
    const onEdit = vi.fn();
    const onPersistedLegacyApply = vi.fn();
    const props = { ...requiredProps, ledgerBindingStatus: "legacy_unversioned" as const, onEdit, onPersistedLegacyApply };
    const original = section();
    const view = render(<SectionEditor {...props} section={original} />);
    await chooseClearer();
    fireEvent.click(await screen.findByRole("button", { name: action }));
    const next = section({ id: "22222222-2222-4222-8222-222222222223", content: "<p>Second section.</p>" });
    view.rerender(<SectionEditor {...props} section={next} />);
    await chooseClearer();
    await screen.findByText("Second proposal.");
    await act(async () => finish(action === "Discard" ? true : {
      state: "applied", code: "APPLIED", operation_id: identity.operationId,
      section_id: original.id, document_id: original.document_id,
      section_content: identity.appliedCandidateContent, section_content_sha256: identity.appliedCandidateSha256,
      section_status: "edited", section_revision: 4, section_approved_revision: null,
      section_updated_at: "2026-09-01T00:01:00.000Z", document_status: "edited", document_revision: 1,
      document_approved_revision: null, document_updated_at: "2026-09-01T00:01:00.000Z",
      applied_section_revision: 4, idempotent_replay: false,
    }));
    expect(within(screen.getByRole("dialog")).getByText("Second proposal.")).toBeInTheDocument();
    expect(observed.editor!.getHTML()).toBe("<p>Second section.</p>");
    expect(onEdit).not.toHaveBeenCalled();
    expect(onPersistedLegacyApply).not.toHaveBeenCalled();
  });

  it.each(["revision", "section", "section-return"] as const)("does not present a held proposal after its accepted %s changes", async (change) => {
    let finish!: (value: { content: string; changes: string[]; persisted: null }) => void;
    mockRun.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const original = section({ ledger_binding_status: "captured" });
    const onEdit = vi.fn();
    const props = { ...requiredProps, ledgerBindingStatus: "captured" as const, revisionApproval: true, onEdit };
    const view = render(<SectionEditor {...props} section={original} />);
    await chooseClearer();
    const replacement = section({
      ledger_binding_status: "captured",
      ...(change === "revision" ? { revision: 4 } : { id: "22222222-2222-4222-8222-222222222223" }),
      content: "<p>Newer section wording.</p>",
    });
    view.rerender(<SectionEditor {...props} section={replacement} />);
    if (change === "section-return") view.rerender(<SectionEditor {...props} section={original} />);
    await act(async () => finish({ content: "Obsolete proposal from the previous revision.", changes: [], persisted: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("opens a completed section proposal in a focused modal without applying it", async () => {
    mockRun.mockResolvedValue({ content: "Clear revised wording.", changes: [], persisted: null });
    const onEdit = vi.fn();
    render(<SectionEditor {...requiredProps} section={section({ ledger_binding_status: "captured" })}
      ledgerBindingStatus="captured" revisionApproval onEdit={onEdit} />);
    await chooseClearer();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveFocus();
    expect(within(dialog).getByText("Clear revised wording.")).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("publishes a captured selection Apply exactly once without changing its surrounding wording", async () => {
    mockRun.mockResolvedValue({ content: "Hi", changes: [], persisted: null });
    const onEdit = vi.fn();
    render(
      <SectionEditor
        {...requiredProps}
        section={section({ ledger_binding_status: "captured" })}
        ledgerBindingStatus="captured"
        revisionApproval
        onEdit={onEdit}
      />,
    );
    await screen.findByRole("textbox", { name: "Edit Introduction" });
    act(() => {
      observed.editor!.commands.setTextSelection({ from: 1, to: 6 });
    });
    await chooseClearer();
    expect(mockRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        content: "Hello.",
        selection: "Hello",
        persistence: undefined,
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(observed.editor!.getHTML()).toBe("<p>Hi.</p>");
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(
      "22222222-2222-4222-8222-222222222222",
      "<p>Hi.</p>",
    );
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("binds a legacy section carrying a display key to exact revision CAS", async () => {
    const identity = {
      operationId: "44444444-4444-4444-8444-444444444444",
      acceptedSectionRevision: 3,
      resultSha256: "a".repeat(64),
      appliedCandidateContent: "<p>Clear revised wording.</p>",
      appliedCandidateSha256: "c".repeat(64),
      requestFingerprint: "b".repeat(64),
    };
    mockRun.mockResolvedValue({
      content: "Clear revised wording.",
      changes: ["Clarified wording."],
      persisted: identity,
    });
    mockApply.mockResolvedValue({
      state: "applied",
      code: "APPLIED",
      operation_id: identity.operationId,
      section_id: "22222222-2222-4222-8222-222222222222",
      document_id: "11111111-1111-4111-8111-111111111111",
      section_content: "<p>Clear revised wording.</p>",
      section_content_sha256: "c".repeat(64),
      section_status: "edited",
      section_revision: 4,
      section_approved_revision: null,
      section_updated_at: "2026-09-01T00:01:00.000Z",
      document_status: "edited",
      document_revision: 1,
      document_approved_revision: null,
      document_updated_at: "2026-09-01T00:01:00.000Z",
      applied_section_revision: 4,
      idempotent_replay: false,
    });
    const onEdit = vi.fn();
    const onPersistedLegacyApply = vi.fn();
    render(
      <SectionEditor
        {...requiredProps}
        section={section({ key: "legacy-display-key" })}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={onEdit}
        onPersistedLegacyApply={onPersistedLegacyApply}
      />,
    );

    await chooseClearer();
    await screen.findByText("Clear revised wording.");
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>Hello.</p>",
        persistence: {
          userId: "33333333-3333-4333-8333-333333333333",
          documentId: "11111111-1111-4111-8111-111111111111",
          sectionId: "22222222-2222-4222-8222-222222222222",
          expectedSectionRevision: 3,
        },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith(identity));
    expect(onPersistedLegacyApply).toHaveBeenCalledWith(
      expect.objectContaining({
        section_revision: 4,
        section_content: "<p>Clear revised wording.</p>",
      }),
    );
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("keeps captured proposals off the legacy apply RPC", async () => {
    mockRun.mockResolvedValue({
      content: "Captured revised wording.",
      changes: [],
      persisted: null,
    });
    const onEdit = vi.fn();
    render(
      <SectionEditor
        {...requiredProps}
        section={section({ ledger_binding_status: "captured" })}
        ledgerBindingStatus="captured"
        revisionApproval
        onEdit={onEdit}
      />,
    );

    await chooseClearer();
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        persistence: undefined,
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(mockApply).not.toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "<p>Captured revised wording.</p>",
    );
  });

  it("fails closed when a revision-bound legacy result lacks persisted identity", async () => {
    mockRun.mockResolvedValue({
      content: "Unbound revised wording.",
      changes: ["Changed wording."],
      persisted: null,
    });
    const onEdit = vi.fn();
    render(
      <SectionEditor
        {...requiredProps}
        section={section({})}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={onEdit}
      />,
    );

    await chooseClearer();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "without a valid durable revision binding",
    );
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(mockApply).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("fails closed when persisted binding metadata is unavailable", async () => {
    render(
      <SectionEditor
        {...requiredProps}
        section={section({ key: "cannot-infer-captured" })}
        onEdit={vi.fn()}
      />,
    );
    await chooseClearer();
    expect(mockRun).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("latest saved revision");
  });

  it("recovers a ready section suggestion and persists explicit discard", async () => {
    mockRecover.mockResolvedValue({
      state: "ready",
      operation_id: "55555555-5555-4555-8555-555555555555",
      document_id: "11111111-1111-4111-8111-111111111111",
      section_id: "22222222-2222-4222-8222-222222222222",
      accepted_section_revision: 3,
      current_section_revision: 3,
      result_sha256: "c".repeat(64),
      suggested_content: "Recovered wording.",
      applied_candidate_content: "<p>Recovered wording.</p>",
      applied_candidate_sha256: "d".repeat(64),
      changes: [],
      action: "improve",
      scope: "section",
      stale: false,
      recoverable: true,
    });
    mockDiscard.mockImplementation(async () => {
      mockRecover.mockResolvedValue({ state: "discarded", recoverable: false });
      return true;
    });
    render(
      <SectionEditor
        {...requiredProps}
        section={section({})}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );

    expect(await screen.findByText("Recovered wording.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Recovered TED's saved suggestion");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(mockDiscard).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: "55555555-5555-4555-8555-555555555555",
        }),
      ),
    );
    await waitFor(() => {
      expect(screen.queryByText("Recovered wording.")).not.toBeInTheDocument();
    });
  });

  it("does not expose a stale recovered operation as an applyable suggestion", async () => {
    mockRecover.mockResolvedValue({
      state: "stale",
      operation_id: "55555555-5555-4555-8555-555555555555",
      code: "LEGACY_SECTION_EDIT_STALE",
      current_section_revision: 4,
      recoverable: false,
    });
    render(
      <SectionEditor
        {...requiredProps}
        section={section({})}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockRecover).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("surfaces admitted progress across remount and polls until the same edit is ready", async () => {
    const progress = {
      operation_id: "55555555-5555-4555-8555-555555555555",
      recoverable: false as const,
    };
    mockRecover
      .mockResolvedValueOnce({ state: "accepted", ...progress })
      .mockResolvedValueOnce({ state: "provider_dispatched", ...progress })
      .mockResolvedValueOnce({
        state: "ready",
        operation_id: progress.operation_id,
        document_id: "11111111-1111-4111-8111-111111111111",
        section_id: "22222222-2222-4222-8222-222222222222",
        accepted_section_revision: 3,
        current_section_revision: 3,
        result_sha256: "c".repeat(64),
        suggested_content: "Recovered after remount.",
        applied_candidate_content: "<p>Recovered after remount.</p>",
        applied_candidate_sha256: "d".repeat(64),
        changes: [],
        action: "improve",
        scope: "section",
        stale: false,
        recoverable: true,
      });
    const first = render(
      <SectionEditor
        {...requiredProps}
        section={section({})}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("accepted this saved edit");
    first.unmount();

    render(
      <SectionEditor
        {...requiredProps}
        section={section({})}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already dispatched this saved edit",
    );
    expect(
      await screen.findByText("Recovered after remount.", {}, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(mockRecover).toHaveBeenCalledTimes(3);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("backs off worker-crash recovery and releases a fresh attempt only after terminal truth", async () => {
    vi.useFakeTimers();
    const progress = {
      state: "provider_dispatched" as const,
      operation_id: "55555555-5555-4555-8555-555555555555",
      recoverable: false as const,
    };
    mockRecover.mockImplementation(async () =>
      mockRecover.mock.calls.length >= 15
        ? {
            state: "reconciliation_required",
            operation_id: progress.operation_id,
            terminal_code: "LEGACY_SECTION_EDIT_DISPATCH_OUTCOME_AMBIGUOUS",
            recoverable: false,
          }
        : progress,
    );
    mockRun.mockResolvedValue(null);

    const view = render(
      <SectionEditor
        {...requiredProps}
        section={section({})}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRecover).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "tEdit" })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(749);
    });
    expect(mockRecover).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockRecover).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499);
    });
    expect(mockRecover).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockRecover).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(mockRecover).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockRecover).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 - 5_250);
    });
    expect(mockRecover).toHaveBeenCalledTimes(15);
    expect(screen.getByRole("alert")).toHaveTextContent("could not confirm the provider outcome");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    });
    expect(mockRecover).toHaveBeenCalledTimes(15);
    expect(mockRun).not.toHaveBeenCalled();

    const trigger = screen.getByRole("button", { name: "tEdit" });
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Make clearer" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("advances past a confirmed Apply tuple when newer authoritative props arrive", async () => {
    const firstIdentity = {
      operationId: "44444444-4444-4444-8444-444444444444",
      acceptedSectionRevision: 3,
      resultSha256: "a".repeat(64),
      appliedCandidateContent: "<p>Applied r4.</p>",
      appliedCandidateSha256: "b".repeat(64),
      requestFingerprint: "c".repeat(64),
    };
    mockRun
      .mockResolvedValueOnce({
        content: "Applied r4.",
        changes: [],
        persisted: firstIdentity,
      })
      .mockResolvedValueOnce({
        content: "Proposed from r5.",
        changes: [],
        persisted: {
          ...firstIdentity,
          operationId: "66666666-6666-4666-8666-666666666666",
          acceptedSectionRevision: 5,
        },
      });
    mockApply.mockResolvedValue({
      state: "applied",
      code: "APPLIED",
      operation_id: firstIdentity.operationId,
      section_id: "22222222-2222-4222-8222-222222222222",
      document_id: "11111111-1111-4111-8111-111111111111",
      section_content: "<p>Applied r4.</p>",
      section_content_sha256: "b".repeat(64),
      section_status: "edited",
      section_revision: 4,
      section_approved_revision: null,
      section_updated_at: "2026-09-01T00:01:00.000Z",
      document_status: "edited",
      document_revision: 4,
      document_approved_revision: null,
      document_updated_at: "2026-09-01T00:01:00.000Z",
      applied_section_revision: 4,
      idempotent_replay: false,
    });
    const view = render(
      <SectionEditor
        {...requiredProps}
        section={section({ revision: 3, content: "<p>Original r3.</p>" })}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );

    await chooseClearer();
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledOnce());

    view.rerender(
      <SectionEditor
        {...requiredProps}
        section={section({ revision: 5, content: "<p>Authoritative r5.</p>" })}
        ledgerBindingStatus="legacy_unversioned"
        onEdit={vi.fn()}
      />,
    );
    await chooseClearer();
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(2));
    expect(mockRun.mock.calls[1]?.[0]).toMatchObject({
      content: "<p>Authoritative r5.</p>",
      persistence: { expectedSectionRevision: 5 },
    });
  });
});
