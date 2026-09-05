import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS,
  assertWebBuildEnvironmentSafe,
  parseDotEnvVariableNames,
  validateWebBuildEnvironment,
} from "./check-web-build-environment.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
const SYNTHETIC_NETLIFY_SITE_ID = "11111111-2222-4333-8444-555555555555";
const NETLIFY_HOSTED_BUILD_ENVIRONMENT = {
  NETLIFY: "true",
  CI: "true",
  CONTEXT: "production",
  BUILD_ID: "a".repeat(24),
  DEPLOY_ID: "b".repeat(24),
  SITE_ID: SYNTHETIC_NETLIFY_SITE_ID,
};

function fakeSupabaseJwt({ role = "anon", projectRef = PUBLIC_SUPABASE_PROJECT_REF } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ref: projectRef, role })}.${"a".repeat(43)}`;
}

const PUBLIC_BUILD_ENVIRONMENT = {
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeSupabaseJwt(),
  NEXT_PUBLIC_REVENUECAT_WEB_KEY: "rcb_public_web_key",
  NEXT_PUBLIC_SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_public_project_key",
  SECRETS_SCAN_ENABLED: "true",
  SECRETS_SCAN_OMIT_KEYS: APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS.join(","),
};

test("Netlify scanning exempts only reviewed public identifiers found in source or bundles", () => {
  assert.deepEqual(APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_REVENUECAT_WEB_KEY",
    "NEXT_PUBLIC_SENTRY_DSN",
    "NEXT_PUBLIC_POSTHOG_KEY",
  ]);
});

test("web build environment allows intentional browser identifiers", () => {
  assert.deepEqual(
    validateWebBuildEnvironment({ environment: PUBLIC_BUILD_ENVIRONMENT, dotEnvSources: [] }),
    [],
  );
});

test("Netlify-hosted web builds reject obsolete Supabase aliases and custom site IDs", () => {
  const obsoleteProjectRef = "zyxwvutsrqponmlkjihg";
  const obsoleteUrl = `https://${obsoleteProjectRef}.supabase.co`;
  const obsoleteSiteId = SYNTHETIC_NETLIFY_SITE_ID;
  const failures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
      NEXT_SUPABASE_PROJECT_ID: obsoleteProjectRef,
      NEXT_SUPABASE_URL: obsoleteUrl,
      NETLIFY_SITE_ID: obsoleteSiteId,
    },
    dotEnvSources: [],
  });
  const message = failures.join("\n");

  assert.match(message, /NEXT_SUPABASE_PROJECT_ID/);
  assert.match(message, /NEXT_SUPABASE_URL/);
  assert.match(message, /NETLIFY_SITE_ID/);
  assert.equal(message.includes(obsoleteProjectRef), false);
  assert.equal(message.includes(obsoleteUrl), false);
  assert.equal(message.includes(obsoleteSiteId), false);
});

test("genuine Netlify-hosted builds rely on scanning for non-public parent secrets", () => {
  const confidentialValue = "hosted-secret-value-must-never-appear";
  assert.deepEqual(
    validateWebBuildEnvironment({
      environment: {
        ...PUBLIC_BUILD_ENVIRONMENT,
        ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
        OPENAI_API_KEY: confidentialValue,
        SUPABASE_SERVICE_ROLE_KEY: confidentialValue,
      },
      dotEnvSources: [],
    }),
    [],
  );

  const incompleteMarkerFailures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      NETLIFY: "true",
      CI: "true",
      CONTEXT: "production",
      OPENAI_API_KEY: confidentialValue,
    },
    dotEnvSources: [],
  }).join("\n");
  assert.match(incompleteMarkerFailures, /OPENAI_API_KEY/);
  assert.equal(incompleteMarkerFailures.includes(confidentialValue), false);

  const githubFailures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
      GITHUB_ACTIONS: "true",
      OPENAI_API_KEY: confidentialValue,
    },
    dotEnvSources: [],
  }).join("\n");
  assert.match(githubFailures, /OPENAI_API_KEY/);

  const unscannedHostedFailures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
      SECRETS_SCAN_ENABLED: "",
      OPENAI_API_KEY: confidentialValue,
    },
    dotEnvSources: [],
  }).join("\n");
  assert.match(unscannedHostedFailures, /SECRETS_SCAN_ENABLED/);
});

