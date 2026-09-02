// =====================================================
// PrompTED — PTV Timetable API client
// Credentials are read only from Supabase Edge Function secrets.
// =====================================================

const PTV_BASE_URL = "https://timetableapi.ptv.vic.gov.au";
const encoder = new TextEncoder();

export type PtvQueryValue = string | number | boolean | null | undefined;

export interface PtvClientConfig {
  developerId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class PtvConfigurationError extends Error {}

export class PtvDispatchError extends Error {
  constructor(
    message: string,
    readonly dispatchCertain: boolean,
  ) {
    super(message);
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function buildPtvRequestPath(
  path: string,
  developerId: string,
  query: Record<string, PtvQueryValue> = {},
): string {
  if (!path.startsWith("/v3/")) {
    throw new Error("PTV path must start with /v3/.");
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  params.set("devid", developerId);

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function signPtvRequestPath(
  requestPath: string,
  apiKey: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(requestPath),
  );
  return bytesToHex(signature);
}

export async function buildSignedPtvUrl(
  path: string,
  developerId: string,
  apiKey: string,
  query: Record<string, PtvQueryValue> = {},
): Promise<string> {
  const requestPath = buildPtvRequestPath(path, developerId, query);
  const signature = await signPtvRequestPath(requestPath, apiKey);
  return `${PTV_BASE_URL}${requestPath}&signature=${signature}`;
}

export class PtvClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: PtvClientConfig) {
    if (!config.developerId.trim() || !config.apiKey.trim()) {
      throw new PtvConfigurationError("PTV credentials are not configured.");
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async get<T>(
    path: string,
    query: Record<string, PtvQueryValue> = {},
  ): Promise<T> {
    const url = await buildSignedPtvUrl(
      path,
      this.config.developerId,
      this.config.apiKey,
      query,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PtvDispatchError("PTV request outcome is uncertain.", false);
    }

    if (!response.ok) {
      throw new PtvDispatchError(`PTV returned HTTP ${response.status}.`, true);
    }

    try {
      return await response.json() as T;
    } catch {
      throw new PtvDispatchError("PTV returned an invalid response.", true);
    }
  }
}

export function ptvClientFromEnv(): PtvClient {
  const developerId = Deno.env.get("PTV_DEVELOPER_ID") ?? "";
  const apiKey = Deno.env.get("PTV_TIMETABLE_KEY") ?? "";
  return new PtvClient({ developerId, apiKey });
}
