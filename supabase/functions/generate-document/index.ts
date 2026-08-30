// =====================================================
// PrompTED — generate-document (streaming)
// Three-stage pipeline: intent → generation → final review.
// Streams only reviewed sections to the client.
// =====================================================

import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt } from "../_shared/prompt-builder.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import {
  applyPreFill,
  type ProfileData,
  resolveTemplate,
  sectionListInstruction,
  type TemplateSection,
} from "../_shared/template-engine.ts";
import { runDocumentPipeline } from "../_shared/document-pipeline.ts";
import { assertDeliverableSections } from "../_shared/document-delivery-guard.ts";
import { designBespokeTemplate } from "../_shared/section-designer.ts";
import { trackDocumentCreated } from "../_shared/cost-tracker.ts";
import {
  SSE_HEADERS,
  sseDone,
  sseEvent,
  sseHeartbeat,
} from "../_shared/orchestration.ts";
import { resolveRetainedUploadContext } from "../_shared/upload-context.ts";

interface GenerateBody {
  template_id?: string;
  situation?: string;
  profile?: ProfileData;
  extracted_text?: string;
  conversation_context?: string;
  upload_context?: string;
  upload_id?: string;
  domain?: string;
  structure_type?: "compose" | "structured_form" | "checklist";
  advice_boundary?: "none" | "light" | "high-stakes";
  sections?: Array<{
    key?: string;
    label?: string;
    required?: boolean;
    hint?: string;
    vital?: string[];
    improver?: string[];
  }>;
  clari?: Record<string, unknown>;
  /** Set by the client when no catalogue template matched: TED designs a
   * situation-specific structure instead of using the generic scaffold. */
  design_bespoke?: boolean;
  document_name?: string;
  /** Client-generated ID, stable across retries of the same generation.
   * Makes the credit charge idempotent. */
  generation_request_id?: string;
}

function normaliseKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_|_$/g,
    "",
  ) || "section";
}

function safeStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, maxItemLength).trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : undefined;
}

function requestSections(body: GenerateBody): TemplateSection[] {
  if (!Array.isArray(body.sections)) return [];
  const sections: TemplateSection[] = [];

  for (const raw of body.sections) {
    const label = String(raw.label ?? "").slice(0, 120).trim();
    if (!label) continue;

    const hint = typeof raw.hint === "string"
      ? raw.hint.slice(0, 300).trim()
      : "";
    const vital = safeStringArray(raw.vital, 16, 200);
    const improver = safeStringArray(raw.improver, 16, 200);
    const section: TemplateSection = {
      key: String(raw.key ?? normaliseKey(label)).slice(0, 80).trim() ||
        normaliseKey(label),
      label,
      required: raw.required !== false,
    };
    if (hint) section.hint = hint;
    if (vital) section.vital = vital;
    if (improver) section.improver = improver;
    sections.push(section);
    if (sections.length >= 20) break;
  }

  return sections;
}

