# TED unified pipeline rollout

## Release gate

The v2 pipeline is disabled unless both `TED_PIPELINE_V2_WORKFLOWS` contains the workflow and `TED_PIPELINE_V2_ROLLOUT_PERCENT` includes the outcome's deterministic cohort.

Before increasing rollout:

1. Apply both artifact migrations in staging.
2. Run Supabase database lint and advisors.
3. Verify RLS with two authenticated test users and an anonymous client.
4. Deploy `generate-artifact`, then the web application.
5. Test recommendation, document generation, action plan, checklist, refinement, completion preservation and export.
6. Confirm generation success, validation failures, repair rate, latency and token use contain no document content.
7. Increase cohorts in order: internal, 5%, 25%, 50%, 100%.

## Rollback

Set `TED_PIPELINE_V2_ROLLOUT_PERCENT=0` or remove the workflow from `TED_PIPELINE_V2_WORKFLOWS`, then redeploy `generate-artifact`. The web application will fall back to the legacy endpoint. Do not reverse the expand-only migrations. Dual-written checklist state remains available to both versions.

## Required production evidence

- AI success above 97% excluding valid input errors.
- No artifact returned after failed final validation.
- No external-content dependency in controlled action fixtures.
- No cross-user artifact access.
- No partial writes or lost completion state.
- First visible status within two seconds and total generation below 120 seconds.
- No serious or critical accessibility violations.
- Type-check, lint, tests and production build pass from the same commit.

## Environment limitation found during implementation

The implementation host cannot execute the committed `esbuild` binary because its macOS version lacks symbols required by binaries built for macOS 12. Run Vitest and the production build through the Linux CI workflow or a macOS 12+ development machine. Local Supabase migration execution also requires Docker; rollout must remain disabled until staging database verification passes.
