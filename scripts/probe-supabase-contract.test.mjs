import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMigrationLedgerCannotBeSkipped,
  buildHostedInventorySql,
  buildCapacityAttestationRequest,
  buildRoutingAttestationRequest,
  buildSchemaAttestationRequest,
  fetchCapacityAttestation,
  fetchRoutingAttestation,
  fetchAppliedMigrationVersions,
  fetchHostedFunctionInventory,
  fetchHostedInventory,
  fetchOpenApiDoc,
  fetchPreMigrationLedger,
  fetchSchemaAttestation,
  parseMigrationLedgerOutput,
  pingFunctionEndpoint,
  requiredProbeEnvironmentVariables,
  runFunctionSmokeProbes,
  validateCapacityAttestation,
  validateRoutingAttestation,
  validateHostedInventory,
  validateLiveSchema,
  validateProbeTarget,
  validateSupabaseUrl,
} from "./probe-supabase-contract.mjs";

const PROJECT_REF = "jjsykocqpjlekgsbylkd";
const BASELINE_MIGRATION = "20260527111048";
const CAPACITY_VARIABLES = {
  fast: "PROD_OPENAI_FAST_CAPACITY_FINGERPRINT",
  deep: "PROD_OPENAI_DEEP_CAPACITY_FINGERPRINT",
  research: "PROD_OPENAI_RESEARCH_CAPACITY_FINGERPRINT",
  review: "PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT",
};
const CAPACITY_MANIFEST = {
  projectRef: PROJECT_REF,
  capacityAttestation: {
    rpc: "attest_openai_capacity_configuration",
    environment: "production",
    fingerprintEnvironmentVariables: CAPACITY_VARIABLES,
  },
};
const ROUTING_MANIFEST = {
  projectRef: PROJECT_REF,
  routingAttestation: {
    rpc: "attest_openai_routing_configuration",
    environment: "production",
    routingVersionEnvironmentVariable: "PROD_OPENAI_ROUTING_VERSION",
    evaluationSuiteEnvironmentVariable: "PROD_OPENAI_EVALUATION_SUITE_VERSION",
    minimumValiditySeconds: 86_400,
    routes: {
      fast: {
        reasoningEffort: "low",
        modelEnvironmentVariable: "PROD_OPENAI_FAST_MODEL",
        evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_FAST_EVALUATION_FINGERPRINT",
      },
      deep: {
        reasoningEffort: "medium",
        modelEnvironmentVariable: "PROD_OPENAI_DEEP_MODEL",
        evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_DEEP_EVALUATION_FINGERPRINT",
      },
      research: {
        reasoningEffort: "medium",
        modelEnvironmentVariable: "PROD_OPENAI_RESEARCH_MODEL",
        evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_RESEARCH_EVALUATION_FINGERPRINT",
      },
      review: {
        reasoningEffort: "high",
        modelEnvironmentVariable: "PROD_OPENAI_REVIEW_MODEL",
        evaluationFingerprintEnvironmentVariable: "PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT",
      },
    },
  },
};

function approvedRoutingEnvironment() {
  return {
    PROD_OPENAI_ROUTING_VERSION: "routing.2026-09-release.1",
    PROD_OPENAI_EVALUATION_SUITE_VERSION: "prompted-openai-evals.1",
    PROD_OPENAI_FAST_MODEL: "gpt-5.6-luna",
    PROD_OPENAI_DEEP_MODEL: "gpt-5.6-sol",
    PROD_OPENAI_RESEARCH_MODEL: "gpt-5.6-terra",
    PROD_OPENAI_REVIEW_MODEL: "gpt-5.6-sol",
    PROD_OPENAI_FAST_EVALUATION_FINGERPRINT: "1".repeat(64),
    PROD_OPENAI_DEEP_EVALUATION_FINGERPRINT: "2".repeat(64),
    PROD_OPENAI_RESEARCH_EVALUATION_FINGERPRINT: "3".repeat(64),
    PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT: "4".repeat(64),
  };
}

const INVENTORY_MANIFEST = {
  projectRef: PROJECT_REF,
  preMigrationInventory: {
    contractVersion: "prompted-release-inventory.2",
    productionBaselineMigration: "20260527111048",
    savedRoleMigration: "20260901105000_atomic_saved_role_actions",
    brandAssetsCreationMigration: "20260901106000_brand_assets_owner_storage",
    brandAssetsMigration: "20260902016000_brand_logo_lifecycle",
    brandAssets: {
      bucketId: "assets",
      name: "assets",
      public: true,
      fileSizeLimit: 5_242_880,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      objectPathPattern:
        "^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo[.](png|jpg|webp)|logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp))$",
      policies: [
        {
          name: "assets_authenticated_owner_select",
          mode: "PERMISSIVE",
          command: "SELECT",
          roles: ["authenticated"],
          definitionSha256: "98b4d394af92e4b006bc4edcc71f502887106b5fd14d8f728f2381bb89ef56b6",
        },
      ],
      predecessorPolicies: [
        {
          name: "assets_authenticated_access",
          definitionSha256: "9637ef9c66f2aa06468f9993922c878e51125cfabc7e0aa61a9d4e3a085f2032",
        },
        {
          name: "assets_authenticated_owner_boundary",
          definitionSha256: "2a2e2c6a0f45010e41329bb8c9e0b1c343f4f1d23bd7abeedd5da281adc6e0dd",
        },
        {
          name: "assets_no_direct_client_delete",
          definitionSha256: "6d6cb20a0fa671feea603fd47ce527fa10e1ff76df27c94f0572bb2ecfdb4d2b",
        },
      ],
      requiredUnrelatedPolicies: [
        {
          name: "captured_exports_no_direct_client_access",
          definitionSha256: "48df06f778d1ae4b30c10237a66ac47eecfc0a3af6df0ed5300da4884358f050",
        },
        {
          name: "original_documents_read_own",
          definitionSha256: "be5289d83b63014f5a9975296fa3bce99371b4657b7939c87b673a01758f277b",
        },
      ],
    },
    forbidUndeclaredHostedFunctions: true,
    dormantFunctionsMustBeAbsent: true,
  },
  functions: {
    clarify: { status: "active", authMode: "anon" },
    "openai-chat": { status: "dormant", authMode: "jwt" },
  },
};

