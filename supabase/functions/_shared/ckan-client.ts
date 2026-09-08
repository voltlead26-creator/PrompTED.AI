import {
  ExternalJsonError,
  fetchBoundedExternalJson,
} from "./bounded-external-json.ts";

export type GovernmentCatalogue = "australia" | "victoria";

export class CkanDispatchError extends Error {
  constructor(
    message: string,
    readonly dispatchCertain: boolean,
  ) {
    super(message);
  }
}

const CATALOGUES: Record<GovernmentCatalogue, {
  apiBase: string;
  datasetBase: string;
  label: string;
}> = {
  australia: {
    apiBase: "https://data.gov.au/data/api/3/action",
    datasetBase: "https://data.gov.au/data/dataset",
    label: "Australian Government open data",
  },
  victoria: {
    apiBase: "https://discover.data.vic.gov.au/api/3/action",
    datasetBase: "https://discover.data.vic.gov.au/dataset",
    label: "Victorian Government open data",
  },
};

const MAX_CKAN_RESPONSE_BYTES = 1024 * 1024;
const MAX_CKAN_RESOURCES = 1000;

export interface GovernmentDatasetSummary {
  id: string;
  title: string;
  description: string;
  publisher: string;
  licence: string;
  modifiedAt: string | null;
  catalogue: GovernmentCatalogue;
  catalogueLabel: string;
  catalogueUrl: string;
  resources: Array<{
    id: string | null;
    name: string;
    format: string;
    url: string;
    datastoreActive: boolean;
  }>;
}

function parseCatalogue(value: string): GovernmentCatalogue {
  if (value !== "australia" && value !== "victoria") {
    throw new Error("catalogue must be australia or victoria.");
  }
  return value;
}

function boundedText(value: string | undefined, maximum: number): string {
  return String(value ?? "").normalize("NFKC").trim().slice(0, maximum);
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value || value.length > 2_000) return null;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function ckanRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Government catalogue returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error("Government catalogue returned an invalid response.");
  }
  return value;
}

function datasetIdentity(value: string | undefined): string | undefined {
  if (value === undefined || !value.trim()) return undefined;
  // Identity is never manufactured, truncated or Unicode-normalised into a
  // different catalogue path. Display metadata retains its existing bounds.
  if (value.length > 300) {
    throw new Error("Government catalogue returned an invalid response.");
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw new Error("Government catalogue returned an invalid response.");
    }
  }
  return value.trim();
}

export function buildCkanSearchUrl(
  catalogueInput: string,
  query: string,
  limit = 10,
): string {
  const catalogue = parseCatalogue(catalogueInput);
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > 200) {
    throw new Error("query must contain between 2 and 200 characters.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("limit must be an integer between 1 and 25.");
  }
  const url = new URL(`${CATALOGUES[catalogue].apiBase}/package_search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("rows", String(limit));
  return url.toString();
}

export function normaliseCkanDatasets(
  catalogueInput: string,
  body: unknown,
  maximumResults = 25,
): GovernmentDatasetSummary[] {
  const catalogue = parseCatalogue(catalogueInput);
  const envelope = ckanRecord(body);
  const result = ckanRecord(envelope.result);
  if (
    envelope.success !== true || !Array.isArray(result.results) ||
    !Number.isInteger(maximumResults) || maximumResults < 1 ||
    maximumResults > 25 ||
    result.results.length > maximumResults ||
    (result.count !== undefined && (typeof result.count !== "number" ||
      !Number.isSafeInteger(result.count) ||
      result.count < result.results.length))
  ) {
    throw new Error("Government catalogue returned an invalid response.");
  }
  const config = CATALOGUES[catalogue];
  return result.results.map((value) => {
    const dataset = ckanRecord(value);
    const id = datasetIdentity(optionalString(dataset, "id"));
    const name = datasetIdentity(optionalString(dataset, "name"));
    const slug = name ?? id;
    if (!slug) {
      throw new Error("Government catalogue returned an invalid response.");
    }
    const organization = dataset.organization == null
      ? undefined
      : ckanRecord(dataset.organization);
    const resourceValues: unknown = dataset.resources ?? [];
    if (
      !Array.isArray(resourceValues) ||
      resourceValues.length > MAX_CKAN_RESOURCES
    ) {
      throw new Error("Government catalogue returned an invalid response.");
    }
    const resources = resourceValues.map((value) => {
      const resource = ckanRecord(value);
      const active = resource.datastore_active;
      if (active != null && typeof active !== "boolean") {
        throw new Error("Government catalogue returned an invalid response.");
      }
      const resourceName = optionalString(resource, "name");
      const format = optionalString(resource, "format");
      return {
        id: datasetIdentity(optionalString(resource, "id")) ?? null,
        name: boundedText(resourceName || format || "Resource", 200),
        format: boundedText(format || "Unknown", 50),
        url: safeHttpUrl(optionalString(resource, "url")),
        datastoreActive: active === true,
      };
    });
    return {
      id: id ?? slug,
      title: boundedText(optionalString(dataset, "title") || slug, 300),
      description: boundedText(optionalString(dataset, "notes"), 2_000),
      publisher: boundedText(
        (organization && optionalString(organization, "title")) ||
          "Unknown government publisher",
        300,
      ),
      licence: boundedText(
        optionalString(dataset, "license_title") || "Licence not stated",
        200,
      ),
      modifiedAt:
        boundedText(optionalString(dataset, "metadata_modified"), 80) || null,
      catalogue,
      catalogueLabel: config.label,
      catalogueUrl: `${config.datasetBase}/${encodeURIComponent(slug)}`,
      resources: resources.flatMap((resource) =>
        resource.url === null ? [] : [{ ...resource, url: resource.url }]
      ).slice(0, 10),
    };
  });
}

export async function searchGovernmentCatalogue(input: {
  catalogue: GovernmentCatalogue;
  query: string;
  limit?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<GovernmentDatasetSummary[]> {
  const { catalogue, query, signal, fetchImpl } = input;
  const limit = input.limit ?? 10;
  const url = buildCkanSearchUrl(
    catalogue,
    query,
    limit,
  );
  try {
    return await fetchBoundedExternalJson({
      url,
      maximumBytes: MAX_CKAN_RESPONSE_BYTES,
      timeoutMs: 8000,
      fetchImpl,
      signal,
      validate: (body) => normaliseCkanDatasets(catalogue, body, limit),
    });
  } catch (error) {
    if (error instanceof ExternalJsonError) {
      throw new CkanDispatchError(
        error.failure === "http_error"
          ? `Government catalogue returned HTTP ${error.httpStatus}.`
          : error.dispatchCertain
          ? "Government catalogue returned an invalid or interrupted response."
          : "Government catalogue request outcome is uncertain.",
        error.dispatchCertain,
      );
    }
    throw error;
  }
}
