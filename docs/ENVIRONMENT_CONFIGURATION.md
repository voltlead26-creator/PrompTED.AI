# Environment configuration

This is an operator reference for the existing loaders and deployment workflow.
The authoritative contracts remain `apps/web/next.config.ts`,
`apps/web/src/lib/supabase/public-config.ts`, `supabase/deployment-contract.json`,
`.github/workflows/deploy-prod.yml`, and `netlify.toml`.

## Where each setting belongs

| Destination | Purpose | How it is read |
| --- | --- | --- |
| `apps/web/.env.local` | Public local web configuration | Next.js loads it from the web application directory. |
| `supabase/.env.local` | Private local Edge Function configuration | Explicit local function runtime `--env-file` input; not a web input. |
| `.env.tools.local` | Local administration credentials | Explicit operator input; not automatically read by the app or GitHub. |
| GitHub Actions secrets | Production release inputs | `deploy-prod.yml` maps each `secrets.NAME` into the relevant step's environment. |
| Netlify environment settings | Public configuration for builds run directly by Netlify | Configured for the intended site and deployment context. |
| Hosted Supabase secrets | Private deployed Edge Function configuration | Read by the hosted function runtime. |

All populated local dotenv files stay Git-ignored. GitHub runners do not receive
files stored only on a developer's computer. Do not commit a populated dotenv
file to make it available during deployment.

## Local web application

Use `apps/web/.env.example` as the public variable-name reference. Keep one
assignment per variable, use comments on separate lines, and quote values when
needed. The current local file groups application environment, Supabase
connection, and optional browser integrations.

Run the app from the repository with `pnpm --filter @prompted/web dev`.
Restart the local app after changing environment settings. A deployed change to
public build settings requires rebuilding the web app.

`NEXT_PUBLIC_APP_ENV` must describe the intended data environment. A development
or preview configuration cannot use the production Supabase project. The
reviewed production project reference is injected by `next.config.ts` from the
deployment contract; do not maintain a competing value in dotenv.

## GitHub production deployment

[The production secret template](../.github/production/.env.example) lists every
secret referenced by the current production workflow. It contains empty values
and is a configuration reference, not an automatically loaded deployment file.
Use those exact names when configuring the repository's `production` environment
secrets or repository Actions secrets. The deployment jobs target the
`production` environment.

| GitHub secret | Existing workflow input |
| --- | --- |
| `PROD_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` in the web step; `SUPABASE_URL` in backend steps |
| `PROD_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `PROD_REVENUECAT_WEB_KEY` | `NEXT_PUBLIC_REVENUECAT_WEB_KEY` |
| `NETLIFY_AUTH_TOKEN` | Netlify deployment authentication |
| `NETLIFY_PROD_SITE_ID` | `NETLIFY_SITE_ID` |
| `PROD_WEB_URL` | `PRODUCTION_URL` and `PROMPTED_PRODUCTION_URL` |
| `PROD_SUPABASE_PROJECT_REF` | Exact backend deployment target |
| `PROD_SUPABASE_DB_PASSWORD` | Backend database deployment authentication |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | Privileged backend verification steps |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI authentication |

The workflow explicitly sets `NEXT_PUBLIC_APP_ENV=production` for deployment and
uses separate synthetic configuration for its initial verification job. Local
dotenv settings do not replace these workflow inputs. Optional PostHog and
Sentry values are not mapped from GitHub secrets by the current workflow.

The remaining template entries are model, routing, capacity, and evaluation
release inputs. They must identify approved records required by the existing
release checks. A formatted file cannot supply missing approval evidence.

`OPENAI_API_KEY` belongs to the Supabase function runtime. This workflow does not
upload it from local dotenv. Hosted runtime secrets and Netlify build settings
are configured separately; local reformatting changes neither service.

## Validation and current limits

From the repository root, `node scripts/check-web-build-environment.mjs` checks
web dotenv files for prohibited credentials and validates configured public
identifiers. `node --test scripts/check-web-build-environment.test.mjs` exercises
the environment guard. These checks do not prove remote secret availability,
credential validity, a successful release, or application data persistence.

On 2026-09-07 the local web configuration was repaired to use
`NEXT_PUBLIC_APP_ENV=production` with the owner-supplied production Supabase
project. The supplied REST endpoint was normalised to the project origin, and
the public anonymous key was mapped to the variable the app reads. Private
administration settings were preserved in `.env.tools.local`. This local
configuration does not publish the app or update any hosted secret store.