function safeHostedInventory(overrides = {}) {
  return {
    contract_version: "prompted-release-inventory.2",
    transaction_read_only: true,
    saved_roles_exists: true,
    businesses_exists: true,
    storage_buckets_exists: true,
    storage_objects_exists: true,
    duplicate_saved_role_groups: 0,
    duplicate_saved_role_rows: 0,
    assets_bucket_count: 1,
    assets_bucket_public: true,
    assets_bucket_name_matches: true,
    assets_bucket_file_size_limit: 5_242_880,
    assets_bucket_allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    assets_object_count: 0,
    assets_noncanonical_path_count: 0,
    assets_orphan_business_count: 0,
    assets_oversized_object_count: 0,
    assets_unsupported_mime_count: 0,
    assets_duplicate_business_count: 0,
    expected_assets_policy_count: 1,
    predecessor_assets_policy_count: 0,
    expected_non_assets_policy_count: 2,
    unexpected_storage_policy_count: 0,
    ...overrides,
  };
}

function attestation(
  request,
  available = true,
  { authenticatedRpcs = request.rpcs, serviceRpcs = request.rpcs, anonRpcs = [] } = {},
) {
  return {
    schema_version: 2,
    tables: request.tables.map((name) => ({
      name,
      exists: available,
      relation_kind: available ? "r" : null,
      rls_enabled: available,
      rls_forced: false,
      authenticated: { select: available, insert: false, update: false, delete: false },
      service_role: { select: available, insert: false, update: false, delete: false },
    })),
    rpcs: request.rpcs.map((name) => ({
      name,
      exists: available,
      overload_count: available ? 1 : 0,
      argument_types: null,
      anon_execute: available && anonRpcs.includes(name),
      authenticated_execute: available && authenticatedRpcs.includes(name),
      service_role_execute: available && serviceRpcs.includes(name),
      security_definer: available,
      safe_security_definer_search_path: available,
    })),
  };
}

test("production migration-ledger validation cannot be skipped", () => {
  assert.doesNotThrow(() => assertMigrationLedgerCannotBeSkipped(undefined));
  assert.doesNotThrow(() => assertMigrationLedgerCannotBeSkipped(""));
  assert.throws(
    () => assertMigrationLedgerCannotBeSkipped("skip"),
    /migration ledger gate cannot be skipped/i,
  );
});

test("migration ledger parser fails closed on blank, header-only, and malformed CLI output", () => {
  for (const invalid of [
    "",
    "unrecognized output",
    " LOCAL | REMOTE | TIME\n",
    " LOCAL | REMOTE | TIME\n unexpected row\n",
    " LOCAL | REMOTE | TIME\n invalid | 20260527111048 | now\n",
    " LOCAL | REMOTE | TIME\n | | now\n",
  ]) {
    assert.throws(() => parseMigrationLedgerOutput(invalid), /migration ledger/i, invalid);
  }

  assert.deepEqual(
    parseMigrationLedgerOutput(
      "Connecting…\n LOCAL | REMOTE | TIME\n 20260527111048 | 20260527111048 | now\n",
    ),
    {
      rows: [{ localVersion: BASELINE_MIGRATION, remoteVersion: BASELINE_MIGRATION }],
      localVersions: [BASELINE_MIGRATION],
      remoteVersions: [BASELINE_MIGRATION],
    },
  );
});

test("validateSupabaseUrl accepts only the exact canonical HTTPS project origin", () => {
  const target = validateSupabaseUrl(`https://${PROJECT_REF}.supabase.co`, PROJECT_REF);

  assert.equal(target.origin, `https://${PROJECT_REF}.supabase.co`);
  assert.equal(target.pathname, "/");
});

test("validateSupabaseUrl rejects credential-exfiltration and ambiguous targets", () => {
  const invalidTargets = [
    `http://${PROJECT_REF}.supabase.co`,
    `https://user:password@${PROJECT_REF}.supabase.co`,
    `https://${PROJECT_REF}.supabase.co:8443`,
    `https://${PROJECT_REF}.supabase.co/rest/v1`,
    `https://${PROJECT_REF}.supabase.co?next=https://attacker.example`,
    `https://${PROJECT_REF}.supabase.co#attacker`,
    `https://${PROJECT_REF}.supabase.co.attacker.example`,
    `https://attacker.example/${PROJECT_REF}.supabase.co`,
    `https://wrongproject.supabase.co`,
    "not a URL",
  ];

  for (const target of invalidTargets) {
    assert.throws(() => validateSupabaseUrl(target, PROJECT_REF), /Supabase URL|project/i, target);
  }
});

test("validateProbeTarget requires one exact project identity", () => {
  assert.equal(
    validateProbeTarget({
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      manifestProjectRef: PROJECT_REF,
      environmentProjectRef: PROJECT_REF,
    }).origin,
    `https://${PROJECT_REF}.supabase.co`,
  );

  assert.throws(
    () =>
      validateProbeTarget({
        supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
        manifestProjectRef: PROJECT_REF,
        environmentProjectRef: "anotherprojectref",
      }),
    /SUPABASE_PROJECT_REF.*does not match/i,
  );
});

test("target mode requires a URL but not a project override or service-role credential", () => {
  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "target",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      projectRef: PROJECT_REF,
      serviceRoleKey: undefined,
    }),
    [],
  );

  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "target",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      projectRef: undefined,
      serviceRoleKey: "must-not-be-needed",
    }),
    [],
  );

  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "schema",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      projectRef: PROJECT_REF,
      serviceRoleKey: undefined,
    }),
    ["SUPABASE_SERVICE_ROLE_KEY"],
  );
});

