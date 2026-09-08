# Local environment correction and deployed Profile/upload incident

8 September 2026, Australia/Melbourne. Branch `Thought-Enhanced-Document`,
HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the existing dirty overlay.
This report records local configuration changes and the independently applied
Profile permission repair. It does not claim full production acceptance.

## Implemented and verified locally

The owner explicitly selected `/Users/kaichurchw/PrompTED.AI/apps/web/.env.local`
and requested reconfiguration. That exact file remains the local web source.
On this turn it contained private/provider/operator settings, duplicated names,
and lacked the required public aliases. The real security guard rejected it;
the previous successful build used different dotenv bytes.

The reviewed one-time `reconfigure-local-env-20260908.mjs` used the installed
Next.js dotenv parser to resolve the selected source, including its duplicate
assignments. It classified existing settings into the existing three files:

- `apps/web/.env.local`: five validated `NEXT_PUBLIC_*` web settings, including
  the project-bound public Supabase credential and `/api` gateway.
- `supabase/.env.local`: private backend runtime. The selected source's OpenAI
  key replaces the previous local key. Its `NEXT_OPENAI_*` aliases map to the
  actual existing `OPENAI_*` consumer names; all model/policy values match the
  previous runtime. Existing local fallback settings are preserved.
- `.env.tools.local`: operator settings. The selected source's Next-resolved
  Netlify token replaces the previous local token. Other effective operator
  values remain equal; the public-anon compatibility alias is retained.

Exact original bytes of all three files are preserved in the ignored private
directory `.env.local-reconfigure-20260908T0831/` as `original-0`, `original-1`,
and `original-2`, respectively. Directory mode is0700; originals and rewritten
files are0600. No credential values were printed, sent to a provider, rotated
remotely, or entered into hosted configuration.

All known source/destination values were privately compared before mutation.
Both Node and Next parsed the candidate web values identically. The script
checks whole-file hashes before replacement and verifies final and backup
hashes. Each rename is atomic; the three-file update is not a transaction or
an operating-system compare-and-swap. This run completed all three writes with
exact backup verification. A failed run would retain the actual applied-path
list and originals, rather than automatically restoring over a later edit.

Post-apply real security guard PASS; all14 guard regressions PASS. A fresh
installed Next loader independently loads exactly the requested `.env.local`
and resolves all five web settings identically. Guard/parser source is unchanged.
Exact local metadata: `local-env-reconfigure-20260908-apply.jsonl`.

Full web verification plus a separate production build that reads the real
configured dotenv (without synthetic or inherited public overrides) **passed**
in job `job-mtsf8idg-6c75df46` (53.5 seconds, exit0). All13 recorded steps passed;
HEAD, tracked diff and all three environment hashes stayed unchanged. Evidence:
`env-reconfigured-gate-20260908084222203/summary.json`.
The full standard web gate still uses its deliberate synthetic verification
identity; it must not be presented as production credentials/workflow proof.

## Current hosted observation

The freshly read Netlify production deployment is
`6a9fc526610f2efb8c05454f`, site `f278cbcf-0161-43f7-a132-fd224aef2d9f`,
project `aiprompted`, serving `https://ted.littlemissscarlett.co`.
It was published at18:22:08 AEST on8September from commit `e1d514d`.
Its ready status describes deployment of that old commit; the uncommitted local
upload/Profile repairs are not included in its reported revision.

Before the permission repair, Supabase `jjsykocqpjlekgsbylkd` contained67 migrations
through `20260905000000` and25 functions. `ingest-upload` remains version328;
`extract-upload`, `document-operation`, and `brand-logo` are absent. The last
two are separate workflow dependencies, not prerequisites for Profile reads.
Before that repair, authenticated users had neither table nor column SELECT privilege on
`public.uploads`; RLS is enabled. That is the missing dependency of Profile's
existing `uploads!inner` resume-resource read. This is catalog evidence and a
source-confirmed failure condition, not a new authenticated production replay.

The inspected nine-migration local overlay, in version order, was:

1. `20260906000500_captured_exact_wording_assessment.sql`
2. `20260906010846_profile_resume_upload_reads.sql` — applied at18:48:07 AEST on8September
3. `20260906160000_upload_source_checkpoint_v2.sql`
4. `20260907053000_ollama_credit_fallback.sql`
5. `20260907081500_upload_source_checkpoint_v3.sql`
6. `20260907094500_upload_rtf_mime_alias.sql`
7. `20260907102000_upload_fallback_settlement.sql`
8. `20260907112000_upload_source_import_boundary.sql`
9. `20260907124000_workspace_upload_reads.sql`

The narrow Profile grant proposal remains concrete in `Profile-Permission-Release.md`:
six-column authenticated SELECT under existing owner RLS; no anonymous grant,
table-wide SELECT, direct-write grant, policy replacement or user-row change.
Its unchanged local migration has real two-owner Auth/PostgREST and pgTAP proof.

Current upload release ordering is compatible schema first, internal extraction
function next, current ingest function next, and verified web revision with its
retained-upload read RPCs. A browser-only redeployment cannot install these
dependencies. Applying the9-file schema bundle still needs its exact release
and upgrade acceptance; the narrow Profile repair is independently reviewable.

Original read-only observations remain in `hosted-incident-20260908.json`.
The owner subsequently explicitly authorised upload and release to the confirmed
repository, branch and hosted targets. The exact Profile migration was dry-run,
applied with its original version, and independently checked: hosted count68,
only the six intended column grants, unchanged RLS and denied private columns.
The signed-in production Profile was then opened successfully, including its
existing resume resource. No personal values were saved in evidence. Existing
native Supabase CLI login was used because the selected local operator token
was not valid for that CLI. No new web deployment, function deployment, paid
model call or hosted secret change occurred during this repair.

## Remaining gates

**Blocked/unverified:** repaired immutable release revision and its CI; matching
hosted schema/functions and production configuration; actual authenticated
Profile/upload/reload/original-download acceptance on the released revision;
source-preserving Word/PDF browser editing, approval and export integration;
the remaining full-app integrity, catalogue and evaluated-provider gates.

The local configuration correction does not resolve the observed production
revision/schema mismatch. Earlier local browser and persistence evidence is
retained and remains separate from hosted proof.

## Account and workspace recheck at19:07 AEST

The account owning the browser's failing outcome is confirmed and unbanned,
has a profile, and has effective **Business** entitlement from the existing
subscription authority. The server cap is1000/month; `profiles.plan` is a stale
legacy field and does not control that result. Unrestricted owner access is
newly requested but has not been implemented or claimed.

A read-only transaction using role `authenticated` and the exact owner identity
returned `workspace-snapshot.v1` with matching owner for the displayed failing
outcome. That outcome currently has no attached document, which is a supported
intake state. This proves the server read contract for that outcome; it does not
prove every historical document. The deployed loader detaches the SDK RPC method
and can throw before HTTP dispatch. The local receiver repair and real-SDK
regression are documented in `Workspace-SDK-Receiver-Repair.md`.

Production has zero enabled captured assignment/pointer pairs and zero
potentially resumable captured operations in the metadata query. All four
production OpenAI route/capacity records remain absent. A read-only models-list
request using the selected local OpenAI credential returned200 and listed the
three requested model IDs; this establishes access only, not reviewed output,
capacity, budget, latency or evaluation fingerprints.
