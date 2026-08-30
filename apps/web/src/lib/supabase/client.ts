import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "./public-config";

export function createClient() {
  const config = getPublicSupabaseConfig();
  return createBrowserClient(config.url, config.anonKey);
}