function safeDomain(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function safeStructureType(
  value: unknown,
  fallback: "compose" | "structured_form" | "checklist",
): "compose" | "structured_form" | "checklist" {
  return value === "compose" || value === "structured_form" ||
      value === "checklist"
    ? value
    : fallback;
}

function safeAdviceBoundary(
  value: unknown,
  fallback: "none" | "light" | "high-stakes",
): "none" | "light" | "high-stakes" {
  return value === "none" || value === "light" || value === "high-stakes"
    ? value
    : fallback;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  let auth;
  try {
    auth = await guardRequest(req);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  let body: GenerateBody;
  try {
    body = auth.body as unknown as GenerateBody;
  } catch {
    return jsonResponse(
      { error: { message: "Invalid JSON body" } },
      400,
      origin,
    );
  }

  const templateId = String(body.template_id ?? "").trim();
  if (!templateId) {
    return jsonResponse(
      { error: { message: "template_id is required" } },
      400,
      origin,
    );
  }

  const requestedSections = requestSections(body);
  const resolvedTemplate = resolveTemplate(templateId);
  const canonicalTemplate = {
    ...resolvedTemplate,
    domain: safeDomain(body.domain, resolvedTemplate.domain),
    structureType: safeStructureType(
      body.structure_type,
      resolvedTemplate.structureType,
    ),
    adviceBoundary: safeAdviceBoundary(
      body.advice_boundary,
      resolvedTemplate.adviceBoundary,
    ),
  };
  const template = applyPreFill(
    requestedSections.length > 0
      ? { ...canonicalTemplate, sections: requestedSections }
      : canonicalTemplate,
    body.profile ?? {},
  );

  const situation = String(body.situation ?? "").slice(0, 20000).trim();
  const extractedText = String(body.extracted_text ?? "").slice(0, 20000)
    .trim();
  const conversationContext = String(body.conversation_context ?? "").slice(
    0,
    30000,
  ).trim();
  const inlineUploadContext = String(body.upload_context ?? "").slice(0, 30000)
    .trim();
  const uploadId = String(body.upload_id ?? "").slice(0, 80).trim();
  const uploadContext = await resolveRetainedUploadContext(
    auth.admin,
    auth.userId,
    uploadId,
    inlineUploadContext,
  );
  const memoryContext = await loadUserMemoryContext(auth.admin, auth.userId);

  // Bespoke path: no catalogue template matched, so design a structure
  // specific to this situation. The designed sections carry vital/improver
  // criteria and run through the exact same pipeline as catalogue templates.
  let designedTemplate: Awaited<ReturnType<typeof designBespokeTemplate>> =
    null;
  if (body.design_bespoke === true) {
    designedTemplate = await designBespokeTemplate({
      documentName:
        String(body.document_name ?? templateId).slice(0, 160).trim() ||
        "Document",
      situation,
      conversationContext,
      uploadContext,
      systemPrompt: buildSystemPrompt({
        task: "intent",
        domain: "general" as never,
        clari: body.clari as never,
        adviceBoundary: "light",
        profileHint: situation,
        extra: "",
      }),
      signal: req.signal,
    });
  }

  // profileHint and extra deliberately carry template/identity-level context
  // only (name, domain, section list, situation, persisted memory) -- not the
  // full conversation/upload/extracted-text blobs. Those go to interpretIntent
  // and planSections in document-pipeline.ts, which need the complete picture
  // once each; baking the same multi-thousand-character blobs into the system
  // prompt as well meant every section-write call carried duplicate copies of
  // the same source material for no benefit. planSections() now sorts that
  // material into a per-section map that writeSection() uses instead.
  const profileHint = [
    template.name,
    templateId,
    template.domain,
    template.sections.map((section) =>
      [section.label, section.hint].filter(Boolean).join(": ")
    ).join(" | "),
    situation,
  ].filter(Boolean).join("\n\n").slice(0, 40000);

  const systemPrompt = buildSystemPrompt({
    task: "document",
    domain: template.domain as never,
    clari: body.clari as never,
    adviceBoundary: template.adviceBoundary,
    profileHint,
    extra: [
      sectionListInstruction(template),
      memoryContext,
    ].filter(Boolean).join("\n\n"),
  });

  // NOTE: the document credit is charged AFTER the pipeline succeeds (see the
  // stream success path below). Charging up-front meant failed generations —
  // including instant 402/500 loops — still consumed a monthly credit.
  const generationStartedAt = Date.now();

  // Fire-and-forget observability row. Never blocks or fails the stream.
  const logGeneration = (fields: {
    sectionCount: number;
    missingSections: number;
    missingItems: number;
    status: "ok" | "error";
    errorMessage?: string;
  }) => {
    auth.admin
      .from("generation_logs")
      .insert({
        user_id: auth.userId,
        template_id: templateId,
        bespoke: Boolean(designedTemplate),
        section_count: fields.sectionCount,
        missing_sections: fields.missingSections,
        missing_items: fields.missingItems,
        duration_ms: Date.now() - generationStartedAt,
        status: fields.status,
        error_message: fields.errorMessage?.slice(0, 500) ?? null,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.error("generation_logs insert failed:", error.message);
        }
      });
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const effectiveTemplate = designedTemplate
          ? applyPreFill(designedTemplate, body.profile ?? {})
          : template;

        if (designedTemplate) {
          controller.enqueue(sseEvent({
            type: "document_design",
            name: effectiveTemplate.name,
            sections: effectiveTemplate.sections.map((section) => ({
              key: section.key,
              label: section.label,
              required: section.required,
            })),
          }));
        }

        const effectiveSystemPrompt = designedTemplate
          ? buildSystemPrompt({
            task: "document",
            domain: effectiveTemplate.domain as never,
            clari: body.clari as never,
            adviceBoundary: effectiveTemplate.adviceBoundary,
            profileHint: [
              effectiveTemplate.name,
              effectiveTemplate.domain,
              effectiveTemplate.sections.map((section) =>
                [section.label, section.hint].filter(Boolean).join(": ")
              ).join(" | "),
              situation,
            ].filter(Boolean).join("\n\n").slice(0, 40000),
            extra: [sectionListInstruction(effectiveTemplate), memoryContext]
              .filter(Boolean).join("\n\n"),
          })
          : systemPrompt;

        // runDocumentPipeline is one monolithic await across several
        // sequential model calls (intent brief, planner, per-section
        // writes, quality-gate review, factual audit) with nothing
        // streamed to the client until it fully resolves. On templates
        // with several sections that routinely exceeds Supabase's ~150s
        // idle-connection timeout, which closes the connection with a 504
        // before the pipeline ever gets to emit anything -- independent of
        // the function's own wall-clock budget. A periodic heartbeat keeps
        // bytes flowing so the platform never sees the connection go idle.
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(sseHeartbeat());
          } catch {
            // Stream already closed; the interval is cleared right after
            // this in the finally below on the next tick regardless.
          }
        }, 20_000);

        let pipelineResult: Awaited<ReturnType<typeof runDocumentPipeline>>;
        try {
          pipelineResult = await runDocumentPipeline({
            template: effectiveTemplate,
            situation,
            conversationContext,
            uploadContext,
            extractedText,
            memoryContext,
            systemPrompt: effectiveSystemPrompt,
            signal: req.signal,
            onDraftSection: (section) => {
              controller.enqueue(sseEvent({
                type: "draft_section",
                key: section.key,
                label: section.label,
                content: section.content,
              }));
            },
          });
        } finally {
          clearInterval(heartbeat);
        }
        const {
          sections: reviewedSections,
          missingInfo,
          unresolvedPlaceholders,
        } = pipelineResult;

        assertDeliverableSections(reviewedSections);

        for (const section of reviewedSections) {
          controller.enqueue(sseEvent({
            type: "section",
            key: section.key,
            label: section.label,
            content: section.content,
          }));
        }

        if (unresolvedPlaceholders.length > 0) {
          controller.enqueue(sseEvent({
            type: "unresolved_placeholders",
            placeholders: unresolvedPlaceholders,
          }));
        }

        if (missingInfo.length > 0) {
          controller.enqueue(sseEvent({
            type: "missing_info",
            sections: missingInfo,
          }));
        }

        const finalBoundary = designedTemplate
          ? designedTemplate.adviceBoundary
          : template.adviceBoundary;
        if (finalBoundary !== "none") {
          controller.enqueue(sseEvent({
            type: "advice_boundary",
            level: finalBoundary,
          }));
        }

        controller.enqueue(sseDone());

        // Charge the document credit only after the pipeline has produced
        // sections successfully - failed generations must not burn credits.
        if (auth.userId !== "anonymous" && reviewedSections.length > 0) {
          const generationRequestId =
            typeof body.generation_request_id === "string" &&
              body.generation_request_id.trim()
              ? body.generation_request_id.trim().slice(0, 64)
              : undefined;
          trackDocumentCreated(auth.admin, {
            userId: auth.userId,
            task: "document",
            provider: "gateway",
            inputTokens: 0,
            outputTokens: 0,
            generationRequestId,
          });
        }

        logGeneration({
          sectionCount: reviewedSections.length,
          missingSections: new Set(unresolvedPlaceholders.map((item) =>
            item.sectionKey
          )).size,
          missingItems: unresolvedPlaceholders.length,
          status: "ok",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        controller.enqueue(sseEvent({
          type: "error",
          ...USER_SAFE_ERROR,
          detail_code: /abort/i.test(message) ? "aborted" : "failed",
        }));
        logGeneration({
          sectionCount: 0,
          missingSections: 0,
          missingItems: 0,
          status: "error",
          errorMessage: message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders(origin), ...SSE_HEADERS },
  });
});