test("only attested Netlify-hosted builds tolerate the Netlify-owned skew-protection token", () => {
  const platformValue = "netlify-platform-value-must-never-appear";
  const customValue = "custom-secret-value-must-never-appear";

  assert.deepEqual(
    validateWebBuildEnvironment({
      environment: {
        ...PUBLIC_BUILD_ENVIRONMENT,
        ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
        NETLIFY_SKEW_PROTECTION_TOKEN: platformValue,
      },
      dotEnvSources: [],
    }),
    [],
  );

  assert.deepEqual(
    validateWebBuildEnvironment({
      environment: {
        ...PUBLIC_BUILD_ENVIRONMENT,
        ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
        NETLIFY_SKEW_PROTECTION_TOKEN: platformValue,
        OPENAI_API_KEY: customValue,
      },
      dotEnvSources: [],
    }),
    [],
  );

  const incompleteMarkerFailures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      NETLIFY: "true",
      NETLIFY_SKEW_PROTECTION_TOKEN: platformValue,
      OPENAI_API_KEY: customValue,
    },
    dotEnvSources: [],
  }).join("\n");
  assert.match(incompleteMarkerFailures, /NETLIFY_SKEW_PROTECTION_TOKEN/);
  assert.match(incompleteMarkerFailures, /OPENAI_API_KEY/);
  assert.equal(incompleteMarkerFailures.includes(platformValue), false);
  assert.equal(incompleteMarkerFailures.includes(customValue), false);

  const localFailures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      NETLIFY_SKEW_PROTECTION_TOKEN: platformValue,
    },
    dotEnvSources: [],
  }).join("\n");
  assert.match(localFailures, /NETLIFY_SKEW_PROTECTION_TOKEN/);
  assert.equal(localFailures.includes(platformValue), false);
});

test("the GitHub release handoff may carry a synthetic Netlify site ID outside hosted builds", () => {
  assert.deepEqual(
    validateWebBuildEnvironment({
      environment: {
        ...PUBLIC_BUILD_ENVIRONMENT,
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/heads/Thought-Enhanced-Document",
        NETLIFY: "true",
        NETLIFY_SITE_ID: SYNTHETIC_NETLIFY_SITE_ID,
      },
      dotEnvSources: [],
    }),
    [],
  );
});

test("the outer release preflight may accept a Netlify token but the web build itself cannot", () => {
  const environment = {
    ...PUBLIC_BUILD_ENVIRONMENT,
    NETLIFY_AUTH_TOKEN: "outer-cli-credential",
  };
  assert.match(
    validateWebBuildEnvironment({ environment, dotEnvSources: [] }).join("\n"),
    /NETLIFY_AUTH_TOKEN/,
  );
  assert.deepEqual(
    validateWebBuildEnvironment({
      environment,
      dotEnvSources: [],
      allowOuterNetlifyToken: true,
    }),
    [],
  );
});

test("web build environment rejects confidential server credentials without disclosing values", () => {
  const confidentialValue = "must-never-appear-in-an-error";
  const failures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      OPENAI_API_KEY: confidentialValue,
      SUPABASE_SERVICE_ROLE_KEY: confidentialValue,
      SUPABASE_DB_PASSWORD: confidentialValue,
      SUPABASE_ACCESS_TOKEN: confidentialValue,
      PTV_TIMETABLE_KEY: confidentialValue,
      AWS_SECRET_ACCESS_KEY: confidentialValue,
      PGPASSWORD: confidentialValue,
      REDIS_URL: confidentialValue,
    },
    dotEnvSources: [],
  });

  assert.match(failures.join("\n"), /OPENAI_API_KEY/);
  assert.match(failures.join("\n"), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(failures.join("\n"), /SUPABASE_DB_PASSWORD/);
  assert.match(failures.join("\n"), /SUPABASE_ACCESS_TOKEN/);
  assert.match(failures.join("\n"), /PTV_TIMETABLE_KEY/);
  assert.match(failures.join("\n"), /AWS_SECRET_ACCESS_KEY/);
  assert.match(failures.join("\n"), /PGPASSWORD/);
  assert.match(failures.join("\n"), /REDIS_URL/);
  assert.equal(failures.join("\n").includes(confidentialValue), false);
});

test("web build environment rejects public names that imply confidential data", () => {
  const failures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
      NEXT_PUBLIC_SUPABASE_DATABASE_URL: "not-inspected",
      NEXT_PUBLIC_INTERNAL_WEBHOOK_SECRET: "not-inspected",
    },
    dotEnvSources: [],
  });

  assert.match(failures.join("\n"), /NEXT_PUBLIC_SUPABASE_DATABASE_URL/);
  assert.match(failures.join("\n"), /NEXT_PUBLIC_INTERNAL_WEBHOOK_SECRET/);
});

