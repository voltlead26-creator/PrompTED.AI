# Immutable Source Import Audit

- **Status:** Complete local immutable-source decision record; application and
  release acceptance remain separate gates.
- **Target repository:** `https://github.com/voltlead26-creator/PrompTED.AI.git`
- **Target worktree:** `/Users/kaichurchw/PrompTED.AI`
- **Target branch and starting HEAD:** `main` at
  `ea0fa46029e87ecd69f40147ebc72d55ae5b158c`
- **Source repository:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Immutable source commit:**
  `3a9a7bc7afa26c66fcbfa56266302c148d9dfc37`
- **Source commit subject:** `revert: remove accidental repair-plan placeholder`
- **Reviewed on:** 2026-08-31, Australia/Melbourne
- **Runtime for local audit checks:** Node `22.23.2`

This audit controls the selective import of the committed `ClaudeTED.AI`
foundation into the existing `PrompTED.AI` Git history. The source commit is
provenance evidence, not target authority. No source working-tree change,
untracked repair, build output, cache, credential, local environment, or nested
repository is eligible for import.

## Decision model

Every one of the 599 source-tree entries receives one exact manifest row and one
of these decisions:

| Decision | Meaning | Required target state |
|---|---|---|
| `retain_exact` | Reviewed source file remains an active foundation file | Target mode and blob equal the immutable source |
| `retain_historical_exact` | Useful evidence or compatibility history, not active authority | Target mode and blob equal the immutable source |
| `defer_exact` | Preserved but explicitly outside the web-first acceptance boundary | Target mode and blob equal the immutable source |
| `rewrite_target` | Useful role or interface, but source content is unsafe, stale, or architecturally incompatible | Reviewed target blob exists, differs from source, and is recorded |
| `exclude` | Generated, dead, duplicate, unsafe, obsolete, or irrelevant to the target | Source path is absent from the target |

`pending` exists only as a fail-closed intermediate value. The verifier rejects
it. An exact source match proves only provenance; it does not prove security,
correctness, progressive delivery, persistence, deployment readiness, or user
workflow completion.

## Initial import provenance baseline

Before reviewed target rewrites and exclusions, read-only blob and mode
verification observed:

- 599 immutable source entries;
- 598 target files with the exact source blob;
- one intentional rewrite: root `AGENTS.md`;
- zero missing source paths;
- zero mode mismatches;
- all source entries use mode `100644`;
- three target-native coordination files, all ignored and outside the source
  import;
- no dirty-overlay file or nested repository detected.

The imported source payload is 5,791,122 bytes. The largest source file is the
946,805-byte legacy document-intelligence profile registry. Size is recorded as
an architectural and bundle-review signal, not an automatic exclusion reason.

## Final frozen decision record

At the explicit final-writer barrier, the target snapshot resolved all 599
immutable source paths with no missing manifest row, `pending` decision, or
unclassified absence:

| Decision | Count |
|---|---:|
| `retain_exact` | 395 |
| `retain_historical_exact` | 56 |
| `defer_exact` | 0 |
| `rewrite_target` | 116 |
| `exclude` | 32 |
| **Total source paths** | **599** |

The 32 exclusions are the exact previously reviewed set:

- 3 dead or duplicate delivery paths;
- 8 web-first mobile scaffold/dependency paths;
- 16 one-shot source mutators;
- 2 legacy provider/data seams;
- 3 stale generated or one-shot seed-authority paths.

The manifest also records 61 Git-versionable target-native files with exact
mode, byte size, and Git blob ID. The manifest cannot hash itself without a
circular identity, so `docs/audits/immutable-source-import.json` is the sole
explicit self-exclusion. Ignored coordination state, dependencies, caches, and
build output are not target source and are not included.

The 56 historical exact rows are inert plan, audit, handoff, benchmark, or ADR
evidence. The runtime-imported section-key compatibility JSON and its
existence-checked immutable-ledger ADR remain active `retain_exact` inputs, not
historical-only rows. Two current architecture documents were rewritten and
therefore carry exact `rewrite_target` blobs.

Every present donor path that differs from its immutable source blob is bound
to its exact reviewed target blob. This is target rebuild provenance, not an
import from the donor's dirty worktree. No source working-tree or untracked
overlay path participates in the manifest.

## Review method

The audit combines:

1. exact Git blob, mode, path, and byte-size comparison;
2. path-by-path ownership and runtime-consumer tracing;
3. secret-pattern inspection that reports rule and location without printing
   candidate values;
4. static contract checks under Node 22;
5. web/shared, Supabase, and delivery/configuration reviews;
6. explicit challenge of provider, ledger, persistence, replay, approval,
   allowance, export, RLS, cache, monitoring, and deployment boundaries;
7. focused tests for the import manifest itself;
8. later integrated type, lint, test, migration, bundle, build, and workflow
   gates after every rewrite decision is resolved.

## Confirmed rewrite gates

### Web and shared contracts

The imported browser currently owns non-atomic document/section writes,
transient generation restart, fallback provider work, checklist insertion,
approval state, caller-supplied export bodies, and local-storage recovery. That
cannot become the PrompTED.AI persistence authority. The target rewrite must:

