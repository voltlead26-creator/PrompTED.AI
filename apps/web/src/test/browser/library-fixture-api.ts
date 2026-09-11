// Local browser fixture only: real Supabase query/RPC encoding against a
// synthetic HTTP server. Auth and durable storage are not acceptance claims.
import { createClient } from "@supabase/supabase-js";
import type { OwnerDataClient } from "@/lib/supabase/owner-client";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";

export const fixtureOwner = "33333333-3333-4333-8333-333333333333";
export function useAuth() {
  return { user: { id: fixtureOwner }, loading: false };
}
export async function withOwnerSupabase<T>(
  lease: OwnerDispatchLease,
  operation: (client: OwnerDataClient) => Promise<T>,
): Promise<T> {
  lease.assertCurrent();
  const client = createClient(location.origin, "synthetic-local-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: lease.signal }) },
  });
  const result = await operation(client);
  lease.assertCurrent();
  return result;
}