test("reviewed public names reject secret-role keys and credential-bearing URLs", () => {
  const credentialPassword = "url-password-must-never-appear";
  const serviceRoleKey = fakeSupabaseJwt({ role: "service_role" });
  const failures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      NEXT_PUBLIC_SUPABASE_URL: `https://user:${credentialPassword}@${PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceRoleKey,
    },
    dotEnvSources: [],
  });
  const message = failures.join("\n");

  assert.match(message, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(message, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.equal(message.includes(credentialPassword), false);
  assert.equal(message.includes(serviceRoleKey), false);
});

test("web build environment rejects disabled or broadened Netlify secret scanning", () => {
  const untrustedOmitEntry = "must-never-appear-in-an-error";
  const failures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      SECRETS_SCAN_ENABLED: "invalid",
      SECRETS_SCAN_OMIT_PATHS: ".next/**,.netlify/**",
      SECRETS_SCAN_OMIT_KEYS:
        PUBLIC_BUILD_ENVIRONMENT.SECRETS_SCAN_OMIT_KEYS + "," + untrustedOmitEntry,
    },
    dotEnvSources: [],
  });
  const message = failures.join("\n");

  assert.match(message, /SECRETS_SCAN_ENABLED/);
  assert.match(message, /SECRETS_SCAN_OMIT_PATHS/);
  assert.match(message, /not reviewed public identifiers/);
  assert.equal(message.includes(untrustedOmitEntry), false);
});

test("Netlify-hosted builds require the exact reviewed secret-scan omission set", () => {
  const failures = validateWebBuildEnvironment({
    environment: {
      ...PUBLIC_BUILD_ENVIRONMENT,
      ...NETLIFY_HOSTED_BUILD_ENVIRONMENT,
      SECRETS_SCAN_OMIT_KEYS: APPROVED_NETLIFY_SECRET_SCAN_OMIT_KEYS.slice(0, -1).join(","),
    },
    dotEnvSources: [],
  });

  assert.match(failures.join("\n"), /exactly the reviewed public identifiers/);
});

test("dotenv parsing returns names only and the build check covers production dotenv files", async () => {
  assert.deepEqual(
    parseDotEnvVariableNames(
      "# comment\nexport SAFE_NAME=value\n OPENAI_API_KEY = do-not-return-this\nINVALID LINE\n",
    ),
    ["SAFE_NAME", "OPENAI_API_KEY"],
  );

  const root = await mkdtemp(join(tmpdir(), "prompted-web-build-env-"));
  try {
    await mkdir(join(root, "apps/web"), { recursive: true });
    await writeFile(
      join(root, "apps/web/.env.production"),
      "OPENAI_API_KEY=private-value\nNETLIFY_SKEW_PROTECTION_TOKEN=platform-private-value\n",
    );

    await assert.rejects(
      assertWebBuildEnvironmentSafe({
        repoRoot: root,
        environment: PUBLIC_BUILD_ENVIRONMENT,
      }),
      (error) => {
        assert.match(error.message, /OPENAI_API_KEY/);
        assert.match(error.message, /NETLIFY_SKEW_PROTECTION_TOKEN/);
        assert.equal(error.message.includes("private-value"), false);
        assert.equal(error.message.includes("platform-private-value"), false);
        return true;
      },
    );

    const serviceRoleKey = fakeSupabaseJwt({ role: "service_role" });
    await writeFile(
      join(root, "apps/web/.env.production"),
      `NEXT_PUBLIC_APP_ENV=production\nNEXT_PUBLIC_SUPABASE_URL=https://${PUBLIC_SUPABASE_PROJECT_REF}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${serviceRoleKey}\n`,
    );
    await assert.rejects(
      assertWebBuildEnvironmentSafe({
        repoRoot: root,
        environment: {},
      }),
      (error) => {
        assert.match(error.message, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
        assert.equal(error.message.includes(serviceRoleKey), false);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git ignores populated dotenv variants while retaining reviewed examples", () => {
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", "apps/web/.env.production"],
    { cwd: REPO_ROOT, shell: false },
  );
  const example = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", "apps/web/.env.example"],
    { cwd: REPO_ROOT, shell: false },
  );

  assert.equal(ignored.status, 0);
  assert.equal(example.status, 1);
});
