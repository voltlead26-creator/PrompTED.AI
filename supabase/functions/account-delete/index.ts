import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  type AccountDeletionGateway,
  type AccountDeletionProgress,
  deleteAccountData,
  type StorageBucket,
} from "./deletion.ts";
import type { StorageEntry, StorageListOptions } from "./assets.ts";

function deletionNotStarted(): AccountDeletionProgress {
  return {
    state: "not_started",
    account_deleted: false,
    storage_objects_removed: 0,
    removal_extent_uncertain: false,
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Access-Control-Allow-Methods": "DELETE, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

function requestFailure(
  status: number,
  code: string,
  error: string,
  origin: string | null,
  correlationId: string,
): Response {
  return jsonResponse(
    {
      error,
      code,
      retryable: status >= 500,
      deletion: deletionNotStarted(),
      correlation_id: correlationId,
    },
    status,
    origin,
  );
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        "Access-Control-Allow-Methods": "DELETE, OPTIONS",
      },
    });
  }

  const correlationId = crypto.randomUUID();

  if (req.method !== "DELETE") {
    return requestFailure(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed.",
      origin,
      correlationId,
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return requestFailure(
      401,
      "UNAUTHORISED",
      "Sign in before deleting your account.",
      origin,
      correlationId,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return requestFailure(
      500,
      "DELETION_SERVICE_UNAVAILABLE",
      "Account deletion is temporarily unavailable.",
      origin,
      correlationId,
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization: authHeader } },
  });

  let userId: string;
  try {
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) {
      return requestFailure(
        401,
        "UNAUTHORISED",
        "Your session is no longer valid. Sign in and try again.",
        origin,
        correlationId,
      );
    }
    userId = user.id;
  } catch {
    return requestFailure(
      500,
      "AUTH_VERIFICATION_FAILED",
      "Your account identity could not be verified for deletion.",
      origin,
      correlationId,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gateway: AccountDeletionGateway = {
    async beginDeletionFence(authenticatedUserId) {
      const { data, error } = await adminClient.rpc(
        "begin_account_deletion_fence",
        { p_user_id: authenticatedUserId },
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as {
          outcome: "ready" | "blocked";
          active_uploads?: number;
          active_storage_dispatches?: number;
          retry_after_seconds?: number;
        }
        : null;
      return { data: receipt, error };
    },
    async loadOwnedBusinesses(authenticatedUserId) {
      const { data, error } = await adminClient
        .from("businesses")
        .select("id")
        .eq("owner_user_id", authenticatedUserId);
      return { data, error };
    },
    async loadOtherMemberships(businessIds, authenticatedUserId) {
      const { data, error } = await adminClient
        .from("memberships")
        .select("business_id, user_id")
        .in("business_id", businessIds)
        .neq("user_id", authenticatedUserId)
        .limit(1);
      return { data, error };
    },
    async listStorage(
      bucket: StorageBucket,
      prefix: string,
      options: StorageListOptions,
    ) {
      const { data, error } = await adminClient.storage.from(bucket).list(
        prefix,
        options,
      );
      const entries = data === null
        ? null
        : (data as unknown as Array<Record<string, unknown>>).map((
          entry,
        ): StorageEntry => ({
          id: entry.id === null
            ? null
            : typeof entry.id === "string"
            ? entry.id
            : "",
          name: typeof entry.name === "string" ? entry.name : "",
        }));
      return { data: entries, error };
    },
    async removeStorage(bucket, paths) {
      const { error } = await adminClient.storage.from(bucket).remove(paths);
      return { error };
    },
    async insertDeletionAuditIdempotently(record) {
      const { error } = await adminClient
        .from("audit_logs")
        .insert(record);
      // The deterministic primary key makes a previous successful request
      // safe to retry without granting UPDATE on the append-only audit log.
      return { error: error?.code === "23505" ? null : error };
    },
    async deleteAuthUser(authenticatedUserId) {
      const { error } = await adminClient.auth.admin.deleteUser(
        authenticatedUserId,
      );
      return { error };
    },
  };

  const result = await deleteAccountData(userId, gateway);
  const { status, ...body } = result;
  return jsonResponse(
    { ...body, correlation_id: correlationId },
    status,
    origin,
  );
});
