import { configureApiClient } from "@prompted/shared/api-client";
import { captureOwnerAccessToken } from "@/lib/supabase/owner-client";

let configured = false;

/**
 * Configure the shared API client once. Uses the fixed same-origin `/api/*`
 * gateway. The gateway validates the selected environment, derives allowed
 * Edge Functions from the deployment contract, and supplies no provider
 * credentials. Authenticated calls still carry the current Supabase session.
 */
export function ensureApiConfigured(): void {
  if (configured || typeof window === "undefined") return;
  configureApiClient({
    baseUrl: "/api",
    getToken: captureOwnerAccessToken,
  });
  configured = true;
}
