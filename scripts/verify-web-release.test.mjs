import assert from "node:assert/strict";
import test from "node:test";
import { resolveVerificationEnvironment } from "./verify-web-environment.mjs";

test("an unconfigured local release gate receives one synthetic non-production binding", () => {
  const resolved = resolveVerificationEnvironment({ PATH: "/usr/bin" });

  assert.deepEqual(
    {
      appEnvironment: resolved.NEXT_PUBLIC_APP_ENV,
      supabaseUrl: resolved.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      revenueCatKey: resolved.NEXT_PUBLIC_REVENUECAT_WEB_KEY,
    },
    {
      appEnvironment: "test",
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-anon-key-for-build-only",
      revenueCatKey: "test_revenuecat_key",
    },
  );
  assert.equal(resolved.PATH, "/usr/bin");
});

test("a complete explicit production binding is preserved exactly", () => {
  const environment = {
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://jjsykocqpjlekgsbylkd.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "explicit-public-key",
    NEXT_PUBLIC_REVENUECAT_WEB_KEY: "explicit-revenuecat-key",
  };

  assert.deepEqual(resolveVerificationEnvironment(environment), environment);
});

test("a partial deployment binding is not completed with synthetic values", () => {
  const resolved = resolveVerificationEnvironment({
    NEXT_PUBLIC_APP_ENV: "preview",
  });

  assert.equal(resolved.NEXT_PUBLIC_APP_ENV, "preview");
  assert.equal(resolved.NEXT_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY, undefined);
  assert.equal(resolved.NEXT_PUBLIC_REVENUECAT_WEB_KEY, undefined);
});

test("resolving the verification environment never mutates the caller", () => {
  const environment = {
    NEXT_PUBLIC_APP_ENV: " ",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  };
  const before = { ...environment };

  const resolved = resolveVerificationEnvironment(environment);

  assert.deepEqual(environment, before);
  assert.notEqual(resolved, environment);
  assert.equal(resolved.NEXT_PUBLIC_APP_ENV, "test");
});