test("inventory modes require exact target and CLI credentials but not the service role", () => {
  for (const probeMode of ["inventory", "post_function"]) {
    assert.deepEqual(
      requiredProbeEnvironmentVariables({
        probeMode,
        supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
        projectRef: PROJECT_REF,
        serviceRoleKey: undefined,
        manifest: INVENTORY_MANIFEST,
        environment: {
          SUPABASE_ACCESS_TOKEN: "access-token",
          SUPABASE_DB_PASSWORD: "database-password",
        },
      }),
      [],
    );
    assert.deepEqual(
      requiredProbeEnvironmentVariables({
        probeMode,
        supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
        projectRef: undefined,
        serviceRoleKey: undefined,
        manifest: INVENTORY_MANIFEST,
        environment: {},
      }),
      ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"],
    );
  }
});

test("hosted inventory CLI calls are shell-free, bounded, and contain no credentials", async () => {
  const calls = [];
  const execFileImpl = async (executable, args, options) => {
    calls.push({ executable, args, options });
    if (args[0] === "migration") {
      return { stdout: " LOCAL | REMOTE | TIME\n 20260901105000 | 20260901105000 | now\n" };
    }
    if (args[0] === "db") {
      const payload = Buffer.from(JSON.stringify(safeHostedInventory()), "utf8").toString("hex");
      return { stdout: JSON.stringify({ rows: [{ prompted_release_inventory_v1: payload }] }) };
    }
    return {
      stdout: JSON.stringify([
        { name: "clarify", status: "ACTIVE", version: 1, verify_jwt: false },
      ]),
    };
  };

  await fetchPreMigrationLedger({ projectRef: PROJECT_REF, execFileImpl });
  await fetchHostedInventory({
    projectRef: PROJECT_REF,
    manifest: INVENTORY_MANIFEST,
    execFileImpl,
  });
  await fetchHostedFunctionInventory({ projectRef: PROJECT_REF, execFileImpl });

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.executable),
    ["supabase", "supabase", "supabase"],
  );
  assert.deepEqual(calls[0].args, ["migration", "list", "--project-ref", PROJECT_REF]);
  assert.equal(calls[1].args[0], "db");
  assert.equal(calls[1].args[1], "query");
  assert.deepEqual(calls[1].args.slice(2, 6), [
    "--project-ref",
    PROJECT_REF,
    "--output-format",
    "json",
  ]);
  assert.equal(calls[1].args[6], "--file");
  assert.match(calls[1].args[7], /prompted-release-inventory-.*inventory[.]sql$/);
  assert.deepEqual(calls[2].args, [
    "functions",
    "list",
    "--project-ref",
    PROJECT_REF,
    "--output",
    "json",
  ]);
  for (const call of calls) {
    assert.equal(call.options.shell, false);
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 60_000);
    assert.ok(call.options.maxBuffer > 0 && call.options.maxBuffer <= 1024 * 1024);
    const serialized = JSON.stringify(call.args);
    assert.doesNotMatch(serialized, /access-token|database-password|service-role/i);
  }
});

test("hosted inventory SQL is one bounded SELECT snapshot and returns only a hex aggregate sentinel", () => {
  const sql = buildHostedInventorySql(INVENTORY_MANIFEST);
  assert.match(sql, /^with\s/i);
  assert.match(sql, /set_config\('statement_timeout', '20s', true\)/i);
  assert.match(sql, /set_config\('lock_timeout', '2s', true\)/i);
  assert.match(sql, /prompted_release_inventory_v1/i);
  assert.match(sql, /pg_catalog\.count/i);
  assert.equal(sql.match(/;/g)?.length, 1);
  assert.match(sql, /from inventory_payload;\s*$/i);
  assert.doesNotMatch(
    sql,
    /select\s+(?:role_record\.)?(?:id|user_id|role_title|company_name|name)\s*(?:,|from)/i,
  );
  assert.doesNotMatch(sql, /brand_kits\.logo_url|\b(?:document|prompt|content)\b/i);
});

