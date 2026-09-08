import { deepStrictEqual, strictEqual, throws } from "node:assert";
import {
  configurationForPolicy,
  configuredOllama,
  ollamaPolicy,
} from "./ollama-configuration.ts";

const environment = {
  PROMPTED_DEPLOYMENT_ENV: "test",
  OLLAMA_CREDIT_FALLBACK_ENABLED: "true",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "gpt-oss:20b",
  OLLAMA_MODEL_DIGEST: "a".repeat(64),
  OLLAMA_CONFIGURATION_VERSION: "local.1",
  OLLAMA_CONTEXT_TOKENS: "8192",
};
function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}
Deno.test("Ollama is disabled by default and only explicitly valid local configuration activates it", () => {
  withEnv(
    { ...environment, OLLAMA_CREDIT_FALLBACK_ENABLED: undefined },
    () => strictEqual(configuredOllama(), undefined),
  );
  withEnv(environment, () => {
    const config = configuredOllama();
    if (!config) throw new Error("Expected local configuration");
    strictEqual(config.apiKey, undefined);
    deepStrictEqual(configurationForPolicy(ollamaPolicy(config)), config);
    throws(
      () =>
        configurationForPolicy({
          ...ollamaPolicy(config),
          modelDigest: "b".repeat(64),
        }),
      /OLLAMA_ACCEPTED_CONFIGURATION_UNAVAILABLE/,
    );
  });
});
Deno.test("Ollama cannot activate a local URL in a hosted deployment", () => {
  for (const deployment of ["production", "staging", "preview", ""]) {
    withEnv(
      { ...environment, PROMPTED_DEPLOYMENT_ENV: deployment },
      () => throws(configuredOllama, /OLLAMA_HOSTED_ACTIVATION_REQUIRED/),
    );
  }
  withEnv(
    { ...environment, OLLAMA_CREDIT_FALLBACK_ENABLED: "yes" },
    () => throws(configuredOllama, /OLLAMA_CONFIGURATION_INVALID/),
  );
});
