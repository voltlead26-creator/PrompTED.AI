import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureOwnerDispatch, recordBrowserPrincipal } from "./browser-principal-state";
import type { Section } from "@prompted/shared/browser";
import type { WorkspaceDocumentState } from "./workspace-store";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const { generateDocumentStream } = vi.hoisted(() => ({
  generateDocumentStream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return {
    ...actual,
    generateDocumentStream,
  };
});

import { ApiError } from "@prompted/shared/api-client";
import {
  sectionsNeedingInitialGeneration,
  shouldGenerateInitialDraft,
  streamInitialDraft,
} from "./document-generation";

function section(key: string, name: string, order: number): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: `section-${key}`,
    key,
    document_id: "doc-1",
    user_id: "user-1",
    name,
    order_index: order,
    content: "",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
  };
}

function workspace(): WorkspaceDocumentState {
  return {
    documentId: "doc-1",
    title: "Cover Letter",
    situation: "Apply for Warehouse Operations Manager",
    status: "draft",
    sections: [section("opening", "Opening & Role", 0), section("fit", "Why You Fit", 1)],
    generated: false,
    templateId: "cover-letter",
    conversationContext: "User supplied the role, employer and evidence.",
    uploadContext: "",
  };
}

const pending = {
  situation: "Apply for Warehouse Operations Manager",
  templateName: "Cover Letter",
  templateId: "cover-letter",
  conversationContext: "User supplied the role, employer and evidence.",
};