test("inventory validation blocks hazardous data and reports aggregate facts only", () => {
  const base = {
    manifest: INVENTORY_MANIFEST,
    migrationLedger: { remoteVersions: [BASELINE_MIGRATION], rows: [] },
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
    phase: "pre_migration",
  };
  for (const [field, value, code] of [
    ["duplicate_saved_role_groups", 1, "SAVED_ROLE_DUPLICATES"],
    ["assets_noncanonical_path_count", 1, "ASSETS_NONCANONICAL_PATHS"],
    ["assets_orphan_business_count", 1, "ASSETS_ORPHAN_BUSINESSES"],
    ["assets_oversized_object_count", 1, "ASSETS_OVERSIZED_OBJECTS"],
    ["assets_unsupported_mime_count", 1, "ASSETS_UNSUPPORTED_MIME"],
    ["assets_duplicate_business_count", 1, "ASSETS_DUPLICATE_BUSINESS"],
    ["unexpected_storage_policy_count", 1, "STORAGE_UNDECLARED_POLICY"],
  ]) {
    const result = validateHostedInventory({
      ...base,
      inventory: safeHostedInventory({ [field]: value }),
    });
    assert.ok(
      result.failures.some((failure) => failure.code === code),
      field,
    );
    assert.doesNotMatch(JSON.stringify(result), /user_id|role_title|company_name|brand-kits\//i);
  }
});

test("assets creation and policy replacement use their own migration boundaries", () => {
  const missingBucketInput = {
    manifest: INVENTORY_MANIFEST,
    inventory: safeHostedInventory({
      assets_bucket_count: 0,
      assets_bucket_public: null,
      assets_bucket_name_matches: null,
      assets_bucket_file_size_limit: null,
      assets_bucket_allowed_mime_types: [],
      expected_assets_policy_count: 0,
    }),
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
    phase: "pre_migration",
  };
  const pendingCreate = validateHostedInventory({
    ...missingBucketInput,
    migrationLedger: { remoteVersions: [BASELINE_MIGRATION], rows: [] },
  });
  assert.deepEqual(pendingCreate.failures, []);
  assert.ok(pendingCreate.checks.some((check) => check.code === "ASSETS_PLANNED_CREATE"));

  const creationApplied = validateHostedInventory({
    ...missingBucketInput,
    migrationLedger: {
      remoteVersions: [BASELINE_MIGRATION, "20260901106000"],
      rows: [],
    },
  });
  assert.ok(creationApplied.failures.some((failure) => failure.code === "ASSETS_BUCKET_MISSING"));

  const policyInput = {
    manifest: INVENTORY_MANIFEST,
    inventory: safeHostedInventory({
      expected_assets_policy_count: 0,
      predecessor_assets_policy_count: 3,
    }),
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
    phase: "pre_migration",
  };
  const pendingPolicyReplacement = validateHostedInventory({
    ...policyInput,
    migrationLedger: {
      remoteVersions: [BASELINE_MIGRATION, "20260901106000"],
      rows: [],
    },
  });
  assert.deepEqual(pendingPolicyReplacement.failures, []);
  assert.ok(
    pendingPolicyReplacement.checks.some((check) => check.code === "ASSETS_POLICY_PLANNED_REPLACE"),
  );

  const finalPolicyApplied = validateHostedInventory({
    ...policyInput,
    migrationLedger: {
      remoteVersions: [BASELINE_MIGRATION, "20260901106000", "20260902016000"],
      rows: [],
    },
  });
  assert.ok(finalPolicyApplied.failures.some((failure) => failure.code === "ASSETS_POLICY_DRIFT"));
});

test("Storage inventory rejects a correct-name wrong predicate and every broad extra policy", () => {
  const base = {
    manifest: INVENTORY_MANIFEST,
    migrationLedger: {
      remoteVersions: [BASELINE_MIGRATION, "20260901106000", "20260902016000"],
      localVersions: [BASELINE_MIGRATION, "20260901106000", "20260902016000"],
      rows: [],
    },
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
    phase: "pre_migration",
  };
  const wrongPredicate = validateHostedInventory({
    ...base,
    inventory: safeHostedInventory({
      expected_assets_policy_count: 0,
      unexpected_storage_policy_count: 1,
    }),
  });
  assert.ok(wrongPredicate.failures.some((failure) => failure.code === "ASSETS_POLICY_DRIFT"));
  assert.ok(
    wrongPredicate.failures.some((failure) => failure.code === "STORAGE_UNDECLARED_POLICY"),
  );

  for (const broadPolicy of ["USING (true)", "WITH CHECK (true)"]) {
    const result = validateHostedInventory({
      ...base,
      inventory: safeHostedInventory({ unexpected_storage_policy_count: 1 }),
    });
    assert.ok(
      result.failures.some((failure) => failure.code === "STORAGE_UNDECLARED_POLICY"),
      broadPolicy,
    );
  }
});

test("private populated assets bucket and divergent migration history block before push", () => {
  const result = validateHostedInventory({
    manifest: INVENTORY_MANIFEST,
    migrationLedger: {
      remoteVersions: [BASELINE_MIGRATION, "20260902016000", "20990101000000"],
      localVersions: [BASELINE_MIGRATION, "20260902016000"],
      rows: [],
    },
    inventory: safeHostedInventory({
      assets_bucket_public: false,
      assets_object_count: 2,
    }),
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
    phase: "pre_migration",
  });
  assert.ok(result.failures.some((failure) => failure.code === "ASSETS_PRIVATE_WITH_OBJECTS"));
  assert.ok(result.failures.some((failure) => failure.code === "MIGRATION_LEDGER_DIVERGED"));
});

test("hosted inventory requires the immutable production migration baseline", () => {
  const result = validateHostedInventory({
    manifest: INVENTORY_MANIFEST,
    migrationLedger: { remoteVersions: [], localVersions: [], rows: [] },
    inventory: safeHostedInventory({
      expected_assets_policy_count: 0,
      expected_non_assets_policy_count: 2,
    }),
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
    phase: "pre_migration",
  });
  assert.ok(
    result.failures.some((failure) => failure.code === "MIGRATION_LEDGER_BASELINE_MISSING"),
  );
});

test("hosted function inventory blocks undeclared, dormant, and auth-mode drift", () => {
  const result = validateHostedInventory({
    manifest: INVENTORY_MANIFEST,
    migrationLedger: { remoteVersions: [BASELINE_MIGRATION], rows: [] },
    inventory: safeHostedInventory(),
    hostedFunctions: [
      { name: "clarify", status: "ACTIVE", version: 1, verifyJwt: true },
      { name: "openai-chat", status: "ACTIVE", version: 2, verifyJwt: true },
      { name: "legacy-provider", status: "ACTIVE", version: 1, verifyJwt: false },
    ],
    phase: "pre_migration",
  });
  assert.ok(result.failures.some((failure) => failure.code === "HOSTED_FUNCTION_AUTH_DRIFT"));
  assert.ok(result.failures.some((failure) => failure.code === "DORMANT_FUNCTION_DEPLOYED"));
  assert.ok(result.failures.some((failure) => failure.code === "UNDECLARED_HOSTED_FUNCTION"));
});

test("post-function inventory requires every active function and exact non-null JWT metadata", () => {
  const input = {
    manifest: INVENTORY_MANIFEST,
    migrationLedger: { remoteVersions: [BASELINE_MIGRATION], rows: [] },
    inventory: safeHostedInventory(),
    phase: "post_function",
  };
  const missing = validateHostedInventory({ ...input, hostedFunctions: [] });
  assert.ok(missing.failures.some((failure) => failure.code === "ACTIVE_FUNCTION_MISSING"));

  const absentMetadata = validateHostedInventory({
    ...input,
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: null }],
  });
  assert.ok(
    absentMetadata.failures.some(
      (failure) => failure.code === "HOSTED_FUNCTION_AUTH_METADATA_MISSING",
    ),
  );

  const exact = validateHostedInventory({
    ...input,
    hostedFunctions: [{ name: "clarify", status: "ACTIVE", version: 1, verifyJwt: false }],
  });
  assert.equal(
    exact.failures.some((failure) =>
      [
        "ACTIVE_FUNCTION_MISSING",
        "HOSTED_FUNCTION_AUTH_METADATA_MISSING",
        "HOSTED_FUNCTION_AUTH_DRIFT",
      ].includes(failure.code),
    ),
    false,
  );
});

