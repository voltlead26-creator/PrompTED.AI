# Seven Primary Destinations Slice

Status: `verified`

## Scope

This slice extracts only the protected application-navigation contract from PR #100 onto the current `ClaudeTED.AI` production baseline.

The persistent desktop rail and mobile drawer expose, in order:

1. Home (`/home`)
2. Master Workspace (`/workspace`)
3. My Work (`/library`)
4. Checklists / Action Plans (`/plans`)
5. Find a Job (`/roles`)
6. Profile (`/settings/profile`)
7. Settings (`/settings`)

Creation remains secondary and exposes Document, Checklist / Action Plan, and Upload to Master Workspace actions. The shared navigation contract also supplies protected-route page titles and ensures nested outcome routes map to Master Workspace while Profile remains distinct from Settings.

## Explicit exclusions

The slice does not include PR #100's Plans editor, Profile resource store, resume lifecycle, document-generation recovery, Master Workspace changes, Find a Job redesign, database migrations, or acceptance workflow. Those remain on PR #100 for later independent slices.

## Verification

- Navigation contract test demonstrated the production gap first: 3/3 assertions failed against `ClaudeTED.AI` before implementation.
- Focused navigation and shell tests: 18/18 passed.
- TypeScript: passed across all workspaces.
- Lint and repository policy checks: passed with zero lint warnings.
- Repository tests: 349/349 passed (98 shared, 251 web; mobile Layer 1 reports no tests).
- Production build: passed and emitted all seven destination routes.
- `git diff --check`: passed.

The first parallel full-suite run had one unrelated BrowseModal axe timeout while type-check and lint were running concurrently. The timed-out test passed 4/4 in isolation, and the complete repository suite then passed when rerun serially.

## Review gates

- Builder: `PASS` — the diff is limited to navigation, tested, type-safe, lint-clean and buildable.
- UI: `PASS` — all destinations remain available in desktop and mobile navigation, active state is accessible, and the shell axe test passes.
- Product Identity: `PASS` — the seven approved destinations remain primary and Create remains secondary.

## Rollback

Reverting this slice restores the four-item production navigation without affecting destination data, Supabase schema, document generation, or the remaining PR #100 work.
