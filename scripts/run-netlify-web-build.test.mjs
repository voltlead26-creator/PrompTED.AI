import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertSanitizedWebBuildEnvironment,
  buildPnpmWebBuildArgs,
  runNetlifyWebBuild,
  sanitizeWebBuildEnvironment,
} from "./run-netlify-web-build.mjs";

const SAFE_ENVIRONMENT = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: `sb_publishable_${"p".repeat(32)}`,
  NETLIFY_SITE_ID: "f278cbcf-0161-43f7-a132-fd224aef2d9f",
  SECRETS_SCAN_ENABLED: "true",
  SECRETS_SCAN_OMIT_PATHS: "",
  SECRETS_SCAN_OMIT_KEYS:
    "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_REVENUECAT_WEB_KEY,NEXT_PUBLIC_SENTRY_DSN,NEXT_PUBLIC_POSTHOG_KEY,NEXT_SUPABASE_PROJECT_ID,NEXT_SUPABASE_URL,NETLIFY_SITE_ID",
};

test("sanitized Netlify web build environment removes inherited confidential variables", () => {
  const secretValue = "must-never-be-forwarded";
  const { environment, strippedNames } = sanitizeWebBuildEnvironment({
    ...SAFE_ENVIRONMENT,
    APP_SPECIFIC_SHARED_SECRET: secretValue,
    GITHUB_FINE_GRAIN_TOKEN: secretValue,
    LEGACY_J: secretValue,
    NETLIFY_AUTH_TOKEN: secretValue,
    SUPABASE_DB_PASSWORD: secretValue,
    SUPABASE_SERVICE_ROLE_KEY: secretValue,
    SUPABASE_JWT_SECRET: secretValue,
    SUPABASE_DATABASE_URL: secretValue,
    SUPABASE_ANON_KEY: secretValue,
  });

  assert.deepEqual(strippedNames, [
    "APP_SPECIFIC_SHARED_SECRET",
    "GITHUB_FINE_GRAIN_TOKEN",
    "LEGACY_J",
    "NETLIFY_AUTH_TOKEN",
    "SUPABASE_ANON_KEY",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  for (const name of strippedNames) {
    assert.equal(environment[name], undefined, `${name} must not reach the web build`);
  }
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, SAFE_ENVIRONMENT.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SAFE_ENVIRONMENT.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  assert.doesNotThrow(() => assertSanitizedWebBuildEnvironment(environment));
});

test("Netlify web build wrapper spawns the normal package build with sanitized env", () => {
  const calls = [];
  const status = runNetlifyWebBuild({
    environment: {
      ...SAFE_ENVIRONMENT,
      GITHUB_FINE_GRAIN_TOKEN: "private-token",
      SUPABASE_SERVICE_ROLE_KEY: "private-service-role",
    },
    cwd: "/repo",
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "corepack");
  assert.deepEqual(calls[0].args, ["pnpm", "--filter", "@prompted/web", "build"]);
  assert.deepEqual(buildPnpmWebBuildArgs(), calls[0].args);
  assert.equal(calls[0].options.cwd, "/repo");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.GITHUB_FINE_GRAIN_TOKEN, undefined);
  assert.equal(calls[0].options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(calls[0].options.env.NEXT_PUBLIC_APP_ENV, "production");
});

test("Netlify web build wrapper propagates failed package build status", () => {
  const status = runNetlifyWebBuild({
    environment: SAFE_ENVIRONMENT,
    spawnImpl() {
      return { status: 2 };
    },
  });

  assert.equal(status, 2);
});
