# PrompTED repair-stack validation

The repair branches must be merged in numerical order. Do not merge a later stacked PR before its base phase.

## Automated gate

The `Repair Stack CI` workflow must pass:

- migration integrity checks
- text-encoding guard
- product-promise registry validation
- lint
- TypeScript type-check
- unit and component tests
- production build

## Supabase development validation

Before the stack reaches production:

1. Apply all migrations to a development Supabase project.
2. Confirm the `original-documents` bucket is private.
3. Confirm users can read only their own original documents.
4. Deploy the updated `ingest-upload` Edge Function.
5. Import an authenticated PDF and DOCX.
6. Confirm the upload progresses from `ready` to `committed`.
7. Confirm outcome, document and sections are created atomically.
8. Retry the same committed upload and confirm no duplicate workspace is created.
9. Force a section-write failure and confirm the transaction rolls back.
10. Confirm the original document remains retained after workspace edits.

## Browser validation

Test in desktop and mobile browsers:

- guest import and local-only notice
- signup followed by guest-workspace migration
- partial migration failure and retry
- offline editing and later account sync
- sync failure and retry
- TED before-and-after acceptance and rejection
- invalid generated output and targeted section regeneration
- keyboard-only import review
- screen-reader labels for warnings, recovery states and dialogs

## Release gate

Production release is blocked until:

- every stacked PR has a green required workflow
- Supabase development validation is signed off
- authenticated end-to-end import succeeds
- no required section is blank
- export remains blocked for unresolved generation issues
- rollback steps for the migration and Edge Function are documented
