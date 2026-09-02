"use client";

import {
  createClient as createSupabaseDataClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  OwnerDispatchError,
  type OwnerDispatchLease,
  withOwnerDispatchSignal,
} from "@/lib/browser-principal-state";
import { createClient as createSessionClient } from "./client";
import { getPublicSupabaseConfig } from "./public-config";

export type OwnerDataClient = Pick<SupabaseClient, "from" | "rpc" | "storage">;

const MIN_TOKEN_LIFETIME_MS = 5_000;

function jwtSubject(accessToken: string): string {
  try {
    const encoded = accessToken.split(".")[1];
    if (!encoded) throw new Error("JWT_PAYLOAD_MISSING");
    const base64 = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { sub?: unknown };
    const subject = typeof payload.sub === "string" ? payload.sub.trim().toLowerCase() : "";
    if (!subject) throw new Error("JWT_SUBJECT_INVALID");
    return subject;
  } catch {
    throw new OwnerDispatchError();
  }
}

/**
 * Captures a usable bearer for exactly one owner epoch. This path deliberately
 * never refreshes the persistent Auth singleton: an A refresh racing a B
 * sign-in can mutate global Auth even when A's lease is rejected afterwards.
 * Supabase Auth owns background refresh; a token inside the final safety
 * window fails closed and the caller can retry after the provider publishes
 * the refreshed same-owner session.
 */
export async function captureOwnerAccessToken(lease: OwnerDispatchLease): Promise<string> {
  lease.assertCurrent();
  const sessionClient = createSessionClient();
  const { data, error } = await sessionClient.auth.getSession();
  lease.assertCurrent();

  const session = data.session;
  if (
    error ||
    !session ||
    session.user.id.trim().toLowerCase() !== lease.expectedUserId
  ) {
    throw new OwnerDispatchError();
  }

  if (
    !session.expires_at ||
    session.expires_at * 1_000 <= Date.now() + MIN_TOKEN_LIFETIME_MS
  ) {
    throw new OwnerDispatchError();
  }

  lease.assertCurrent();
  if (jwtSubject(session.access_token) !== lease.expectedUserId) {
    throw new OwnerDispatchError();
  }
  return session.access_token;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestSignal(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  lease: OwnerDispatchLease,
): AbortSignal {
  const existing =
    init?.signal ??
    (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
  if (!existing || existing === lease.signal) return lease.signal;
  return withOwnerDispatchSignal(lease, existing).signal;
}

function createOwnerBoundDataClient(
  lease: OwnerDispatchLease,
  accessToken: string,
): OwnerDataClient {
  lease.assertCurrent();
  if (jwtSubject(accessToken) !== lease.expectedUserId) throw new OwnerDispatchError();

  const config = getPublicSupabaseConfig();
  const allowedOrigin = new URL(config.url).origin;
  const authorization = `Bearer ${accessToken}`;

  const ownerFetch: typeof fetch = async (input, init) => {
    lease.assertCurrent();
    const target = new URL(requestUrl(input), config.url);
    if (target.origin !== allowedOrigin) {
      throw new Error("OWNER_SUPABASE_ORIGIN_MISMATCH");
    }

    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== authorization) {
      throw new Error("OWNER_SUPABASE_AUTHORIZATION_MISMATCH");
    }

    const response = await globalThis.fetch(input, {
      ...init,
      headers,
      signal: requestSignal(input, init, lease),
    });
    lease.assertCurrent();
    return response;
  };

  return createSupabaseDataClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    accessToken: async () => {
      lease.assertCurrent();
      return accessToken;
    },
    global: {
      headers: { Authorization: authorization },
      fetch: ownerFetch,
    },
  });
}

/** Runs one bounded data operation without ever rereading mutable global Auth. */
export async function withOwnerSupabase<T>(
  lease: OwnerDispatchLease,
  operation: (client: OwnerDataClient) => Promise<T>,
): Promise<T> {
  lease.assertCurrent();
  const accessToken = await captureOwnerAccessToken(lease);
  lease.assertCurrent();
  const client = createOwnerBoundDataClient(lease, accessToken);
  const result = await operation(client);
  lease.assertCurrent();
  return result;
}
