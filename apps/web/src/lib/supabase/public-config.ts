export type PromptedAppEnvironment =
  | "local"
  | "development"
  | "test"
  | "preview"
  | "deploy-preview"
  | "staging"
  | "production";

export interface PublicSupabaseConfig {
  appEnvironment: PromptedAppEnvironment;
  anonKey: string;
  projectRef: string | null;
  url: string;
}

const CLOUD_PROJECT_HOST = /^([a-z0-9]{20})\.supabase\.co$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_ENVIRONMENTS = new Set<PromptedAppEnvironment>([
  "local",
  "development",
  "test",
  "preview",
  "deploy-preview",
  "staging",
  "production",
]);

function configuredEnvironment(): PromptedAppEnvironment {
  const explicit = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  const fallback =
    process.env.NODE_ENV === "test"
      ? "test"
      : process.env.NODE_ENV === "development"
        ? "development"
        : "";
  const value = explicit || fallback;
  if (!ALLOWED_ENVIRONMENTS.has(value as PromptedAppEnvironment)) {
    throw new Error(
      "NEXT_PUBLIC_APP_ENV must explicitly identify local, development, test, preview, deploy-preview, staging, or production.",
    );
  }
  return value as PromptedAppEnvironment;
}

function productionProjectRef(): string {
  const value = process.env.NEXT_PUBLIC_PRODUCTION_SUPABASE_PROJECT_REF?.trim();
  if (!value || !/^[a-z0-9]{20}$/.test(value)) {
    throw new Error("The reviewed production Supabase project identity is unavailable.");
  }
  return value;
}

function isPlaceholder(value: string): boolean {
  return /(?:your-|replace|build-only|example)/i.test(value);
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  const appEnvironment = configuredEnvironment();
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!rawUrl || !anonKey) {
    throw new Error("The public Supabase URL and anonymous key are required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an absolute URL.");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must contain only an approved origin.");
  }

  const cloudProjectRef =
    parsed.protocol === "https:"
      ? parsed.hostname.match(CLOUD_PROJECT_HOST)?.[1] ?? null
      : null;
  const isLocal =
    parsed.protocol === "http:" &&
    LOCAL_HOSTS.has(parsed.hostname) &&
    parsed.port.length > 0;
  const isSyntheticTest =
    appEnvironment === "test" &&
    parsed.protocol === "https:" &&
    parsed.hostname === "example.supabase.co";

  if (!cloudProjectRef && !isLocal && !isSyntheticTest) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be an exact HTTPS Supabase project origin or an explicit local Supabase origin.",
    );
  }
  if (isLocal && !["local", "development", "test"].includes(appEnvironment)) {
    throw new Error("Preview, staging, and production builds cannot use a local Supabase origin.");
  }

  const reviewedProductionRef = productionProjectRef();
  if (appEnvironment === "production") {
    if (cloudProjectRef !== reviewedProductionRef) {
      throw new Error("The production web build is not bound to the reviewed production Supabase project.");
    }
    if (isPlaceholder(anonKey)) {
      throw new Error("The production web build cannot use a placeholder Supabase anonymous key.");
    }
  } else if (cloudProjectRef === reviewedProductionRef) {
    throw new Error("A non-production web build cannot connect to the production Supabase project.");
  }

  return {
    appEnvironment,
    anonKey,
    projectRef: cloudProjectRef,
    url: parsed.origin,
  };
}
