import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";
import type { WorkspaceDocumentState } from "./workspace-store";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";
import { validateFinishedSection } from "./output-integrity";

const { generateDocumentStream } = vi.hoisted(() => ({
  generateDocumentStream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return { ...actual, generateDocumentStream };
});

import { applyGeneratedSection, streamInitialDraft } from "./document-generation";

const FORBIDDEN_FINAL_WORDING = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /TED_PLACEHOLDER/i,
  /TED will replace this scaffold/i,
  /prompted:template-draft/i,
  /\binsert (?:your|the)\b/i,
  /\bfill in (?:your|the)\b/i,
  /\bthis section should\b/i,
  /\bprompt the user\b/i,
  /\bask the user\b/i,
];

function makeSection(key: string, name: string, order: number, content = ""): Section {
  const now = "2026-08-12T00:00:00.000Z";
  return {
    id: `section-${key}`,
    key,
    document_id: "doc-five-run",
    user_id: "user-five-run",
    name,
    order_index: order,
    content,
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
  };
}

function state(params: {
  title: string;
  templateId: string;
  situation: string;
  conversationContext?: string;
  uploadContext?: string;
  sections: Section[];
  generated?: boolean;
}): WorkspaceDocumentState {
  return {
    documentId: "doc-five-run",
    title: params.title,
    situation: params.situation,
    status: "draft",
    sections: params.sections,
    generated: params.generated ?? false,
    templateId: params.templateId,
    conversationContext: params.conversationContext ?? "",
    uploadContext: params.uploadContext ?? "",
  };
}

function assertFinalDocument(result: WorkspaceDocumentState) {
  for (const section of result.sections.filter((item) => item.is_required !== false)) {
    expect(section.content.trim(), `${section.name} must not be blank`).not.toBe("");
    expect(validateFinishedSection(section.content), `${section.name} must be final wording`).toEqual(
      expect.objectContaining({ valid: true, code: null }),
    );
    for (const pattern of FORBIDDEN_FINAL_WORDING) {
      expect(section.content, `${section.name} exposed forbidden scaffold/instruction text`).not.toMatch(pattern);
    }
  }
}

async function runCase(params: {
  initial: WorkspaceDocumentState;
  templateName: string;
  outputByKey: Record<string, string>;
  uploadId?: string;
}) {
  let result = params.initial;
  generateDocumentStream.mockImplementationOnce(async (request, onEvent) => {
    for (const requested of request.sections ?? []) {
      const content = params.outputByKey[requested.key];
      if (!content) throw new Error(`Missing test output for ${requested.key}`);
      onEvent({ type: "section", key: requested.key, label: requested.label, content });
    }
  });

  await streamInitialDraft({
    outcomeId: "outcome-five-run",
    requestContext: testOwnerDispatchLease("user-1"),
    generationRequestId: "recovery-contract-request",
    state: params.initial,
    pending: {
      situation: params.initial.situation,
      templateName: params.templateName,
      templateId: params.initial.templateId ?? undefined,
      conversationContext: params.initial.conversationContext,
      uploadContext: params.initial.uploadContext,
      uploadId: params.uploadId,
    },
    onSection: (event) => {
      result = applyGeneratedSection(result, event);
    },
  });

  assertFinalDocument(result);
  return result;
}

