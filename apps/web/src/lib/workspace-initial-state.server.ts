import type {
  DocumentPlaceholderMetadata,
  RecommendationPayload,
  Section,
} from "@prompted/shared/browser";
import {
  DURABLE_GENERATION_OPERATION_STATES,
  type DurableGenerationOperationState,
} from "@prompted/shared/document-operation";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceInitialState } from "./workspace-initial-state";

const EMPTY_TRUTH: WorkspaceInitialState["truth"] = {
  authenticated: false,
  persistence: "anonymous",
  documentId: null,
  currentRevision: null,
  approvedRevision: null,
  ledgerBindingStatus: null,
  ledgerVersion: null,
  operationId: null,
  operationRevision: null,
  operationStatus: null,
  operationMessage: null,
  safeNextAction: null,
  persistedAt: null,
};

interface OutcomeRow {
  situation_text: string;
  recommendation_payload: RecommendationPayload | null;
}

interface DocumentRow {
  id: string;
  title: string;
  status: string;
  template_id: string | null;
  unresolved_placeholders: DocumentPlaceholderMetadata[] | null;
  ledger_binding_status: "legacy_unversioned" | "captured";
  ledger_template_id: string | null;
  ledger_version: string | null;
  current_revision: number;
  approved_revision: number | null;
  updated_at: string;
}

interface SectionRow extends Section {
  section_key?: string | null;
  revision?: number;
  section_state?: string | null;
}

interface OperationRow {
  operation_id: string;
  operation_revision: number;
  status: DurableGenerationOperationState;
  message?: string | null;
  safe_next_action?: string | null;
}

function unavailable(authenticated: boolean): WorkspaceInitialState {
  return {
    workspace: null,
    truth: {
      ...EMPTY_TRUTH,
      authenticated,
      persistence: "unavailable",
    },
  };
}

/**
 * Reads only the small, user-scoped state required to render a trustworthy
 * first frame. RLS remains the authority; failure falls back to the existing
 * reconnect path instead of exposing database details in the route.
 */
export async function loadWorkspaceInitialState(
  outcomeId: string,
): Promise<WorkspaceInitialState> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError) return unavailable(false);
  if (!auth.user) return { workspace: null, truth: EMPTY_TRUTH };

  const [outcomeResult, documentResult] = await Promise.all([
    supabase
      .from("outcomes")
      .select("situation_text,recommendation_payload")
      .eq("id", outcomeId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    supabase
      .from("documents")
      .select(
        "id,title,status,template_id,unresolved_placeholders,ledger_binding_status,ledger_template_id,ledger_version,current_revision,approved_revision,updated_at",
      )
      .eq("outcome_id", outcomeId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
  ]);

  if (outcomeResult.error || documentResult.error) return unavailable(true);

  const document = documentResult.data as DocumentRow | null;
  if (!document) {
    return {
      workspace: null,
      truth: {
        ...EMPTY_TRUTH,
        authenticated: true,
        persistence: "not_found",
      },
    };
  }

  const sectionsResult = await supabase
    .from("sections")
    .select(
      "id,document_id,user_id,name,order_index,content,status,is_required,created_at,updated_at,section_key,revision,section_state",
    )
    .eq("document_id", document.id)
    .eq("user_id", auth.user.id)
    .order("order_index", { ascending: true });

  if (sectionsResult.error) return unavailable(true);

  let operation: OperationRow | null = null;
  if (document.ledger_binding_status === "captured") {
    const operationResult = await supabase.rpc(
      "get_latest_captured_document_operation",
      { p_document_id: document.id },
    );
    if (operationResult.error) return unavailable(true);
    const candidate = operationResult.data as Partial<OperationRow> | null;
    if (
      candidate &&
      typeof candidate.operation_id === "string" &&
      typeof candidate.operation_revision === "number" &&
      typeof candidate.status === "string" &&
      DURABLE_GENERATION_OPERATION_STATES.includes(
        candidate.status as DurableGenerationOperationState,
      )
    ) {
      operation = candidate as OperationRow;
    }
  }

  const outcome = outcomeResult.data as OutcomeRow | null;
  const payload = outcome?.recommendation_payload;
  const sections = ((sectionsResult.data ?? []) as SectionRow[]).map((section) => ({
    ...section,
    key: section.section_key ?? section.key,
    version_history: [],
  }));

  return {
    workspace: {
      documentId: document.id,
      title: document.title,
      situation: outcome?.situation_text ?? payload?.situation ?? "",
      status: document.status,
      sections,
      generated: sections.some((section) => section.content.trim().length > 0),
      templateId: document.ledger_template_id ?? document.template_id,
      conversationContext: payload?.conversation_context ?? "",
      uploadContext: payload?.upload_context ?? "",
      unresolvedPlaceholders: document.unresolved_placeholders ?? [],
    },
    truth: {
      authenticated: true,
      persistence: "persisted",
      documentId: document.id,
      currentRevision: document.current_revision,
      approvedRevision: document.approved_revision,
      ledgerBindingStatus: document.ledger_binding_status,
      ledgerVersion: document.ledger_version,
      operationId: operation?.operation_id ?? null,
      operationRevision: operation?.operation_revision ?? null,
      operationStatus: operation?.status ?? null,
      operationMessage: operation?.message ?? null,
      safeNextAction: operation?.safe_next_action ?? null,
      persistedAt: document.updated_at,
    },
  };
}