test("inventory sentinel and CLI failures fail closed without leaking command output", async () => {
  await assert.rejects(
    fetchHostedInventory({
      projectRef: PROJECT_REF,
      manifest: INVENTORY_MANIFEST,
      execFileImpl: async () => ({ stdout: JSON.stringify({ rows: [] }) }),
    }),
    (error) => error.message === "Hosted release inventory response was invalid.",
  );
  await assert.rejects(
    fetchHostedInventory({
      projectRef: PROJECT_REF,
      manifest: INVENTORY_MANIFEST,
      execFileImpl: async () => {
        const error = new Error("private row title and database-password");
        error.stdout = "brand-kits/private/logo.png";
        error.stderr = "access-token";
        throw error;
      },
    }),
    (error) => error.message === "Hosted release inventory query failed.",
  );
});

test("schema mode requires all four approved capacity fingerprints", () => {
  const fingerprint = "a".repeat(64);
  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "schema",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      serviceRoleKey: "service-role-secret",
      manifest: CAPACITY_MANIFEST,
      environment: {
        PROD_OPENAI_FAST_CAPACITY_FINGERPRINT: fingerprint,
        PROD_OPENAI_DEEP_CAPACITY_FINGERPRINT: fingerprint,
        PROD_OPENAI_RESEARCH_CAPACITY_FINGERPRINT: fingerprint,
      },
    }),
    ["PROD_OPENAI_REVIEW_CAPACITY_FINGERPRINT"],
  );
});

test("schema mode requires exact route, model, suite, and evaluation inputs", () => {
  const environment = approvedRoutingEnvironment();
  delete environment.PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT;
  environment.PROD_OPENAI_DEEP_MODEL = "contains spaces";
  assert.deepEqual(
    requiredProbeEnvironmentVariables({
      probeMode: "schema",
      supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
      serviceRoleKey: "service-role-secret",
      manifest: ROUTING_MANIFEST,
      environment,
    }),
    ["PROD_OPENAI_DEEP_MODEL", "PROD_OPENAI_REVIEW_EVALUATION_FINGERPRINT"],
  );
});

test("fetchOpenApiDoc validates the target before sending a service-role credential", async () => {
  let fetchCalls = 0;
  const fetchImpl = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("fetch must not run"));
  };

  await assert.rejects(
    fetchOpenApiDoc(`https://${PROJECT_REF}.supabase.co.attacker.example`, "service-role-secret", {
      expectedProjectRef: PROJECT_REF,
      fetchImpl,
    }),
    /Supabase URL/i,
  );
  assert.equal(fetchCalls, 0);
});

test("fetchOpenApiDoc sends credentials only to the validated metadata endpoint", async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ paths: {} }),
    });
  };

  await fetchOpenApiDoc(`https://${PROJECT_REF}.supabase.co`, "service-role-secret", {
    expectedProjectRef: PROJECT_REF,
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://${PROJECT_REF}.supabase.co/rest/v1/`);
  assert.deepEqual(calls[0].options.headers, {
    apikey: "service-role-secret",
    Authorization: "Bearer service-role-secret",
  });
  assert.equal(calls[0].options.redirect, "error");
  assert(calls[0].options.signal instanceof AbortSignal);
});

test("fetchOpenApiDoc has a bounded timeout and normalizes fetch failures", async () => {
  const timeoutError = new Error("secret-bearing timeout detail");
  timeoutError.name = "TimeoutError";
  await assert.rejects(
    fetchOpenApiDoc(`https://${PROJECT_REF}.supabase.co`, "service-role-secret", {
      expectedProjectRef: PROJECT_REF,
      timeoutMs: 25,
      fetchImpl: async () => {
        throw timeoutError;
      },
    }),
    (error) => error.message === "PostgREST metadata request timed out.",
  );

  await assert.rejects(
    fetchOpenApiDoc(`https://${PROJECT_REF}.supabase.co`, "service-role-secret", {
      expectedProjectRef: PROJECT_REF,
      fetchImpl: async () => {
        throw new Error("secret-bearing fetch detail");
      },
    }),
    (error) => error.message === "PostgREST metadata request failed.",
  );

  let fetchCalls = 0;
  for (const timeoutMs of [0, 60_001, 1.5]) {
    await assert.rejects(
      fetchOpenApiDoc(`https://${PROJECT_REF}.supabase.co`, "service-role-secret", {
        expectedProjectRef: PROJECT_REF,
        timeoutMs,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
      }),
      /metadata timeout.*between 1 and 60000/i,
    );
  }
  assert.equal(fetchCalls, 0);
});

