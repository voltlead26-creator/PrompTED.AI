# Run PrompTED locally

This preview runs from the existing PrompTED.AI checkout and does not consume
Netlify credits. It must use local Supabase or a dedicated non-production
Supabase project; the application refuses to connect a local/preview build to
the reviewed production project.

## First-time setup

From the existing repository root:

```bash
cd /path/to/PrompTED.AI
chmod +x scripts/run-local.sh
./scripts/run-local.sh
```

The runner does not fetch, pull, switch branches, create a worktree, or copy
files from the historical PrompTED checkout.

Open [http://localhost:3000](http://localhost:3000) after the terminal says the development server is ready.

## Environment variables

The runner creates `apps/web/.env.local` from `apps/web/.env.example` when
needed. Configure either a local Supabase instance or a dedicated
non-production project:

```text
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your Supabase anon key
```

Stable `/api/*` paths run through the same reviewed Next.js gateway locally and
on Netlify. The gateway derives its function allowlist from the deployment
contract and never needs an OpenAI key in the browser or Next.js environment.
Reuse the existing OpenAI key only in its protected Supabase secret store; do
not copy it into `.env.local`.

Basic public interface work can be inspected without a running Supabase stack.
Authentication, persistence, generation, approval, and export require the
matching non-production Supabase migrations and functions and must not be
claimed from a rendered shell alone.

## Stop the preview

Press `Control-C` in the terminal window running PrompTED.

## View from an iPhone on the same Wi-Fi

If the selected non-production origin and its allowed-origin policy permit LAN
access, find the Mac's local IP address:

```bash
ipconfig getifaddr en0
```

Then open `http://MAC-IP-ADDRESS:3000` on the iPhone. The Mac firewall may ask permission for Node to accept incoming connections.
