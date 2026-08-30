import assert from "node:assert/strict";
import test from "node:test";

import {
  missingSecretNames,
  parseSecretNames,
  requiredSecretNames,
} from "./check-supabase-secret-names.mjs";

const MANIFEST = {
  sharedSecrets: [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ALLOWED_ORIGINS",
  ],
  functions: {
    generation: {
      status: "active",
      requiredSecrets: ["OPENAI_API_KEY", "OPENAI_FAST_MODEL"],
    },
    legacy: {
      status: "dormant",
      requiredSecrets: ["RETIRED_PROVIDER_KEY"],
    },
  },
};

test("requires only custom and active-function secret names", () => {
  assert.deepEqual(requiredSecretNames(MANIFEST), [
    "ALLOWED_ORIGINS",
    "OPENAI_API_KEY",
    "OPENAI_FAST_MODEL",
  ]);
});

test("parses names without retaining digests or values", () => {
  assert.deepEqual(
    [...parseSecretNames(JSON.stringify([
      { name: "OPENAI_API_KEY", digest: "must-not-be-used" },
      { name: "ALLOWED_ORIGINS" },
    ]))],
    ["OPENAI_API_KEY", "ALLOWED_ORIGINS"],
  );
  assert.throws(() => parseSecretNames("not-json"));
});

test("reports every missing required name and ignores dormant providers", () => {
  assert.deepEqual(
    missingSecretNames(MANIFEST, new Set(["ALLOWED_ORIGINS"])),
    ["OPENAI_API_KEY", "OPENAI_FAST_MODEL"],
  );
});
