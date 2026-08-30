export type GovernmentCatalogue = "australia" | "victoria";

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
  return body.result.results.map((dataset) => {
    const slug = dataset.name || dataset.id || "unknown";
    return {
      id: dataset.id || slug,
      title: dataset.title || slug,
      description: dataset.notes || "",
      publisher: dataset.organization?.title || "Unknown government publisher",
      licence: dataset.license_title || "Licence not stated",
      modifiedAt: dataset.metadata_modified || null,
      catalogue,
      catalogueLabel: config.label,
      catalogueUrl: `${config.datasetBase}/${encodeURIComponent(slug)}`,
      resources: (dataset.resources ?? [])
        .filter((resource) => typeof resource.url === "string" && resource.url.length > 0)
        .slice(0, 10)
        .map((resource) => ({
          id: resource.id ?? null,
          name: resource.name || resource.format || "Resource",
          format: resource.format || "Unknown",
          url: resource.url as string,
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
  const url = buildCkanSearchUrl(input.catalogue, input.query, input.limit ?? 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Government catalogue returned HTTP ${response.status}.`);
    }
    return normaliseCkanDatasets(input.catalogue, await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