test("role-aware schema attestation sends only bounded object names to the exact project", async () => {
  const manifest = {
    projectRef: PROJECT_REF,
    schemaAttestation: { rpc: "attest_prompted_release_schema" },
    functions: {
      research: {
        status: "active",
        requiredRpcs: ["consume_rate_limit"],
        requiredAuthenticatedRpcs: ["get_captured_document_operation"],
        requiredTables: ["subscriptions"],
      },
    },
    webRequirements: {
      requiredRpcs: ["commit_guest_workspace_import"],
      requiredTables: ["documents"],
    },
  };
  const expectedRequest = buildSchemaAttestationRequest(manifest);
  const calls = [];
  const result = await fetchSchemaAttestation(
    `https://${PROJECT_REF}.supabase.co`,
    "service-role-secret",
    manifest,
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(attestation(expectedRequest)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.deepEqual(result.request, {
    tables: ["documents", "subscriptions"],
    rpcs: [
      "commit_guest_workspace_import",
      "consume_rate_limit",
      "get_captured_document_operation",
    ],
  });
  assert.equal(
    calls[0].url,
    `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/attest_prompted_release_schema`,
  );
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  assert(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_tables: ["documents", "subscriptions"],
    p_rpcs: [
      "commit_guest_workspace_import",
      "consume_rate_limit",
      "get_captured_document_operation",
    ],
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer service-role-secret");
});

test("capacity attestation sends only the exact environment and four semantic routes", async () => {
  const request = buildCapacityAttestationRequest(CAPACITY_MANIFEST);
  const calls = [];
  const payload = {
    contract_version: "openai-capacity-attestation.1",
    environment: "production",
    routes: request.routes.map((semantic_route) => ({
      semantic_route,
      configured: false,
      enabled: null,
      config_revision: null,
      fingerprint: null,
    })),
  };

  const result = await fetchCapacityAttestation(
    `https://${PROJECT_REF}.supabase.co`,
    "service-role-secret",
    CAPACITY_MANIFEST,
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    },
  );

  assert.deepEqual(result.request.routes, ["deep", "fast", "research", "review"]);
  assert.equal(
    calls[0].url,
    `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/attest_openai_capacity_configuration`,
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_environment: "production",
    p_semantic_routes: ["deep", "fast", "research", "review"],
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer service-role-secret");
});

test("capacity validation requires enabled exact fingerprints without exposing values", () => {
  const request = buildCapacityAttestationRequest(CAPACITY_MANIFEST);
  const environment = {};
  const routes = request.routes.map((semantic_route, index) => {
    const fingerprint = String(index + 1).repeat(64);
    environment[request.fingerprintVariables[semantic_route]] = fingerprint;
    return {
      semantic_route,
      configured: true,
      enabled: true,
      config_revision: 1,
      fingerprint,
    };
  });
  const exact = validateCapacityAttestation({
    payload: {
      contract_version: "openai-capacity-attestation.1",
      environment: "production",
      routes,
    },
    request,
    environment,
  });
  assert.deepEqual(exact.failures, []);
  assert(exact.checks.every((check) => check.ok));

  routes.find((route) => route.semantic_route === "review").enabled = false;
  routes.find((route) => route.semantic_route === "deep").fingerprint = "f".repeat(64);
  const rejected = validateCapacityAttestation({
    payload: {
      contract_version: "openai-capacity-attestation.1",
      environment: "production",
      routes,
    },
    request,
    environment,
  });
  assert.equal(rejected.failures.length, 2);
  assert(rejected.failures.every((failure) => !/[0-9a-f]{64}/.test(failure)));
});

test("routing attestation sends only the exact environment and four semantic routes", async () => {
  const request = buildRoutingAttestationRequest(ROUTING_MANIFEST);
  const payload = {
    contract_version: "openai-routing-attestation.1",
    environment: "production",
    routes: request.routes.map((semantic_route) => ({
      semantic_route,
      configured: false,
    })),
  };
  const calls = [];
  const result = await fetchRoutingAttestation(
    `https://${PROJECT_REF}.supabase.co`,
    "service-role-secret",
    ROUTING_MANIFEST,
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    },
  );

  assert.deepEqual(result.request.routes, ["deep", "fast", "research", "review"]);
  assert.equal(
    calls[0].url,
    `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/attest_openai_routing_configuration`,
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_environment: "production",
    p_semantic_routes: ["deep", "fast", "research", "review"],
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer service-role-secret");
});

test("routing validation binds exact models, reasoning, versions, evaluation, and expiry", () => {
  const request = buildRoutingAttestationRequest(ROUTING_MANIFEST);
  const environment = approvedRoutingEnvironment();
  const now = new Date("2026-09-02T00:00:00.000Z");
  const routes = request.routes.map((semantic_route) => {
    const routeContract = request.routesContract[semantic_route];
    return {
      semantic_route,
      configured: true,
      enabled: true,
      config_revision: 1,
      model: environment[routeContract.modelEnvironmentVariable],
      reasoning_effort: routeContract.reasoningEffort,
      routing_version: environment.PROD_OPENAI_ROUTING_VERSION,
      evaluation_suite_version: environment.PROD_OPENAI_EVALUATION_SUITE_VERSION,
      evaluated_configuration_sha256:
        environment[routeContract.evaluationFingerprintEnvironmentVariable],
      evaluated_at: "2026-09-01T00:00:00.000Z",
      expires_at: "2026-10-02T00:00:00.000Z",
    };
  });
  const exact = validateRoutingAttestation({
    payload: {
      contract_version: "openai-routing-attestation.1",
      environment: "production",
      routes,
    },
    request,
    environment,
    now,
  });
  assert.deepEqual(exact.failures, []);
  assert(exact.checks.every((check) => check.ok));

  routes.find((route) => route.semantic_route === "fast").model = "wrong-model";
  routes.find((route) => route.semantic_route === "deep").reasoning_effort = "low";
  routes.find((route) => route.semantic_route === "research").expires_at =
    "2026-09-02T12:00:00.000Z";
  routes.find((route) => route.semantic_route === "review").evaluated_configuration_sha256 =
    "f".repeat(64);
  const rejected = validateRoutingAttestation({
    payload: {
      contract_version: "openai-routing-attestation.1",
      environment: "production",
      routes,
    },
    request,
    environment,
    now,
  });
  assert.equal(rejected.failures.length, 4);
  assert(rejected.failures.every((failure) => !/[0-9a-f]{64}/.test(failure)));
});

test("linked migration lookup is bounded and never exposes CLI failure details", async () => {
  const calls = [];
  const migrations = await fetchAppliedMigrationVersions({
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        stdout: " LOCAL | REMOTE | TIME\n 20260831110000 | 20260831110000 | now\n",
      };
    },
  });
  assert.deepEqual([...migrations], ["20260831110000"]);
  assert.deepEqual(calls, [
    {
      command: "supabase",
      args: ["migration", "list", "--linked"],
      options: {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    },
  ]);

  await assert.rejects(
    fetchAppliedMigrationVersions({
      execFileImpl: async () => {
        const error = new Error("secret-bearing CLI stderr");
        error.killed = true;
        error.signal = "SIGTERM";
        throw error;
      },
    }),
    (error) => error.message === "Supabase migration list timed out.",
  );
  await assert.rejects(
    fetchAppliedMigrationVersions({
      execFileImpl: async () => {
        throw new Error("secret-bearing CLI stderr");
      },
    }),
    (error) => error.message === "Supabase migration list failed.",
  );

  let execCalls = 0;
  await assert.rejects(
    fetchAppliedMigrationVersions({
      timeoutMs: 60_001,
      execFileImpl: async () => {
        execCalls += 1;
        return { stdout: "" };
      },
    }),
    /migration list timeout.*between 1 and 60000/i,
  );
  assert.equal(execCalls, 0);
});

test("live schema validation includes direct browser RPC and migration requirements", () => {
  const manifest = {
    functions: {},
    webRequirements: {
      requiredMigrations: ["20260831110000_atomic_guest_workspace_import"],
      requiredRpcs: ["commit_guest_workspace_import"],
      requiredTables: ["documents"],
    },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const missing = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: attestation(request, false),
    attestationRequest: request,
  });
  assert(
    missing.failures.some((failure) =>
      failure.includes('migration "20260831110000_atomic_guest_workspace_import"'),
    ),
  );
  assert(missing.failures.some((failure) => failure.includes("one unambiguous RPC")));
  assert(missing.failures.some((failure) => failure.includes('table "documents"')));

  const complete = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(["20260831110000"]),
    attestation: attestation(request, true, { authenticatedRpcs: request.rpcs, serviceRpcs: [] }),
    attestationRequest: request,
  });
  assert.deepEqual(complete.failures, []);
  assert(complete.checks.every((check) => check.ok));
});

