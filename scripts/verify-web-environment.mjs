const PUBLIC_BINDING_KEYS = Object.freeze([
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);

const SYNTHETIC_VERIFICATION_BINDING = Object.freeze({
  NEXT_PUBLIC_APP_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_testfixture00000000000000000000",
  NEXT_PUBLIC_REVENUECAT_WEB_KEY: "test_revenuecat_key",
});

function hasValue(environment, key) {
  return typeof environment[key] === "string" && environment[key].trim().length > 0;
}

/**
 * Give the repository's non-mutating release gate a deterministic test-only
 * browser binding when the caller supplied no deployment identity at all.
 * Any partial or explicit binding passes through unchanged so the application's
 * normal fail-closed validation can reject it instead of mixing environments.
 */
export function resolveVerificationEnvironment(environment = {}) {
  const resolved = { ...environment };
  if (PUBLIC_BINDING_KEYS.some((key) => hasValue(environment, key))) {
    return resolved;
  }
  return { ...resolved, ...SYNTHETIC_VERIFICATION_BINDING };
}
