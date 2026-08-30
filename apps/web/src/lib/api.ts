import { configureApiClient } from "@prompted/shared/api-client";
import { createClient } from "@/lib/supabase/client";

let configured = false;

/**
 * Configure the shared API client once. Uses the same-origin `/api/*` gateway
 * by default. The gateway validates the selected environment, derives allowed
 * Edge Functions from the deployment contract, and supplies no provider
 * credentials. Authenticated calls still carry the current Supabase session.
 */
export function ensureApiConfigured(): void {
  if (configured) return;
  const supabase = createClient();
  configureApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api",
    getToken: async () => {
      // getSession() reads the locally cached session without a network
      // round trip. In a backgrounded tab, the SDK's own timer-based
      // auto-refresh can stall, so we still explicitly refresh when the
      // token is at or near expiry (30s buffer) before handing it out.
      //
      // The previous implementation instead called auth.getUser() first — a
      // *live* network round trip to Supabase Auth — on every single
      // authenticated request, purely to detect this same staleness. That
      // extra call raced against the SDK's own background auto-refresh
      // timer, and on collision could invalidate the session's single-use,
      // rotating refresh token out from under an in-flight request — most
      // visibly on the slowest calls (large file uploads), which had the
      // widest window to lose the race and get sent with an already-dead
      // token. Checking expires_at locally gets the same staleness recovery
      // without the redundant round trip or the race.
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) return null;

      const expiresSoon = !session.expires_at || session.expires_at * 1000 <= Date.now() + 30_000;
      if (!expiresSoon) return session.access_token;

      const { data: refreshed, error } = await supabase.auth.refreshSession();
      return error ? null : (refreshed.session?.access_token ?? session.access_token);
    },
  });
  configured = true;
}