test("live schema validation fails closed on exact RPC argument-type drift", () => {
  const manifest = {
    schemaAttestation: {
      argumentTypesRequiredMigration: "20260901091000_ingest_upload_exact_replay",
    },
    requiredRpcSignatures: {
      commit_guest_workspace_import: "text, uuid, uuid, text, text, jsonb, uuid, text, jsonb",
    },
    functions: {},
    webRequirements: {
      requiredMigrations: [],
      requiredRpcs: ["commit_guest_workspace_import"],
      requiredTables: [],
    },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const payload = attestation(request, true, {
    authenticatedRpcs: request.rpcs,
    serviceRpcs: [],
  });
  payload.rpcs[0].argument_types = "uuid";
  const drifted = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(["20260901091000"]),
    attestation: payload,
    attestationRequest: request,
  });
  assert(drifted.failures.some((failure) => failure.includes("exact argument types")));

  payload.rpcs[0].argument_types = manifest.requiredRpcSignatures.commit_guest_workspace_import;
  const exact = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(["20260901091000"]),
    attestation: payload,
    attestationRequest: request,
  });
  assert.deepEqual(exact.failures, []);
});

test("live schema validation fails closed on role privilege drift and ambiguous RPCs", () => {
  const manifest = {
    functions: {},
    webRequirements: {
      requiredMigrations: [],
      requiredRpcs: ["commit_guest_workspace_import"],
      requiredTables: ["documents"],
      requiredTablePrivileges: { documents: ["select", "insert"] },
    },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const payload = attestation(request, true, {
    authenticatedRpcs: request.rpcs,
    serviceRpcs: [],
  });
  payload.tables[0].authenticated.insert = false;
  payload.rpcs[0].overload_count = 2;
  const result = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: payload,
    attestationRequest: request,
  });
  assert.equal(result.failures.length, 2);
  assert(result.failures.some((failure) => failure.includes("unambiguous RPC")));
  assert(result.failures.some((failure) => failure.includes("insert privilege")));
});

test("live schema validation rejects excess role table privileges", () => {
  const manifest = {
    functions: {
      "protected-function": {
        status: "active",
        requiredMigrations: [],
        requiredRpcs: [],
        requiredTables: ["usage_ledger"],
        requiredTablePrivileges: { usage_ledger: ["select"] },
      },
    },
    webRequirements: {
      requiredMigrations: [],
      requiredRpcs: [],
      requiredTables: ["documents"],
      requiredTablePrivileges: { documents: ["select"] },
    },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const payload = attestation(request);
  payload.tables.find((fact) => fact.name === "usage_ledger").service_role.insert = true;
  payload.tables.find((fact) => fact.name === "documents").authenticated.update = true;

  const result = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: payload,
    attestationRequest: request,
  });

  assert.equal(result.failures.length, 2);
  assert(result.failures.some((failure) => failure.includes("service_role undeclared insert")));
  assert(result.failures.some((failure) => failure.includes("authenticated undeclared update")));
});

test("live schema validation enforces an explicit zero-grant authenticated table contract", () => {
  const manifest = {
    functions: {},
    webRequirements: {
      requiredMigrations: [],
      requiredRpcs: [],
      requiredTables: ["ted_artifact_versions"],
      requiredTablePrivileges: { ted_artifact_versions: [] },
    },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const payload = attestation(request);
  payload.tables[0].authenticated = {
    select: false,
    insert: false,
    update: false,
    delete: false,
  };

  const exact = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: payload,
    attestationRequest: request,
  });
  assert.deepEqual(exact.failures, []);
  assert(
    exact.checks.some(
      (check) =>
        check.kind === "authenticated exact table privileges" &&
        check.name === "ted_artifact_versions" &&
        check.ok,
    ),
  );

  payload.tables[0].authenticated.insert = true;
  const drifted = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: payload,
    attestationRequest: request,
  });
  assert(
    drifted.failures.some(
      (failure) =>
        failure.includes('Table "ted_artifact_versions"') &&
        failure.includes("authenticated undeclared insert"),
    ),
  );
});

