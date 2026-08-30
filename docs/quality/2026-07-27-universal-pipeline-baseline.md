# Universal pipeline baseline

- Base branch: `ClaudeTED.AI`
- Base commit: `4df7f922966d8e5f7a6007ffc696f98b3df2d2e1`
- Feature branch: `codex/universal-document-pipeline`
- Install: PASS with the repository-declared `pnpm@10.33.0`; the bundled pnpm 11 runner is incompatible with the committed lockfile configuration.
- Type-check: PASS for shared, web and mobile packages.
- Lint: PASS for encoding, product promises, migrations, shared, web and mobile.
- Unit tests: PASS at baseline — 97 shared and 216 web tests. Mobile reports that it has no tests in Layer 1.
- Edge Function tests after parser regression addition: PASS — 24 tests.
- Edge Function `generate-document` type-check after parser fix: PASS.
- Production build: PASS after allowing the declared Google Font download. Warnings remain for Supabase's `process.version` check in Edge Runtime and a missing `metadataBase`; neither stopped the build.
- Production deployment at baseline: Netlify deploy `6a6748458ab1657c88d42e84` is ready from the same base commit and branch, but that does not validate unmerged feature changes.
- Live generation baseline: FAIL — résumé generation returned no safe final sections. `generation_logs` recorded strict JSON parsing failure after valid model JSON.
- Expo/EAS: BLOCKED — no authenticated EAS session; committed Apple ID/team values are placeholders.

## Confirmed platform boundaries

- Canonical GitHub repository: `voltlead26-creator/PrompTED`.
- Deployment branch: `ClaudeTED.AI`.
- Supabase project: `PrompTED` (`jjsykocqpjlekgsbylkd`), active in Sydney.
- Netlify site: `pro-ted`, production URL `https://ted.littlemissscarlett.co`.
- Expo target: `apps/mobile`, currently a Layer 1 scaffold rather than a document-generation client.

## Configuration correction completed

Backend-only Supabase management credentials and the database password were removed from Netlify because the deployed web source does not consume them. Netlify retains only the required public client configuration plus explicit public runtime and secret-scan settings. GitHub environment secrets and Supabase Edge Function secrets were not changed.
