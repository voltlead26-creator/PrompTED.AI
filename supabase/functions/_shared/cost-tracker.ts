// =====================================================
// PrompTED — Cost Tracker
// Logs AI token usage per call for cost monitoring.
// IMPORTANT: Never log prompt content, system prompts,
// or any generated document text in this module.
// =====================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

export interface UsageRecord {
  userId: string;
  businessId?: string;
  task: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  /** Client-generated ID reused across retries of the same intended
   * generation. When present, the credit charge is idempotent: the
   * usage_ledger row is inserted with ON CONFLICT DO NOTHING against a
   * unique index on (user_id, generation_request_id, event_type). */
  generationRequestId?: string;
}

export interface ModelCallRecord extends UsageRecord {
  /** Deterministic identifier for one logical model call within a request. */
  callKey: string;
}

/**
 * Insert a usage_ledger row for a document_created event and log token usage
 * for cost monitoring. Fire-and-forget — must never block the response.
 */
export async function trackDocumentCreated(
  admin: SupabaseClient,
  record: UsageRecord,
): Promise<boolean> {
  try {
    const row = {
      user_id: record.userId,
      business_id: record.businessId ?? null,
      event_type: "document_created",
      created_at: new Date().toISOString(),
    };

    if (record.generationRequestId) {
      // Atomic, idempotent charge: one INSERT ... ON CONFLICT DO NOTHING.
      // A retry with the same generationRequestId inserts no second row.
      const { data, error } = await admin
        .from("usage_ledger")
        .upsert(
          { ...row, generation_request_id: record.generationRequestId },
          {
            onConflict: "user_id,generation_request_id,event_type",
            ignoreDuplicates: true,
          },
        )
        .select("user_id");
      if (error) throw error;
      const charged = (data?.length ?? 0) > 0;
      if (charged) logTokenUsage(record);
      return charged;
    }

    const { error } = await admin.from("usage_ledger").insert(row);
    if (error) throw error;
    logTokenUsage(record);
    return true;
  } catch (err) {
    // Cost tracking must never break a generation request.
    // Log only the error type — never log any content.
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err));
    console.error(`cost-tracker: insert failed: ${message}`);
    return false;
  }
}

/**
 * Insert a usage_ledger row for an ai_edit event and log token usage.
 */
export async function trackAiEdit(
  admin: SupabaseClient,
  record: UsageRecord,
): Promise<void> {
  try {
    await admin.from("usage_ledger").insert({
      user_id: record.userId,
      business_id: record.businessId ?? null,
      event_type: "ai_edit",
      created_at: new Date().toISOString(),
    });
    logTokenUsage(record);
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err));
    console.error(`cost-tracker: ai_edit insert failed: ${message}`);
  }
}

/**
 * Record one successful model call without consuming a document allowance.
 * Failed/cancelled calls never invoke this function. When a generation request
 * id is present, append the deterministic call key and reuse the ledger's
 * existing request-id uniqueness contract.
 */
export async function trackModelCall(
  admin: SupabaseClient,
  record: ModelCallRecord,
): Promise<boolean> {
  try {
    const generationRequestId = record.generationRequestId
      ? `${record.generationRequestId}:${record.callKey}`
      : undefined;
    const row = {
      user_id: record.userId,
      business_id: record.businessId ?? null,
      event_type: "model_call",
      generation_request_id: generationRequestId ?? null,
      task: record.task,
      provider: record.provider,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      created_at: new Date().toISOString(),
    };

    if (generationRequestId) {
      const { data, error } = await admin
        .from("usage_ledger")
        .upsert(row, {
          onConflict: "user_id,generation_request_id,event_type",
          ignoreDuplicates: true,
        })
        .select("user_id");
      if (error) throw error;
      const recorded = (data?.length ?? 0) > 0;
      if (recorded) logTokenUsage(record);
      return recorded;
    }

    const { error } = await admin.from("usage_ledger").insert(row);
    if (error) throw error;
    logTokenUsage(record);
    return true;
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err));
    console.error(`cost-tracker: model_call insert failed: ${message}`);
    return false;
  }
}

/**
 * Log token counts as structured JSON so Supabase log aggregation and
 * external cost-monitoring tools can parse them. Never logs content.
 */
function logTokenUsage(record: UsageRecord): void {
  console.log(
    JSON.stringify({
      event: "token_usage",
      task: record.task,
      provider: record.provider,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      total_tokens: record.inputTokens + record.outputTokens,
      ts: new Date().toISOString(),
    }),
  );
}