- make Supabase operations and revisions authoritative;
- remove browser retries that can duplicate provider work or allowances;
- replace caller-body export with exact persisted approved-revision export;
- converge document, section, artifact, ledger, and operation contracts;
- preserve user edits and reject stale provider writes;
- make captured checklist generation use the same durable operation boundary;
- split critical workspace truth from optional editor, history, proofread,
  preview, catalogue, upload, and monitoring code;
- add accessible route loading, error, and not-found boundaries;
- minimise monitoring capture and prohibit document/prompt content capture;
- replace partial guest-workspace migration with one atomic import boundary.

### Supabase tenant isolation

The imported `profiles_update_own` policy and broad authenticated table grant
allow a user to change every column of their own profile, including
`business_id`, `plan`, and `usage_count`. Privileged memory and account-deletion
code then trusts `business_id` while using a service-role client. This creates a
cross-tenant memory read/write path, entitlement/counter tampering, and a route
to foreign brand-logo deletion.

The target must preserve legitimate profile and owned-business updates while:

- granting authenticated users only the intended profile columns;
- validating every non-null business binding against ownership or membership;
- rechecking tenant authority inside privileged memory and deletion consumers;
- handling previously invalid bindings safely;
- adding negative and legitimate-control database/function tests.

No imported migration is rewritten. The repair is additive and remains local
until a separately authorised hosted migration.

### Provider and deployment authority

The imported provider router actively selects Anthropic, OpenAI, or Google and
uses a cross-provider fallback order. The imported deployment contract also
marks the Anthropic endpoint active. Those files require a target rewrite:

- OpenAI becomes the only active inference provider;
- semantic fast, deep, research, and conditional review routes are explicit;
- historical provider values remain readable provenance;
- legacy endpoints are disabled or retained only as bounded compatibility;
- deployment tooling cannot reactivate a retired provider;
- old `ClaudeTED.AI` and `reliably-prompTED` release identities are removed
  from active target workflows and checkers.

### Netlify, cache, and generated output

The imported Netlify configuration omits broad `.next` output trees from secret
scanning. Current Netlify guidance states that scanning covers repository and
build-output files, and that path omissions remove those files from scanning.
The target will keep explicit public-key omissions but will not exempt the
entire generated application from secret inspection. See
[Netlify Secrets Controller](https://docs.netlify.com/build/environment-variables/secrets-controller/).

Authenticated API responses must be private and non-cacheable at their actual
response boundary. Netlify file headers alone do not prove proxy or Edge
Function response policy.

### Delivery and historical material

- The root README, environment template, devcontainer, CI/release workflow,
  deployment checkers, and local-preview instructions use stale repository,
  branch, provider, or framework assumptions and require target rewrites.
- The unused Netlify HTML-injection function references missing assets and is
  an exclusion candidate.
- The Expo Layer-1 mobile scaffold is excluded from the web-first target import;
  its six files and root `eas.json` remain recoverable from the immutable source
  commit.
- Historical plans, audits, handoffs, benchmarks, and ADR evidence are
  classified separately from active architecture.
- `docs/architecture/document-section-key-compatibility.proposed.json` is a
  runtime input to the legacy V2 profile module despite its documentation path;
  it cannot be removed until that consumer is migrated.

## Baseline checks

Fresh Node 22 evidence before target rewrites:

- text-encoding check: passed;
- product-promise registry: 6 promises passed;
- migration ordering/static safety: 25 migrations passed;
- deployment-contract tests: 46 passed;
- section-key compatibility and instruction/import tests: 43 passed;
- imported JSON parsing: all checked manifests passed except the imported
  `.devcontainer/devcontainer.json`, which contains an invalid multiline JSON
  string and is rewrite-required;
- source secret-pattern review found no private key, OpenAI key, Anthropic key,
  GitHub token, AWS key, or JWT literal. Generic literal heuristics produced
  test placeholders and validation copy that require no credential handling.

These checks characterize the source. They are not application acceptance.

## Import acceptance gate

The immutable-source import is accepted only when:

1. the generated manifest lists all 599 source paths exactly once in sorted
   order;
2. no row is `pending`;
3. exact-retained modes and blobs match the source commit;
4. every rewrite matches its reviewed recorded target blob;
5. every exclusion is absent and recoverable from the named source commit;
6. target-native files are separately reviewed;
7. the integrated import verifier, instruction authority, encoding, migration,
   deployment, secret, type, lint, test, and build gates pass under the required
   runtime;
8. the diff is reviewed without staging unrelated or ignored coordination
   state.

This gate still does not prove a signed-in workflow, persistence, export,
preview, staging, hosted provider route, or production behavior.

## Local verifier evidence

The verifier reads the named donor commit directly with `git cat-file` and
`git ls-tree`, compares the actual source origin, and rejects a missing,
duplicate, forged, or unrecorded source row. It then hashes the live target
filesystem using Git's blob algorithm, verifies exact-retained and rewritten
rows, requires exclusions to remain absent, and rejects any unrecorded
Git-versionable target-native file. Repository-relative path validation occurs
before any target read.

Run under the required runtime:

```sh
/opt/homebrew/opt/node@22/bin/node --test \
  scripts/immutable-source-import.test.mjs

/opt/homebrew/opt/node@22/bin/node \
  scripts/immutable-source-import.mjs \
  --source-repository \
  '/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED'
```

The local provenance gate proves the manifest identities and classifications
above. It does not promote the broader integrated, hosted, signed-in,
persistence, renderer, artifact-inspection, or production gates.