describe("deterministic document-generation recovery contract", () => {
  beforeEach(() => {
    generateDocumentStream.mockReset();
  });

  it("run 1/5: complete resume produces final wording in every required section", async () => {
    await runCase({
      templateName: "Resume",
      initial: state({
        title: "Resume",
        templateId: "resume",
        situation: "Prepare a resume for an experienced business centre manager.",
        conversationContext: "Candidate manages a coworking business centre and member experience.",
        sections: [
          makeSection("contact_details", "Contact Details", 0),
          makeSection("professional_summary", "Professional Summary", 1),
          makeSection("work_experience", "Work Experience", 2),
        ],
      }),
      outputByKey: {
        contact_details: "Kai Churchward | Melbourne, Victoria",
        professional_summary: "Business centre manager experienced in member service, workspace operations and day-to-day site coordination.",
        work_experience: "Business Centre Manager — Coordinates member experience, workspace operations and day-to-day centre requirements.",
      },
    });
  });

  it("run 2/5: partially blank cached resume resumes only missing sections and preserves good wording", async () => {
    const existing = "Kai Churchward | Melbourne, Victoria";
    const initial = state({
      title: "Resume",
      templateId: "resume",
      situation: "Prepare a resume for an experienced business centre manager.",
      conversationContext: "Candidate manages a coworking business centre and member experience.",
      generated: true,
      sections: [
        makeSection("contact_details", "Contact Details", 0, existing),
        makeSection("professional_summary", "Professional Summary", 1),
        makeSection("work_experience", "Work Experience", 2),
      ],
    });

    const result = await runCase({
      templateName: "Resume",
      initial,
      outputByKey: {
        professional_summary: "Business centre manager focused on member experience, practical operations and responsive service.",
        work_experience: "Business Centre Manager — Supports members, coordinates centre operations and keeps workspace requirements moving.",
      },
    });

    expect(result.sections[0]!.content).toBe(existing);
    const request = generateDocumentStream.mock.calls[0]?.[0];
    expect(request?.sections?.map((item: { key: string }) => item.key)).toEqual([
      "professional_summary",
      "work_experience",
    ]);
  });

  it("run 3/5: upload-backed resume retains source context and produces populated wording", async () => {
    const uploadContext = "CreativeCubes Balaclava — Business Centre Manager. Member experience, tenant communication and centre operations.";
    const result = await runCase({
      templateName: "Resume",
      uploadId: "resume-upload-123",
      initial: state({
        title: "Resume",
        templateId: "resume",
        situation: "Update the resume from the uploaded source.",
        uploadContext,
        sections: [
          makeSection("professional_summary", "Professional Summary", 0),
          makeSection("work_experience", "Work Experience", 1),
        ],
      }),
      outputByKey: {
        professional_summary: "Business centre manager with experience supporting members, tenant communication and centre operations.",
        work_experience: "CreativeCubes Balaclava — Business Centre Manager. Supports member experience, tenant communication and centre operations.",
      },
    });

    expect(generateDocumentStream.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ upload_context: uploadContext, upload_id: "resume-upload-123" }),
    );
    expect(result.sections[1]!.content).toContain("CreativeCubes Balaclava");
  });

  it("run 4/5: cover letter uses usable neutral wording when recipient details are missing", async () => {
    await runCase({
      templateName: "Cover Letter",
      initial: state({
        title: "Cover Letter",
        templateId: "cover-letter",
        situation: "Apply for an operations role. The recipient name is unknown.",
        conversationContext: "Use professional neutral wording when recipient details are unavailable.",
        sections: [
          makeSection("opening", "Opening & Role", 0),
          makeSection("fit", "Why You Fit", 1),
        ],
      }),
      outputByKey: {
        opening: "Dear Hiring Manager,\n\nI am writing to apply for the operations role and to outline the practical experience I would bring to the position.",
        fit: "My experience centres on responsive service, day-to-day operations and clear communication with the people using the workspace.",
      },
    });
  });

  it("run 5/5: non-employment document produces complete final wording without scaffold leakage", async () => {
    await runCase({
      templateName: "Meeting Agenda",
      initial: state({
        title: "Meeting Agenda",
        templateId: "meeting-agenda",
        situation: "Prepare a weekly operations meeting agenda for a small team.",
        conversationContext: "The meeting should cover priorities, blockers, decisions and next actions.",
        sections: [
          makeSection("priorities", "Priorities", 0),
          makeSection("blockers", "Blockers", 1),
          makeSection("actions", "Next Actions", 2),
        ],
      }),
      outputByKey: {
        priorities: "Review this week's highest-priority operational work and confirm what needs to be completed first.",
        blockers: "Identify current blockers, agree who can remove each one and confirm any decision needed from the team.",
        actions: "Confirm each agreed action, its owner and the timing the team has committed to during the meeting.",
      },
    });
  });
});
