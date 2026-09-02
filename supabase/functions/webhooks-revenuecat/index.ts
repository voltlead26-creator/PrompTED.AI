// =====================================================
// RevenueCat Webhook Handler
// Auth: constant-time shared Bearer secret verification (not JWT).
// Persistence: one service-only transactional RPC.
// =====================================================
// Env vars required:
//   REVENUECAT_WEBHOOK_SECRET — shared secret from RevenueCat dashboard
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — protected RPC caller
// =====================================================

// deno-lint-ignore no-import-prefix -- Supabase Edge runtime pins this ESM boundary.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handleRevenueCatWebhook,
  type RevenueCatPersistence,
} from "./handler.ts";

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = url && serviceRoleKey
    ? createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;
  const persistence: RevenueCatPersistence = {
    async applyEvent(event) {
      if (!supabase) {
        return { data: null, error: { code: "PERSISTENCE_UNAVAILABLE" } };
      }
      return await supabase.rpc("apply_revenuecat_webhook_event", {
        p_event: event,
      });
    },
  };

  return await handleRevenueCatWebhook(req, {
    secret: Deno.env.get("REVENUECAT_WEBHOOK_SECRET"),
    persistence,
  });
});
