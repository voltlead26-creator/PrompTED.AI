import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../next.config";

describe("Next.js content security policy", () => {
  it("permits the Fast Refresh evaluator only in the development runtime", () => {
    const development = contentSecurityPolicy({
      appEnvironment: "local",
      nodeEnvironment: "development",
      supabaseUrl: "http://127.0.0.1:54321",
    });
    const production = contentSecurityPolicy({
      appEnvironment: "production",
      nodeEnvironment: "production",
      supabaseUrl: "https://jjsykocqpjlekgsbylkd.supabase.co",
    });

    expect(development).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(development).toContain("http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(development).not.toContain("upgrade-insecure-requests");
    expect(production).toContain("script-src 'self' 'unsafe-inline';");
    expect(production).not.toContain("'unsafe-eval'");
    expect(production).toContain("upgrade-insecure-requests");
  });
});
