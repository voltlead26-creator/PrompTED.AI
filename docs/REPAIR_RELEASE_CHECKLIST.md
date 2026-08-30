# PrompTED Repair Stack Release Checklist

This checklist is the release gate for repair phases 1–14. No repair PR should be merged or deployed unless every required item is complete or explicitly waived with a written reason.

## Merge order

Merge the stacked pull requests in numerical order:

1. PR #35 — secure, atomic imports and retained originals
2. PR #36 — import review checkpoint
3. PR #37 — reversible imported content
4. PR #38 — change provenance and product-promise registry
5. PR #39 — guest, offline and save-state clarity
6. PR #40 — output-integrity protection
7. PR #41 — truthful sync status and retry
8. PR #42 — review TED changes before applying
9. PR #43 — targeted generation recovery
10. PR #44 — evidence-based import fidelity
11. PR #45 — guest workspace migration
12. PR #46 — CI and migration validation
13. PR #47 — accessibility acceptance checks
14. Phase 14 — documentation and release discipline

After each merge, retarget the next PR to `ClaudeTED.AI` and confirm that its diff contains only the intended phase.

## Automated validation

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm check:encoding`
- [ ] `pnpm check:promises`
- [ ] `pnpm check:migrations`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Deno checks pass for repaired Edge Functions
- [ ] Deno tests pass
- [ ] GitHub Actions required checks are green on the final merged commit

## Supabase validation

- [ ] Apply migrations to a non-production Supabase project first
- [ ] Confirm the `original-documents` bucket is private
- [ ] Confirm users can read only their own original files
- [ ] Confirm `commit_document_import` is callable only by authenticated users
- [ ] Confirm a failed atomic import leaves no outcome, document or section records
- [ ] Confirm replaying the same committed upload returns existing IDs
- [ ] Confirm the updated `ingest-upload` Edge Function is deployed
- [ ] Confirm original-file cleanup runs when upload-record creation fails

## End-to-end document import

Test PDF, DOCX and plain-text files.

- [ ] Import review appears before workspace creation
- [ ] Layout warnings appear for PDFs, tables and possible columns
- [ ] Section confidence includes an explanation
- [ ] Rename, split, merge and remove controls work with keyboard only
- [ ] Confirming creates one outcome, one document and the expected sections
- [ ] The original imported content is available in version history
- [ ] The retained original file can be retrieved by its owner
- [ ] Another account cannot access the retained original

## Editing and AI trust

- [ ] Manual edits create labelled history snapshots
- [ ] TED changes are shown before replacement
- [ ] Rejecting a TED suggestion leaves the original unchanged
- [ ] Accepting a TED suggestion creates a reversible edit
- [ ] Blank, scaffold, prompt-leak and instruction-like output is rejected
- [ ] Rejected required sections appear in the recovery panel
- [ ] Targeted regeneration changes only the affected section
- [ ] Export stays blocked while required generation issues remain

## Save and migration behaviour

- [ ] Guest work clearly says it is stored on the current device only
- [ ] Signed-in edits show saving, saved and failed states accurately
- [ ] Failed sync retains the latest local copy
- [ ] Retry sync succeeds after connectivity is restored
- [ ] Older saves cannot overwrite newer edits
- [ ] Guest work migrates after sign-in
- [ ] Migration replay does not create duplicates
- [ ] Failed guest migration leaves the local copy available

## Accessibility and usability

- [ ] Automated axe checks pass
- [ ] Complete import and editing flow using keyboard only
- [ ] Test VoiceOver on iPhone and macOS
- [ ] Test at 200% browser zoom
- [ ] Test reduced-motion mode
- [ ] Verify touch targets on iPhone
- [ ] Test with at least three non-technical users
- [ ] Record confusion points and time to complete a document

## Production rollout

- [ ] Create a database backup or confirmed point-in-time recovery checkpoint
- [ ] Record the current production deployment identifier
- [ ] Deploy migrations before code that depends on them
- [ ] Deploy Edge Functions
- [ ] Deploy the web application
- [ ] Run production smoke tests with a non-admin test account
- [ ] Confirm Sentry and PostHog receive expected events without document content
- [ ] Monitor import, generation and sync failures after release

## Rollback

If the release causes data integrity, import, authentication or save failures:

1. Stop further web deployment promotion.
2. Revert the web deployment to the previous known-good release.
3. Disable or roll back the affected Edge Function.
4. Do not delete retained originals or new migration columns during an emergency rollback.
5. Preserve failed import and sync records for investigation.
6. Restore database data only when a verified backup and written recovery plan exist.
7. Document the incident and add a regression test before redeploying.
