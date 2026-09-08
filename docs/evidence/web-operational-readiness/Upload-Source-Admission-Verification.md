# Master Workspace source admission and exact preview compatibility

**Implemented; Verified locally (focused and broad checks).** Branch
`Thought-Enhanced-Document`,HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the
recorded overlay in `/Users/kaichurchw/PrompTED.AI`. No staged changes,branch/worktree
switch,push,deployment,hosted migration,secret change or provider call occurred.
Root AGENTS and schema2 claims were refreshed; claim revision30 owns these paths.

## Behavior and authority

The production ingest store now explicitly requests `upload-extraction.3` for
new admission. A newly accepted receipt must identify exactly that version.
Resumed requests continue selecting the stored NULL/v1/v2/v3 reader; terminal
responses are replayed literally. SQL's omitted-version default remains.1.
The deployment contract requires112000's source-only import guard before this
function can be released. No migration implementation was changed in this slice.

The shared upload module adds an explicit metadata policy.2 and RTF at1MiB,
including canonical MIME and the exact supported historical/generic aliases.
Frozen policy.1 exports,format union,preflight and limits remain intact. The
existing API options select the metadata validator once before asynchronous byte
reads; invalid versions reject. The option is absent from all wire fields and
request/UUID hashing. Master is the only picker opted into this new policy;
Home,Profile,Find a Role and outcome attachments retain their existing formats.
Their existing inputs still use the now v3-capable server and public parser.

The public parser validates the existing `resource_policy_version` and
`extraction_format` pair,format against submitted metadata,and exact resource
and owner identity. The new source response must have the existing eight keys
(plus valid fallback provenance),exact confirmation/section shapes,and bounded
original path. It rejects unknown versions,half-pairs,private source fields,
invalid counts,blank/NUL/malformed Unicode text,format mismatches and RTF under
legacy policy. Policy.2 preview text is retained exactly,including valid leading
U+FEFF and a cut ending on whitespace. Legacy responses keep their trim rule.
The existing one same-request replay after unreadable completion is unchanged.

The actual producer normalizes raw source text before cutting its preview.
This change preserves the accepted preview; it does not claim lossless raw-text
extraction or editing. Both JavaScript and accepted SQL checkpoint use a20000
UTF-16-code-unit ingestion limit. The separate historical owner-read preview's
code-point limit is not substituted here.

Master RTF follows `preflight.format !== "text"` to original readback. No section
split,document commit,cache publication or editable navigation is performed for
RTF/PDF/DOCX/XLSX or truncated previews. Original retrieval is already proven in
the preceding browser slice; actual new-picker ingestion remains to be exercised.

## Changed files

- `packages/shared/src/ingest-upload.ts`: explicit compatible metadata policy.2.
- `packages/shared/src/api-client/index.ts`: opt-in preflight and exact source response boundary.
- `packages/shared/src/api-client/upload-source-admission.test.ts`: policy,wire,identity,Unicode,shape,replay regressions.
- `apps/web/src/app/(app)/workspace/MasterWorkspaceImport.tsx` and its test: Master picker opt-in and source-only handoff/rejection.
- `supabase/functions/ingest-upload/handler.ts`: server-owned new claim version and accepted receipt check.
- Its `source-checkpoint.test.ts`,`source-checkpoint-v3.test.ts`,`exact-replay.test.ts`: explicit request plus historical reader compatibility,actual producer cutoff and replay checks.
- `supabase/tests/upload_source_checkpoint_v3.test.sql`:8 appended stored-version/resume/unchanged-row assertions.
- `supabase/deployment-contract.json`: source-import migration prerequisite.

## Evidence and current limits

Initial shared RED:41 failures/4 passes,including absent v2 policy and malformed
response acceptance; these are feature/contract regressions,not41 independent
production defects. Master RED:3 RTF failures/23 prior passes. Focused server
admission RED:1 intended failure/46 unrelated cases filtered. Saved files are
`upload-source-admission-{shared,master,edge}-red.log`.

Current focused GREEN:153 shared in5 files including58 new admission cases;
128 ingest Edge tests;55 Master/role/outcome tests;56 adjacent Profile/Home/hook
tests. Real producer cutoff cases verify exact checkpoint text/digest and one
classification/extraction after replay. These Edge cases use controlled RPCs.
The first new client rejection tests incorrectly expected one request; tracing
confirmed the pre-existing bounded recovery allows two requests. They now prove
the same identity on both; production retry behavior was not changed.

Shared/web type checks and focused ESLint pass; ingest entry Deno types and4-file
lint pass; deployment contract validates26 functions. A type narrowing diagnostic
was fixed using the already validated preflight format,without a cast. Review
also checked explicit null-policy rejection and BOM-preserving validation.
SQL source review caught fixture immutability/lease setup errors before execution;
those now use a distinct historical NULL insert and correctly ordered timestamps.
No immutable-version guard or constraint was weakened.

Preflight `db-20260907150745623-bac3827f` passed before services. Completed
job `job-mtrdpfvn-66ddf71f` passed in approximately147 seconds. Saved detailed
results were inspected: fresh76 migrations and2175 SQL assertions across45 files;
complete `pnpm verify:web` including379 shared tests/19 files,941 web tests/113
files,lint,types,production build and progressive bundle gate; all26 Edge entry
points plus2 source helpers typecheck,28-file source lint,and1171 Edge tests
with0 failures. No skipped gate was substituted for success.

Fresh/web evidence: `db-20260907151146706-1878a43f`; Edge evidence:
`upload-source-edge-gate-20260907151329597`. The completion comparison verifies
829 source hashes,HEAD,tracked diff and Docker resources unchanged. Edge also
checks source,HEAD and web dotenv unchanged. This is a dirty-overlay local pass,
not exact-commit CI. The appended8 SQL cases are now exercised and passed.

Actual browser new uploads,live provider execution,profile browser access,CI,
production and format-preserving edits/approved exports remain **Unverified**.
Do not interpret a preserved original as an editable format-preserving document
or an inspected generated export.
