import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");
const deploymentContract = JSON.parse(
  readFileSync(path.join(repoRoot, "supabase/deployment-contract.json"), "utf8"),
) as { projectRef?: string };
if (!deploymentContract.projectRef || !/^[a-z0-9]{20}$/.test(deploymentContract.projectRef)) {
  throw new Error("supabase/deployment-contract.json must name the reviewed production project.");
}

function configuredSupabaseConnectSources(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return [];
    const webSocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [url.origin, `${webSocketProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

const connectSources = [
  "'self'",
  ...configuredSupabaseConnectSources(),
  "https://*.ingest.sentry.io",
  "https://*.posthog.com",
];
const upgradeInsecureRequests = ["production", "preview", "deploy-preview", "staging"].includes(
  process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() ?? "",
)
  ? "; upgrade-insecure-requests"
  : "";

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src " +
      `${connectSources.join(" ")}${upgradeInsecureRequests}`,
  },
];

const PRIVATE_HEADERS = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Vary", value: "Authorization, Cookie" },
];

const AUTHENTICATED_ROUTE_SOURCES = [
  "/home",
  "/create",
  "/library",
  "/workspace",
  "/outcomes/:path*",
  "/plans/:path*",
  "/roles",
  "/find-a-role",
  "/settings/:path*",
  "/sign-out",
  "/api/:path*",
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@prompted/shared"],
  env: {
    NEXT_PUBLIC_PRODUCTION_SUPABASE_PROJECT_REF: deploymentContract.projectRef,
  },
  // Keep AI provider keys server-side only — never expose to client bundle
  serverExternalPackages: ["@supabase/supabase-js"],
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      ...AUTHENTICATED_ROUTE_SOURCES.map((source) => ({
        source,
        headers: PRIVATE_HEADERS,
      })),
    ];
  },
};

export default nextConfig;
