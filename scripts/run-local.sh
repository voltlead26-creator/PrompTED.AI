#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.23.2 is required. Install it, then run this script again."
  exit 1
fi

NODE_VERSION="$(node -p "process.versions.node")"
if [ "$NODE_VERSION" != "22.23.2" ]; then
  echo "PrompTED requires Node 22.23.2. Current version: $NODE_VERSION"
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "Corepack is required and normally ships with Node.js 22.23.2."
  exit 1
fi

corepack enable
corepack prepare pnpm@10.33.0 --activate

if [ ! -f "apps/web/.env.local" ]; then
  if [ -f "apps/web/.env.example" ]; then
    cp apps/web/.env.example apps/web/.env.local
    echo "Created apps/web/.env.local from the example file. Configure local or dedicated non-production Supabase public values before testing signed-in features."
  else
    echo "apps/web/.env.local is missing. Create it before testing signed-in or AI features."
  fi
fi

pnpm install --frozen-lockfile

echo
printf 'PrompTED local preview: http://localhost:3000\n'
printf 'Environment safety: production Supabase is refused outside production.\n'
printf 'Press Control-C to stop it.\n\n'

pnpm dev -- --hostname 0.0.0.0
