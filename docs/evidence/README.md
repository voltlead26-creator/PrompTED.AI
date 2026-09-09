# Verification evidence and local archive

The maintained web application remains in `/Users/kaichurchw/PrompTED.AI` on
`Thought-Enhanced-Document`. Executable source stays in its existing directories
so imports, package boundaries and deployment commands keep their stable paths:

| Path | Purpose |
| --- | --- |
| `apps/web/` | Next.js UI, web gateway and browser configuration |
| `packages/shared/` | Shared API, document and operation contracts |
| `supabase/functions/`, `supabase/migrations/`, `supabase/tests/` | Backend code, ordered schema changes and database acceptance |
| `scripts/`, `.github/workflows/`, `netlify.toml` | Verification and release tooling |
| `tests/e2e/`, `playwright.config.ts` | Browser workflows and configuration |
| `docs/evidence/web-operational-readiness/` | Maintained acceptance harnesses, contract fixtures, current reports and current release evidence |

## Local consolidation on 9 September 2026

Historical generated outputs were consolidated outside the production checkout:

`/Users/kaichurchw/PrompTED.AI-local-archive/2026-09-09/`

The archive contains **142 completed run directories and 541 loose historical
logs/patches: 9,573 files, 494,118,131 bytes**. Original repository-relative paths
are preserved under that directory. For an older report's raw-evidence path,
look at the original location first, then the same relative path under the
archive. `manifest.json` records each original path, size and SHA-256; every
archived file was hashed again after moving. The archive is local evidence and
is not part of the deployed site or a replacement checkout.

Tracked application source and pending tracked changes were byte-for-byte
unchanged by consolidation. Historical manifests and runs referenced by
maintained executable acceptance code or baseline contracts were retained.
Today's release runs, current source/format-preservation work, personal sample
documents, skills and coordination records were also retained. Two Finder
metadata files and an empty root `.next/` directory were removed. The actual web
build output remains `apps/web/.next/`.

Existing dotenv files were not moved or published. Runtime environments remain
in their existing ignored consumer-specific locations. This cleanup does not
change application functionality or establish deployment acceptance.

## Current release evidence

- [Upload source preparation](web-operational-readiness/Upload-Source-Preparation-20260909.md)
  describes the repair pushed in `4b0238e`; it distinguishes original retention
  and text import from unfinished formatting-preserving editing.
- [Dependency patch verification](web-operational-readiness/Web-Dependency-Patches-20260909.md)
  records the security patches, passed checks and repaired browser launcher.
- [Production release prerequisites](web-operational-readiness/Production-Release-Prerequisites-20260908.md)
  records a dated readiness snapshot; targets, configuration and hosted state
  must be refreshed before deployment.

Keep concise reviewed reports, runnable harnesses and required fixtures in the
repository. Completed raw runs belong in the local archive or the corresponding
CI artifact store once they are no longer required by executable checks.
