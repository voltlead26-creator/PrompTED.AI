# Repository folders and local reference material

The maintained web application lives in this repository on `Thought-Enhanced-Document`. The root `AGENTS.md` remains the instruction authority. This guide explains file locations; it does not introduce another workflow or application contract.

| Folder | Purpose |
| --- | --- |
| `apps/web` | Next.js application, UI tests and browser fixtures |
| `packages/shared` | Shared types, contracts, API client and validation |
| `supabase/functions` | Server-side orchestration, provider integration and function tests |
| `supabase/migrations`, `supabase/tests` | Implemented database changes and database regression tests |
| `scripts`, `.github/workflows` | Repeatable verification and controlled release commands |
| `docs/plans` | Design decisions and planned work; a plan does not establish implementation |
| `docs/evidence` | Reviewed verification reports and canonical acceptance harnesses |
| `.local/reference/maps` | Local HTML architecture and clarification maps, excluded from releases |
| `.local/reference/documents` | Loose user reference documents, preserved without alteration |
| `.local/archive` | Private historical verification archive and original-path/hash manifest |
| `.local/verification` | Current local audit logs, manifests and cleanup receipts |
| `.agents`, `skills-lock.json` | Machine-installed agent tooling; excluded from application publication |

Environment files and their recovery backups remain at their existing ignored locations. Installed dependencies, build directories, the Docker virtual disk and coordination metadata retain their tool-defined paths.

## Audited atlas reference

The owner supplied `/Users/kaichurchw/Documents/Codex/2026-09-10/can-3/outputs/PrompTED-audited-atlas-bundle` as reference. Its audit covers all 1,049 tracked files at `0b9dbc1aeb07dddc43398d598fd05bfd64606ebc`. It is an immutable baseline and excludes the later workspace-guidance overlay. Consult its `atlas-audit-report.md`, `atlas-verification.json` and `prompted-app-source-manifest.json`; a later Git commit does not update that atlas automatically.

The loose HTML maps are preserved as references, with their original hashes recorded in the local cleanup receipt. They are not assumed to be byte-identical to the audited atlas or authoritative descriptions of a later revision.

## Historical local evidence

The September 2026 cleanup consolidates untracked historical evidence into `.local/archive/historical-verification-20260911.zip`. It stores each distinct byte sequence once under `objects/<sha256>`. `manifest.json` maps every original repository-relative path to its hash, size and mode. All archived bytes are verified before their loose originals are removed. Tracked reports and canonical test harnesses remain in place. The archive is local and private, not a GitHub release input.

To recover one historical file, inspect the manifest, locate its `objects/<sha256>` entry, and write it to a new chosen destination. Avoid extracting over newer application or evidence files. The cleanup receipt is `.local/verification/github-sync-20260911/cleanup.json`.

## Explicitly unfinished work

The local-only `supabase/migrations/20260910060401_dormant_docx_source_binding.sql` is an empty placeholder. Its companion `supabase/tests/docx_source_binding.test.sql` describes a missing `prepare_docx_source_document_v1` command. Both remain in their original locations for the next implementation task and are excluded from this publication. They are not accepted database functionality. The separately owned owner-access design document also remains local and unchanged.

GitHub parity concerns reviewed application source and its required tests/configuration. It does not require uploading private environments, installed tooling, generated output, reference documents or unfinished work.
