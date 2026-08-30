import { afterEach, describe, expect, it } from "vitest";
import { getPublicSupabaseConfig } from "./public-config";

const ORIGINAL_ENV = { ...process.env };
const PRODUCTION_REF = "jjsykocqpjlekgsbylkd";
const PREVIEW_REF = "abcdefghijklmnopqrst";

function configure(values: Record<string, string | undefined>) {
  process.env.NEXT_PUBLIC_PRODUCTION_SUPABASE_PROJECT_REF = PRODUCTION_REF;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-value";
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("public Supabase environment binding", () => {
  it("accepts the reviewed production project only in production", () => {
    configure({
      NEXT_PUBLIC_APP_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    });

    expect(getPublicSupabaseConfig()).toMatchObject({
      appEnvironment: "production",
      projectRef: PRODUCTION_REF,
    });
  });

  it("fails closed when preview traffic points at production", () => {
    configure({
      NEXT_PUBLIC_APP_ENV: "deploy-preview",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    });

    expect(() => getPublicSupabaseConfig()).toThrow(
      "A non-production web build cannot connect to the production Supabase project.",
    );
  });

  it("accepts a distinct cloud project for preview", () => {
    configure({
      NEXT_PUBLIC_APP_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
    });

    expect(getPublicSupabaseConfig().projectRef).toBe(PREVIEW_REF);
  });

  it("accepts an explicit local Supabase origin only in local modes", () => {
    configure({
      NEXT_PUBLIC_APP_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    });
    expect(getPublicSupabaseConfig().url).toBe("http://127.0.0.1:54321");

    configure({ NEXT_PUBLIC_APP_ENV: "staging" });
    expect(() => getPublicSupabaseConfig()).toThrow(
      "Preview, staging, and production builds cannot use a local Supabase origin.",
    );
  });

  it("rejects credentials, paths, query strings, and deceptive hosts", () => {
    for (const url of [
      `https://user:password@${PREVIEW_REF}.supabase.co`,
      `https://${PREVIEW_REF}.supabase.co/functions/v1`,
      `https://${PREVIEW_REF}.supabase.co?redirect=1`,
      `https://${PREVIEW_REF}.supabase.co.attacker.example`,
    ]) {
      configure({ NEXT_PUBLIC_APP_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: url });
      expect(() => getPublicSupabaseConfig()).toThrow();
    }
  });

  it("requires an explicit deployment environment for production-mode builds", () => {
    configure({
      NEXT_PUBLIC_APP_ENV: undefined,
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    });

    expect(() => getPublicSupabaseConfig()).toThrow("NEXT_PUBLIC_APP_ENV");
  });
});
