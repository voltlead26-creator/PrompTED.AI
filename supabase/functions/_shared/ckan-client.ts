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

interface CkanResource {
  id?: string;
  name?: string;
  format?: string;
  url?: string;
  datastore_active?: boolean;
}

interface CkanDataset {
  id?: string;
  name?: string;
  title?: string;
  notes?: string;
  metadata_modified?: string;
  organization?: { title?: string };
  license_title?: string;
  resources?: CkanResource[];
}

interface CkanResponse {
  success?: boolean;
  result?: { results?: CkanDataset[] };
}

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
  body: CkanResponse,
): GovernmentDatasetSummary[] {
  const catalogue = parseCatalogue(catalogueInput);
  if (!body.success || !Array.isArray(body.result?.results)) {
    throw new Error("Government catalogue returned an invalid response.");
  }
  const config = CATALOGUES[catalogue];
  return body.result.results.slice(0, 25).map((dataset) => {
    const slug = boundedText(dataset.name || dataset.id || "unknown", 300);
    return {
      id: boundedText(dataset.id || slug, 300),
      title: boundedText(dataset.title || slug, 300),
      description: boundedText(dataset.notes, 2_000),
      publisher: boundedText(
        dataset.organization?.title || "Unknown government publisher",
        300,
      ),
      licence: boundedText(dataset.license_title || "Licence not stated", 200),
      modifiedAt: boundedText(dataset.metadata_modified, 80) || null,
      catalogue,
      catalogueLabel: config.label,
      catalogueUrl: `${config.datasetBase}/${encodeURIComponent(slug)}`,
      resources: (dataset.resources ?? [])
        .map((resource) => ({ resource, url: safeHttpUrl(resource.url) }))
        .filter((entry): entry is { resource: CkanResource; url: string } =>
          entry.url !== null
        )
        .slice(0, 10)
        .map(({ resource, url }) => ({
          id: boundedText(resource.id, 300) || null,
          name: boundedText(
            resource.name || resource.format || "Resource",
            200,
          ),
          format: boundedText(resource.format || "Unknown", 50),
          url,
          datastoreActive: resource.datastore_active === true,
        })),
    };
  });
}

export async function searchGovernmentCatalogue(input: {
  catalogue: GovernmentCatalogue;
  query: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<GovernmentDatasetSummary[]> {
  const url = buildCkanSearchUrl(
    input.catalogue,
    input.query,
    input.limit ?? 10,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      throw new CkanDispatchError(
        "Government catalogue request outcome is uncertain.",
        false,
      );
    }
    if (!response.ok) {
      throw new CkanDispatchError(
        `Government catalogue returned HTTP ${response.status}.`,
        true,
      );
    }
    try {
      return normaliseCkanDatasets(input.catalogue, await response.json());
    } catch (error) {
      if (error instanceof CkanDispatchError) throw error;
      throw new CkanDispatchError(
        "Government catalogue returned an invalid response.",
        true,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