test("live schema validation rejects disabled RLS and undeclared RPC execution", () => {
  const manifest = {
    functions: {
      "webhooks-revenuecat": {
        status: "active",
        requiredMigrations: [],
        requiredRpcs: ["apply_revenuecat_webhook_event"],
        requiredAuthenticatedRpcs: [],
        requiredTables: [],
      },
    },
    webRequirements: {
      requiredMigrations: [],
      requiredRpcs: ["edit_captured_document_section"],
      requiredTables: ["documents"],
      requiredTablePrivileges: { documents: ["select"] },
    },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const payload = attestation(request, true, {
    authenticatedRpcs: ["edit_captured_document_section"],
    serviceRpcs: ["apply_revenuecat_webhook_event"],
  });
  payload.tables[0].rls_enabled = false;
  payload.rpcs.find((fact) => fact.name === "apply_revenuecat_webhook_event").anon_execute = true;

  const result = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: payload,
    attestationRequest: request,
  });

  assert(result.failures.some((failure) => failure.includes("enabled row-level security")));
  assert(
    result.failures.some(
      (failure) =>
        failure.includes('RPC "apply_revenuecat_webhook_event"') && failure.includes("forbids"),
    ),
  );
});

test("live schema validation rejects unsafe SECURITY DEFINER search paths", () => {
  const manifest = {
    functions: {
      protected: {
        status: "active",
        requiredMigrations: [],
        requiredRpcs: ["protected_rpc"],
        requiredTables: [],
      },
    },
    webRequirements: { requiredMigrations: [], requiredRpcs: [], requiredTables: [] },
  };
  const request = buildSchemaAttestationRequest(manifest);
  const payload = attestation(request, true, {
    authenticatedRpcs: [],
    serviceRpcs: ["protected_rpc"],
  });
  payload.rpcs[0].safe_security_definer_search_path = false;

  const result = validateLiveSchema({
    manifest,
    appliedMigrations: new Set(),
    attestation: payload,
    attestationRequest: request,
  });

  assert(
    result.failures.some((failure) =>
      failure.includes("does not fix the reviewed empty search_path"),
    ),
  );
});

test("function endpoint smoke accepts successful OPTIONS or an intentional handler 405", async () => {
  const calls = [];
  const ok = await pingFunctionEndpoint(
    `https://${PROJECT_REF}.supabase.co`,
    "document-operation",
    {
      expectedProjectRef: PROJECT_REF,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(null, { status: 204 });
      },
    },
  );

  assert.deepEqual(ok, { status: 204, ok: true, error: null });
  assert.equal(calls[0].url, `https://${PROJECT_REF}.supabase.co/functions/v1/document-operation`);
  assert.equal(calls[0].options.method, "OPTIONS");
  assert.equal(calls[0].options.redirect, "error");
  assert(calls[0].options.signal instanceof AbortSignal);

  const methodNotAllowed = await pingFunctionEndpoint(
    `https://${PROJECT_REF}.supabase.co`,
    "webhooks-revenuecat",
    {
      expectedProjectRef: PROJECT_REF,
      allowMethodNotAllowed: true,
      fetchImpl: async () => new Response(null, { status: 405 }),
    },
  );
  assert.deepEqual(methodNotAllowed, { status: 405, ok: true, error: null });

  for (const status of [401, 403, 404, 405, 429, 500]) {
    const failed = await pingFunctionEndpoint(
      `https://${PROJECT_REF}.supabase.co`,
      "document-operation",
      {
        expectedProjectRef: PROJECT_REF,
        fetchImpl: async () => new Response(null, { status }),
      },
    );
    assert.deepEqual(
      failed,
      { status, ok: false, error: `HTTP ${status}` },
      `HTTP ${status} must fail closed`,
    );
  }
});

test("function endpoint smoke times out and fails closed without leaking error details", async () => {
  const timeoutError = new Error("secret-bearing network detail");
  timeoutError.name = "TimeoutError";
  const timedOut = await pingFunctionEndpoint(
    `https://${PROJECT_REF}.supabase.co`,
    "document-operation",
    {
      expectedProjectRef: PROJECT_REF,
      timeoutMs: 25,
      fetchImpl: async () => {
        throw timeoutError;
      },
    },
  );
  assert.deepEqual(timedOut, {
    status: null,
    ok: false,
    error: "request timed out",
  });

  const networkFailure = await pingFunctionEndpoint(
    `https://${PROJECT_REF}.supabase.co`,
    "document-operation",
    {
      expectedProjectRef: PROJECT_REF,
      fetchImpl: async () => {
        throw new Error("secret-bearing response body");
      },
    },
  );
  assert.deepEqual(networkFailure, {
    status: null,
    ok: false,
    error: "request failed",
  });
});

test("function endpoint smoke validates its target and function name before fetching", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 204 });
  };

  await assert.rejects(
    pingFunctionEndpoint(
      `https://${PROJECT_REF}.supabase.co.attacker.example`,
      "document-operation",
      { expectedProjectRef: PROJECT_REF, fetchImpl },
    ),
    /Supabase URL/i,
  );
  await assert.rejects(
    pingFunctionEndpoint(`https://${PROJECT_REF}.supabase.co`, "document-operation/../attacker", {
      expectedProjectRef: PROJECT_REF,
      fetchImpl,
    }),
    /function name/i,
  );
  assert.equal(fetchCalls, 0);
});

test("declared function smoke records an endpoint failure for HTTP 404", async () => {
  const manifest = {
    projectRef: PROJECT_REF,
    functions: {
      "document-operation": {
        status: "active",
        smokeProbe: { kind: "table", name: "documents" },
      },
    },
  };
  const result = await runFunctionSmokeProbes({
    manifest,
    supabaseUrl: `https://${PROJECT_REF}.supabase.co`,
    openApiTables: new Set(["documents"]),
    openApiRpcs: new Set(),
    fetchImpl: async () => new Response(null, { status: 404 }),
  });

  assert.equal(result.checks[0].ok, true);
  assert.deepEqual(result.checks[1], {
    function: "document-operation",
    kind: "endpoint",
    name: "document-operation",
    ok: false,
    status: 404,
    error: "HTTP 404",
  });
  assert.deepEqual(result.failures, [
    'Function "document-operation" smoke probe returned HTTP 404.',
  ]);
});
