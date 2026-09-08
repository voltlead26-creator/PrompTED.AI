# Actual Master Workspace upload browser acceptance

**Implemented; Verified locally; Workflow exercised; Persistence proven (local).**
Branch `Thought-Enhanced-Document`,HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`
plus dirty overlay. Root remains `/Users/kaichurchw/PrompTED.AI`;existing claim30
owns the implementation. No hosted/provider/native/plugin changes.

The new exclusive `--workspace-upload-browser-acceptance` mode reuses the
identified disposable database runner and all current SQL. Existing retained
read-browser upgrade mode and its unchanged-domain assertions remain separate.
The real Next production build and gateway call the real ingest/extract entry
points in two isolated Deno child processes. Auth,PostgREST,Storage,source parsers,
checkpoints,provider route/attempt/capacity/usage and upload settlement run their
production code. Only exact OpenAI Responses HTTP transport is intercepted,with
closed synthetic request/source expectations and synthetic17/9 token usage.
No model availability,quality,latency or paid cost measurement is implied.

One-worker desktop and390px browser projects use distinct owners and filenames.
Eight inputs per viewport:PDF,DOCX,AppKit RTF,UTF16LE/BE TextEdit TXT,UTF8 TXT,
Markdown and CSV. Actual chooser submissions are followed by exact receipts,
actual original link navigation,readonly preview/reload,downloaded byte equality,
same-upload replay,and changed-owner denial. PDF's first successful acknowledgement
is discarded after real settlement. Markdown review creates a workspace,opens
both sections after reload,and reconciles a repeat import to the original
destination. Independent SQL/Storage checks bind owner,upload,source text/digests,
provider admission/result/usage/egress,capacity and exact ordered document sections;
owner-wide totals detect extra stages,documents and outcomes.

Before execution,source review corrected capacity table/column and asynchronous
UI selector assumptions. Transport regression RED12pass/2fail reproduced stalled
stream cleanup and cancelled-empty-body false success;GREEN14pass after bounded
cleanup. Twelve private fixture guards pass. E2E types and root-context ESLint
pass;Deno bootstrap/entry types and bootstrap lint pass. The initial app-cwd
ESLint invocation ignored outside files and is not counted;the root invocation
actually checked them. Deno check uses supported `--deny-import --frozen`;its
initial unsupported `--cached-only` option was corrected. Runtime uses supported
`deno run --cached-only --frozen` with exact loopback network permissions.

Preflight `db-20260907153604528-36f4885b` passed with source unchanged and no
services. Final input hashes are `upload-browser-inputs.json`;the next complete
run must record its own immutable input snapshot. All child processes are owned,
bounded and cleaned up. Each service requires its own listener acknowledgement
before an HTTP readiness probe; ports are checked again immediately before
spawn,and child liveness is checked around readiness and front-door requests.
Credentials exist only in private run fixtures/child
environments and diagnostic logs are redacted. Overall runtime success requires
both workflow checks and clean child termination.

**Unverified:** actual new picker journey until this harness passes;XLSX actual
picker coverage,malformed-source/persistence/cancellation matrices,new-tab
continuation beyond the previous original-read proof,live provider execution,
CI,hosted activation,format-preserving editing and generated approved exports.
The controlled original-download artifacts are not generated exports.

## Completed execution — 8 September 2026

`job-mtrfetyh-3791d4c6` passed. The prior pending chooser statements are superseded
by `db-20260907155930992-74ef6363/completion-comparison.json`:2 browser projects
pass,16 uploads and16 controlled provider dispatches,16 independently verified
original downloads,2 exact Markdown document/outcome imports with reload and
deferred second-section reads,upload/import replay and lost-acknowledgement
recovery. Real SQL/Storage and joined accounting checks pass for every upload.
Desktop and narrow screenshots were visually inspected. Runtime execution and
cleanup pass separately; all private fixture credentials removed.

The first actual run exposed two detached Supabase SDK RPC calls. The minimal
production repairs and real-SDK RED/GREEN regressions are documented in
`Workspace-SDK-Receiver-Repair.md`; this final run verifies them in the browser.
Fresh76 migrations/2175 SQL and complete web gate379 shared/944 web tests with
lint/types/build/bundles pass.833 source hashes,HEAD,tracked diff and Docker
resources remain unchanged. This is evidence for the recorded dirty overlay,
not a published immutable release.

XLSX chooser,failure/cancellation matrix,Profile browser access,CI,live provider,
hosted deployment and format-preserving editing/export remain unverified.

The combined re-test `job-mtriiezl-ea7baaed` also passes,with full evidence in
`db-20260907172617062-91024083/completion-comparison.json`. All16 original bytes
were independently compared again;2 full upload browser projects and independent
source/accounting/Storage proofs pass. This run additionally proves basic
Profile access,temporary read failure/manual recovery,real save,reload,new tab,
owner and anonymous isolation,with independent saved-row/protected-field checks.
Fresh2175SQL and complete web379shared/951web pass. See
`Profile-Browser-Recovery-Verification.md` for the precise scope and remaining
resume lifecycle/hosted/editing/export limitations.