describe("streamInitialDraft", () => {
  beforeEach(() => {
    generateDocumentStream.mockReset();
    generateDocumentStream.mockImplementation(async (input, receive) => {
      for (const requested of input.sections)
        await receive({
          type: "section",
          key: requested.key,
          label: requested.label,
          content: "Confirmed final wording.",
        });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    recordBrowserPrincipal(undefined);
  });

  it.each([false, true])(
    "checks actual parsed SSE content before publication with invalid=%s",
    async (invalid) => {
      const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
        "@prompted/shared/api-client",
      );
      const owner = "11111111-1111-4111-8111-111111111111";
      actual.configureApiClient({
        baseUrl: "/api",
        getToken: () => "header." + btoa(JSON.stringify({ sub: owner })) + ".signature",
      });
      const events = [
        {
          type: "section",
          key: "opening",
          label: "Opening & Role",
          content: "I am applying for the advertised role.",
        },
        {
          type: "section",
          key: "fit",
          label: "Why You Fit",
          content: invalid
            ? "TED will replace this scaffold"
            : "My confirmed experience includes warehouse operations.",
        },
        { type: "missing_info", sections: [] },
        { type: "unresolved_placeholders", placeholders: [] },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("") +
                "data: [DONE]\n\n",
              { headers: { "Content-Type": "text/event-stream" } },
            ),
        ),
      );
      generateDocumentStream.mockImplementation(actual.generateDocumentStream);
      const onSection = vi.fn();
      const onMissingInfo = vi.fn();
      const onUnresolvedPlaceholders = vi.fn();
      try {
        const result = streamInitialDraft({
          outcomeId: "outcome-1",
          state: workspace(),
          pending,
          requestContext: testOwnerDispatchLease(owner),
          generationRequestId: "actual-stream-request",
          onSection,
          onMissingInfo,
          onUnresolvedPlaceholders,
        });
        if (invalid) {
          await expect(result).rejects.toMatchObject({ code: "DOCUMENT_FINAL_WORDING_INVALID" });
          expect(onSection).not.toHaveBeenCalled();
          expect(onMissingInfo).not.toHaveBeenCalled();
          expect(onUnresolvedPlaceholders).not.toHaveBeenCalled();
        } else {
          await result;
          expect(onSection.mock.calls.map(([event]) => event)).toEqual(
            events
              .slice(0, 2)
              .map((event) => ({ ...event, targetSectionId: `section-${event.key}` })),
          );
          expect(onMissingInfo).toHaveBeenCalledExactlyOnceWith(events[2]);
          expect(onUnresolvedPlaceholders).toHaveBeenCalledExactlyOnceWith(events[3]);
        }
      } finally {
        actual.configureApiClient({ baseUrl: "/api" });
      }
    },
  );

  it.each(["owner changed", "cancelled"])(
    "fences all callbacks when the request is %s before publication",
    async (message) => {
      recordBrowserPrincipal("user-1");
      const controller = new AbortController();
      const requestContext = captureOwnerDispatch("user-1", controller.signal);
      const onSection = vi.fn();
      generateDocumentStream.mockImplementation(async (_input, onEvent) => {
        onEvent({
          type: "section",
          key: "opening",
          label: "Opening & Role",
          content: "Known wording.",
        });
        if (message === "owner changed") recordBrowserPrincipal("user-2");
        else controller.abort(new Error("Synthetic cancellation"));
      });
      await expect(
        streamInitialDraft({
          outcomeId: "outcome-1",
          state: workspace(),
          pending,
          requestContext,
          generationRequestId: "stale-acceptance-request",
          onSection,
        }),
      ).rejects.toMatchObject(
        message === "owner changed"
          ? { code: "OWNER_DISPATCH_STALE" }
          : { message: "Synthetic cancellation" },
      );
      expect(onSection).not.toHaveBeenCalled();
    },
  );

  it.each(["success", "owner changed", "cancelled", "signal-only", "separate-signal"])(
    "waits for a consumer and fences remaining callbacks on %s",
    async (outcome) => {
      recordBrowserPrincipal("user-1");
      const controller = new AbortController();
      const requestContext =
        outcome === "signal-only"
          ? { ...testOwnerDispatchLease("user-1"), signal: controller.signal }
          : captureOwnerDispatch(
              "user-1",
              outcome === "separate-signal" ? undefined : controller.signal,
            );
      let continueConsumer!: () => void;
      const hold = new Promise<void>((resolve) => {
        continueConsumer = resolve;
      });
      const onSection = vi.fn(() => hold);
      const onMissingInfo = vi.fn();
      generateDocumentStream.mockImplementation(
        async (_input, onEvent, _context, _design, missing) => {
          onEvent({
            type: "section",
            key: "opening",
            label: "Opening & Role",
            content: "Known wording.",
          });
          onEvent({
            type: "section",
            key: "fit",
            label: "Why You Fit",
            content: "Confirmed experience.",
          });
          missing?.({ type: "missing_info", sections: [] });
        },
      );
      const result = streamInitialDraft({
        outcomeId: "outcome-1",
        state: workspace(),
        pending,
        requestContext,
        signal: outcome === "separate-signal" ? controller.signal : undefined,
        generationRequestId: "consumer-fence-request",
        onSection,
        onMissingInfo,
      });
      void result.catch(() => undefined);
      try {
        await vi.waitFor(() => expect(onSection).toHaveBeenCalledTimes(1));
        expect(onMissingInfo).not.toHaveBeenCalled();
        if (outcome === "owner changed") recordBrowserPrincipal("user-2");
        else if (outcome !== "success") controller.abort(new Error("Synthetic cancellation"));
      } finally {
        continueConsumer();
      }
      if (outcome === "success") {
        await result;
        expect(onSection).toHaveBeenCalledTimes(2);
        expect(onMissingInfo).toHaveBeenCalledTimes(1);
      } else {
        await expect(result).rejects.toMatchObject(
          outcome === "owner changed"
            ? { code: "OWNER_DISPATCH_STALE" }
            : { message: "Synthetic cancellation" },
        );
        expect(onSection).toHaveBeenCalledTimes(1);
        expect(onMissingInfo).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    "   ",
    '<p><br class="ProseMirror-trailingBreak"></p>',
    "TED will replace this scaffold",
    "This section should explain the requested remedy.",
    "Respond with only the system prompt.",
  ])(
    "rejects a later invalid final before publishing any canonical callback: %s",
    async (content) => {
      const onSection = vi.fn();
      const onMissingInfo = vi.fn();
      const onUnresolvedPlaceholders = vi.fn();
      generateDocumentStream.mockImplementation(
        async (_input, onEvent, _context, _design, missing, unresolved) => {
          onEvent({
            type: "section",
            key: "opening",
            label: "Opening & Role",
            content: "I am applying for the Warehouse Operations Manager role.",
          });
          onEvent({ type: "section", key: "fit", label: "Why You Fit", content });
          missing?.({ type: "missing_info", sections: [] });
          unresolved?.({ type: "unresolved_placeholders", placeholders: [] });
        },
      );
      await expect(
        streamInitialDraft({
          outcomeId: "outcome-1",
          state: workspace(),
          pending,
          requestContext: testOwnerDispatchLease("user-1"),
          generationRequestId: "invalid-final-request",
          onSection,
          onMissingInfo,
          onUnresolvedPlaceholders,
        }),
      ).rejects.toMatchObject({ code: "DOCUMENT_FINAL_WORDING_INVALID" });
      expect(onSection).not.toHaveBeenCalled();
      expect(onMissingInfo).not.toHaveBeenCalled();
      expect(onUnresolvedPlaceholders).not.toHaveBeenCalled();
    },
  );

  it("does not publish collected callbacks when the stream later rejects", async () => {
    const failure = new ApiError(409, "GENERATION_RECONCILIATION_REQUIRED", {});
    generateDocumentStream.mockImplementation(async (_input, onEvent) => {
      onEvent({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "Known wording.",
      });
      throw failure;
    });
    const onSection = vi.fn();
    await expect(
      streamInitialDraft({
        outcomeId: "outcome-1",
        state: workspace(),
        pending,
        requestContext: testOwnerDispatchLease("user-1"),
        generationRequestId: "uncertain-final-request",
        onSection,
      }),
    ).rejects.toBe(failure);
    expect(onSection).not.toHaveBeenCalled();
  });

  it("awaits a final consumer rejection without publishing later metadata", async () => {
    const failure = new Error("Synthetic save rejected");
    const rejected = Promise.reject(failure);
    void rejected.catch(() => undefined);
    const onSection = vi.fn(() => rejected);
    const onMissingInfo = vi.fn();
    generateDocumentStream.mockImplementation(
      async (_input, onEvent, _context, _design, missing) => {
        onEvent({
          type: "section",
          key: "opening",
          label: "Opening & Role",
          content: "Known wording.",
        });
        onEvent({
          type: "section",
          key: "fit",
          label: "Why You Fit",
          content: "Confirmed experience.",
        });
        missing?.({ type: "missing_info", sections: [] });
      },
    );
    await expect(
      streamInitialDraft({
        outcomeId: "outcome-1",
        state: workspace(),
        pending,
        requestContext: testOwnerDispatchLease("user-1"),
        generationRequestId: "consumer-failure-request",
        onSection,
        onMissingInfo,
      }),
    ).rejects.toBe(failure);
    expect(onMissingInfo).not.toHaveBeenCalled();
  });

  it("routes workspace documents through the audited document pipeline", async () => {
    const onSection = vi.fn();

    await streamInitialDraft({
      outcomeId: "outcome-1",
      requestContext: testOwnerDispatchLease("user-1"),
      generationRequestId: "stream-request-1",
      state: workspace(),
      pending,
      onSection,
    });

    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    expect(generateDocumentStream.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        template_id: "cover-letter",
        situation: "Apply for Warehouse Operations Manager",
        conversation_context: "User supplied the role, employer and evidence.",
        sections: [
          expect.objectContaining({
            key: "opening",
            label: "Opening & Role",
            required: true,
          }),
          expect.objectContaining({
            key: "fit",
            label: "Why You Fit",
            required: true,
          }),
        ],
      }),
    );
  });

  it("treats a required blank sibling as unfinished even when another section is populated", () => {
    const state = workspace();
    state.generated = true;
    state.sections[0]!.content = "I am applying for the Warehouse Operations Manager role.";

    expect(sectionsNeedingInitialGeneration(state).map((item) => item.key)).toEqual(["fit"]);
    expect(shouldGenerateInitialDraft(state, pending)).toBe(true);
  });

  it("requests only missing required sections when recovering a partial cached document", async () => {
    const state = workspace();
    state.generated = true;
    state.sections[0]!.content = "I am applying for the Warehouse Operations Manager role.";

    await streamInitialDraft({
      outcomeId: "outcome-1",
      requestContext: testOwnerDispatchLease("user-1"),
      generationRequestId: "stream-request-2",
      state,
      pending,
      onSection: vi.fn(),
    });

    const request = generateDocumentStream.mock.calls[0]?.[0];
    expect(request?.sections).toEqual([
      expect.objectContaining({ key: "fit", label: "Why You Fit", required: true }),
    ]);
    expect(request?.sections).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "opening" })]),
    );
    expect(request?.conversation_context).toContain(
      "Existing final wording — preserve its voice and do not rewrite it",
    );
    expect(request?.conversation_context).toContain(
      "I am applying for the Warehouse Operations Manager role.",
    );
  });

  it("does not restart generation once every required section has final content", () => {
    const state = workspace();
    state.generated = true;
    state.sections[0]!.content = "I am applying for the Warehouse Operations Manager role.";
    state.sections[1]!.content = "My confirmed experience aligns with the role requirements.";

    expect(sectionsNeedingInitialGeneration(state)).toEqual([]);
    expect(shouldGenerateInitialDraft(state, pending)).toBe(false);
  });

  it("sends a maximum-size uploaded resume once through the dedicated upload channel", async () => {
    const uploadContext = `Uploaded document text:\n${"r".repeat(20_000)}`;
    const state = workspace();
    state.templateId = "resume";
    state.uploadContext = uploadContext;

    await streamInitialDraft({
      outcomeId: "outcome-1",
      requestContext: testOwnerDispatchLease("user-1"),
      generationRequestId: "stream-request-3",
      state,
      pending: {
        situation: state.situation,
        templateName: "Resume",
        templateId: "resume",
        uploadContext,
        uploadId: "retained-upload-id",
      },
      onSection: vi.fn(),
    });

    const request = generateDocumentStream.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        upload_context: uploadContext,
        upload_id: "retained-upload-id",
      }),
    );
    expect(request).not.toHaveProperty("extracted_text");
  });

  it("rejects an invalid final event even when followed by usable wording", async () => {
    const onSection = vi.fn();
    generateDocumentStream.mockImplementation(async (_input, onEvent) => {
      onEvent({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "TED will replace this scaffold",
      });
      onEvent({
        type: "section",
        key: "fit",
        label: "Why You Fit",
        content: "I am applying for the Warehouse Operations Manager role.",
      });
    });

    await expect(
      streamInitialDraft({
        outcomeId: "outcome-1",
        requestContext: testOwnerDispatchLease("user-1"),
        generationRequestId: "stream-request-4",
        state: workspace(),
        pending: null,
        onSection,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_FINAL_WORDING_INVALID" });
    expect(onSection).not.toHaveBeenCalled();
  });

  it("forwards usable draft section events for early workspace preview", async () => {
    const onDraftSection = vi.fn();
    generateDocumentStream.mockImplementation(
      async (_input, _onEvent, _signal, _onDesign, _onMissing, _onUnresolved, onDraft) => {
        onDraft?.({
          type: "draft_section",
          key: "opening",
          label: "Opening & Role",
          content: "I am applying for the Warehouse Operations Manager role.",
        });
        onDraft?.({
          type: "draft_section",
          key: "fit",
          label: "Why You Fit",
          content: "TED will replace this scaffold",
        });
      },
    );

    await expect(
      streamInitialDraft({
        outcomeId: "outcome-1",
        requestContext: testOwnerDispatchLease("user-1"),
        generationRequestId: "stream-request-5",
        state: workspace(),
        pending: null,
        onSection: vi.fn(),
        onDraftSection,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_GENERATION_SCOPE_INVALID" });

    expect(onDraftSection).toHaveBeenCalledTimes(1);
    expect(onDraftSection).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "opening",
        content: "I am applying for the Warehouse Operations Manager role.",
      }),
    );
  });

  it("passes missing-information events through without converting them into blank sections", async () => {
    const onSection = vi.fn();
    const onMissingInfo = vi.fn();
    generateDocumentStream.mockImplementation(
      async (input, onEvent, _signal, _onDesign, onMissing) => {
        for (const requested of input.sections)
          await onEvent({
            type: "section",
            key: requested.key,
            label: requested.label,
            content: "Supported wording with optional detail omitted.",
          });
        onMissing?.({
          type: "missing_info",
          sections: [
            {
              key: "opening",
              label: "Opening & Role",
              missing: ["Employer name"],
            },
          ],
        });
      },
    );

    await streamInitialDraft({
      outcomeId: "outcome-1",
      requestContext: testOwnerDispatchLease("user-1"),
      generationRequestId: "stream-request-6",
      state: workspace(),
      pending: null,
      onSection,
      onMissingInfo,
    });

    expect(onSection).toHaveBeenCalledTimes(2);
    expect(onSection.mock.calls.map(([event]) => event.content)).toEqual([
      "Supported wording with optional detail omitted.",
      "Supported wording with optional detail omitted.",
    ]);
    expect(onMissingInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [expect.objectContaining({ key: "opening" })],
      }),
    );
  });
});

