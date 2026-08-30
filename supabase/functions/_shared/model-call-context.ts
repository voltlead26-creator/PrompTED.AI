import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { trackModelCall } from "./cost-tracker.ts";

export interface ModelCallContext {
  userId: string;
  admin: SupabaseClient;
  generationRequestId?: string;
  nextCall: number;
}

const contexts = new WeakMap<AbortSignal, ModelCallContext>();

export function bindModelCallContext(
  signal: AbortSignal,
  context: Omit<ModelCallContext, "nextCall"> | ModelCallContext,
): void {
  contexts.set(signal, "nextCall" in context ? context : { ...context, nextCall: 0 });
}

export function inheritModelCallContext(parent: AbortSignal, child: AbortSignal): void {
  const context = contexts.get(parent);
  if (context) contexts.set(child, context);
}

export async function meterSuccessfulModelCall(
  signal: AbortSignal | undefined,
  usage: {
    task: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  if (!signal) return;
  const context = contexts.get(signal);
  if (!context) return;
  context.nextCall += 1;
  await trackModelCall(context.admin, {
    userId: context.userId,
    generationRequestId: context.generationRequestId,
    callKey: `${usage.task}-${context.nextCall}`,
    ...usage,
  });
}
