import type { OllamaCreditFallbackPolicy } from "../../../packages/shared/src/document-operation.ts";
import {
  type OllamaConfiguration,
  OllamaError,
  validateOllamaConfiguration,
} from "./ollama-transport.ts";

export function configuredOllama(): OllamaConfiguration | undefined {
  const enabled = Deno.env.get("OLLAMA_CREDIT_FALLBACK_ENABLED")?.trim() ??
    "false";
  if (enabled === "false") return undefined;
  if (enabled !== "true") throw new OllamaError("OLLAMA_CONFIGURATION_INVALID");
  const environment = Deno.env.get("PROMPTED_DEPLOYMENT_ENV")?.trim() ?? "";
  // The owner requested the existing local Mac server. Hosted activation needs
  // an exact reachable endpoint and a reviewed release policy, not localhost.
  if (environment !== "local" && environment !== "test") {
    throw new OllamaError("OLLAMA_HOSTED_ACTIVATION_REQUIRED");
  }
  const config: OllamaConfiguration = {
    baseUrl: Deno.env.get("OLLAMA_BASE_URL")?.trim() ?? "",
    model: Deno.env.get("OLLAMA_MODEL")?.trim() ?? "",
    modelDigest: Deno.env.get("OLLAMA_MODEL_DIGEST")?.trim() ?? "",
    configurationVersion:
      Deno.env.get("OLLAMA_CONFIGURATION_VERSION")?.trim() ?? "",
    contextTokens: Number(
      Deno.env.get("OLLAMA_CONTEXT_TOKENS")?.trim() ?? "32768",
    ),
  };
  validateOllamaConfiguration(config, environment);
  return config;
}

export function ollamaPolicy(
  config: OllamaConfiguration,
): OllamaCreditFallbackPolicy {
  return {
    provider: "ollama",
    model: config.model,
    modelDigest: config.modelDigest,
    configurationVersion: config.configurationVersion,
  };
}

export function configurationForPolicy(
  policy: OllamaCreditFallbackPolicy,
): OllamaConfiguration {
  const config = configuredOllama();
  if (
    !config || policy.provider !== "ollama" ||
    config.model !== policy.model ||
    config.modelDigest !== policy.modelDigest ||
    config.configurationVersion !== policy.configurationVersion
  ) {
    throw new OllamaError("OLLAMA_ACCEPTED_CONFIGURATION_UNAVAILABLE");
  }
  return config;
}