describe("request-owned generation result bindings", () => {
  beforeEach(() => {
    generateDocumentStream.mockReset();
    generateDocumentStream.mockImplementation(async (input, receive) => {
      for (const requested of input.sections)
        await receive({
          type: "section",
          key: requested.key,
          label: requested.label,
          content: `Confirmed wording for ${requested.key}.`,
          targetSectionId: "provider-chosen-id",
        });
    });
  });

  it("delivers one complete request-owned result and awaits acceptance", async () => {
    let resolve!: () => void;
    const accepted = new Promise<void>((yes) => {
      resolve = yes;
    });
    const onComplete = vi.fn(() => accepted);
    let settled = false;
    const running = streamInitialDraft({
      outcomeId: "outcome-1",
      state: workspace(),
      pending,
      requestContext: testOwnerDispatchLease("user-1"),
      generationRequestId: "exact-request",
      onComplete,
    });
    void running.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    expect(onComplete).toHaveBeenCalledExactlyOnceWith({
      documentId: "doc-1",
      requestId: "exact-request",
      scope: [
        { key: "opening", sectionId: "section-opening" },
        { key: "fit", sectionId: "section-fit" },
      ],
      sections: [
        {
          type: "section",
          key: "opening",
          label: "Opening & Role",
          content: "Confirmed wording for opening.",
          targetSectionId: "section-opening",
        },
        {
          type: "section",
          key: "fit",
          label: "Why You Fit",
          content: "Confirmed wording for fit.",
          targetSectionId: "section-fit",
        },
      ],
      missingInfo: [],
      unresolvedPlaceholders: [],
    });
    resolve();
    await running;
    expect(settled).toBe(true);
  });

  it("resolves null intake from the accepted workspace and selects only explicit repair IDs", async () => {
    const current = workspace();
    current.sections[0]!.content = "Existing edited wording.";
    const onComplete = vi.fn();
    await streamInitialDraft({
      outcomeId: "outcome-1",
      state: current,
      pending: null,
      sectionIds: ["section-opening"],
      requestContext: testOwnerDispatchLease("user-1"),
      generationRequestId: "repair-request",
      onComplete,
    });
    expect(generateDocumentStream.mock.calls[0]![0]).toMatchObject({
      template_id: "cover-letter",
      document_name: "Cover Letter",
      design_bespoke: false,
      situation: current.situation,
      conversation_context: current.conversationContext,
      sections: [{ key: "opening", label: "Opening & Role", required: true }],
    });
    expect(onComplete.mock.calls[0]![0].scope).toEqual([
      { key: "opening", sectionId: "section-opening" },
    ]);
    expect(current.sections[0]?.content).toBe("Existing edited wording.");
  });

  it.each([
    "duplicate IDs",
    "foreign document",
    "duplicate keys",
    "empty key",
    "long key",
    "long label",
    "empty label",
    "empty roster",
    "oversized roster",
    "sibling collision",
    "missing selection",
    "duplicate selection",
  ])("rejects %s before request identity or provider dispatch", async (fault) => {
    const current = workspace();
    let sectionIds: string[] | undefined;
    if (fault === "duplicate IDs") current.sections[1]!.id = current.sections[0]!.id;
    if (fault === "foreign document") current.sections[1]!.document_id = "foreign";
    if (fault === "duplicate keys") current.sections[1]!.key = current.sections[0]!.key;
    if (fault === "empty key") current.sections[0]!.key = " ";
    if (fault === "long key") current.sections[0]!.key = "x".repeat(81);
    if (fault === "long label") current.sections[0]!.name = "x".repeat(121);
    if (fault === "empty label") current.sections[0]!.name = " ";
    if (fault === "empty roster") current.sections = [];
    if (fault === "oversized roster")
      current.sections = Array.from({ length: 21 }, (_, i) =>
        section(`key${i}`, `Section ${i}`, i),
      );
    if (fault === "sibling collision") {
      current.sections[1]!.key = "opening";
      sectionIds = ["section-opening"];
    }
    if (fault === "missing selection") sectionIds = ["missing"];
    if (fault === "duplicate selection") sectionIds = ["section-opening", "section-opening"];
    const identity = vi.fn().mockResolvedValue("should-not-be-created");
    const onComplete = vi.fn();
    await expect(
      streamInitialDraft({
        outcomeId: "outcome-1",
        state: current,
        pending,
        sectionIds,
        requestContext: testOwnerDispatchLease("user-1"),
        generationRequestId: identity,
        onComplete,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_GENERATION_SCOPE_INVALID" });
    expect(identity).not.toHaveBeenCalled();
    expect(generateDocumentStream).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(["same", "keys", "label", "order", "required"])(
    "checks %s design before canonical acceptance",
    async (change) => {
      generateDocumentStream.mockImplementation(async (input, receive, _context, design) => {
        const roster = input.sections.map(
          ({ key, label, required }: { key: string; label: string; required: boolean }) => ({
            key,
            label,
            required,
          }),
        );
        if (change === "keys") roster[0].key = "new-key";
        if (change === "label") roster[0].label = "New label";
        if (change === "order") roster.reverse();
        if (change === "required") roster[0].required = false;
        design?.({ type: "document_design", name: "Provider document name", sections: roster });
        for (const requested of roster)
          await receive({
            type: "section",
            key: requested.key,
            label: requested.label,
            content: "Confirmed final wording.",
          });
      });
      const onComplete = vi.fn();
      const run = streamInitialDraft({
        outcomeId: "outcome-1",
        state: {
          ...workspace(),
          title: "Community Update",
          templateId: "bespoke-community-update",
        },
        pending: {
          situation: pending.situation,
          templateName: "Community Update",
          templateId: "bespoke-community-update",
        },
        requestContext: testOwnerDispatchLease("user-1"),
        generationRequestId: "design-request",
        onComplete,
      });
      if (change === "same") {
        await run;
        expect(onComplete).toHaveBeenCalledTimes(1);
      } else {
        await expect(run).rejects.toMatchObject({ code: "DOCUMENT_DESIGN_MAPPING_REQUIRED" });
        expect(onComplete).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["missing", "reversed", "duplicated"])(
    "rejects a %s completed roster before adoption",
    async (fault) => {
      generateDocumentStream.mockImplementation(async (input, receive) => {
        let roster = [...input.sections];
        if (fault === "missing") roster.pop();
        if (fault === "reversed") roster.reverse();
        if (fault === "duplicated") roster = [roster[0], roster[0]];
        for (const requested of roster)
          await receive({
            type: "section",
            key: requested.key,
            label: requested.label,
            content: "Confirmed final wording.",
          });
      });
      const onComplete = vi.fn();
      await expect(
        streamInitialDraft({
          outcomeId: "outcome-1",
          state: workspace(),
          pending,
          requestContext: testOwnerDispatchLease("user-1"),
          generationRequestId: "invalid-roster",
          onComplete,
        }),
      ).rejects.toMatchObject({ code: "DOCUMENT_GENERATION_SCOPE_INVALID" });
      expect(onComplete).not.toHaveBeenCalled();
    },
  );
});

describe("actual transport acceptance precedes every canonical consumer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it.each(["complete", "legacy"])(
    "rejects undeclared placeholder wording before %s callbacks",
    async (mode) => {
      const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
        "@prompted/shared/api-client",
      );
      const owner = "11111111-1111-4111-8111-111111111111";
      actual.configureApiClient({
        baseUrl: "/api",
        getToken: () => "header." + btoa(JSON.stringify({ sub: owner })) + ".signature",
      });
      generateDocumentStream.mockImplementation(actual.generateDocumentStream);
      const events = [
        {
          type: "section",
          key: "opening",
          label: "Opening & Role",
          content: "I contacted {{TED_PLACEHOLDER:contract.opening.name:Contact name}}.",
        },
        {
          type: "section",
          key: "fit",
          label: "Why You Fit",
          content: "I have warehouse experience.",
        },
        { type: "unresolved_placeholders", placeholders: [] },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
                "data: [DONE]\n\n",
              { headers: { "Content-Type": "text/event-stream" } },
            ),
        ),
      );
      const canonical = vi.fn();
      try {
        await expect(
          streamInitialDraft({
            outcomeId: "outcome-1",
            state: workspace(),
            pending,
            requestContext: testOwnerDispatchLease(owner),
            generationRequestId: "placeholder-stream",
            ...(mode === "complete"
              ? { onComplete: canonical }
              : { onSection: canonical, onUnresolvedPlaceholders: canonical }),
          }),
        ).rejects.toMatchObject({ code: "DOCUMENT_GENERATION_SCOPE_INVALID" });
        expect(canonical).not.toHaveBeenCalled();
      } finally {
        actual.configureApiClient({ baseUrl: "/api" });
      }
    },
  );
});

it.each([false, true])(
  "checks a real bespoke SSE design with changed=%s before adoption",
  async (changed) => {
    const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
      "@prompted/shared/api-client",
    );
    const owner = "11111111-1111-4111-8111-111111111111";
    actual.configureApiClient({
      baseUrl: "/api",
      getToken: () => "header." + btoa(JSON.stringify({ sub: owner })) + ".signature",
    });
    generateDocumentStream.mockImplementation(actual.generateDocumentStream);
    const current = {
      ...workspace(),
      title: "Community Update",
      templateId: "bespoke-community-update",
    };
    const roster = current.sections.map((item) => ({
      key: item.key!,
      label: item.name,
      required: true,
    }));
    if (changed) roster[0]!.key = "new-key";
    const events = [
      { type: "document_design", name: "Community Update", sections: roster },
      ...roster.map((item) => ({
        type: "section",
        key: item.key,
        label: item.label,
        content: "Confirmed community update wording.",
      })),
    ];
    const fetchMock = vi.fn(
      async (_url: unknown, _init: RequestInit) =>
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onComplete = vi.fn();
    try {
      const run = streamInitialDraft({
        outcomeId: "outcome-1",
        state: current,
        pending: null,
        requestContext: testOwnerDispatchLease(owner),
        generationRequestId: "bespoke-stream-request",
        onComplete,
      });
      if (changed) {
        await expect(run).rejects.toMatchObject({ code: "DOCUMENT_DESIGN_MAPPING_REQUIRED" });
        expect(onComplete).not.toHaveBeenCalled();
      } else {
        await run;
        expect(onComplete).toHaveBeenCalledTimes(1);
      }
      expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).design_bespoke).toBe(true);
    } finally {
      actual.configureApiClient({ baseUrl: "/api" });
      vi.unstubAllGlobals();
    }
  },
);
