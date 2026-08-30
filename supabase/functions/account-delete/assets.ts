export interface StorageEntry {
  id: string | null;
  name: string;
}

export interface StorageListOptions {
  limit: number;
  offset: number;
  sortBy: { column: "name"; order: "asc" };
}

export interface StorageListResult {
  data: StorageEntry[] | null;
  error: unknown | null;
}

export type StorageList = (
  prefix: string,
  options: StorageListOptions,
) => Promise<StorageListResult>;

export class StorageEnumerationError extends Error {
  constructor() {
    super("Storage prefix could not be enumerated safely.");
    this.name = "StorageEnumerationError";
  }
}

function isSafePrefix(prefix: string): boolean {
  if (!prefix || prefix.startsWith("/") || prefix.endsWith("/")) return false;
  return prefix.split("/").every((part) =>
    part && part !== "." && part !== ".." && !part.includes("\0")
  );
}

function isSafeEntryName(name: unknown): name is string {
  return typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\0");
}

/**
 * Enumerates every object below one exact Storage prefix. Supabase Storage
 * returns folders as entries with a null id, so traversal and pagination both
 * have to be explicit. Malformed or failed listings stop account deletion; no
 * entry is silently skipped.
 */
export async function enumerateStoragePrefix(params: {
  rootPrefix: string;
  list: StorageList;
  pageSize?: number;
}): Promise<string[]> {
  const pageSize = params.pageSize ?? 100;
  if (
    !isSafePrefix(params.rootPrefix) || !Number.isInteger(pageSize) ||
    pageSize < 1 || pageSize > 1000
  ) {
    throw new StorageEnumerationError();
  }

  const rootBoundary = `${params.rootPrefix}/`;
  const pendingDirectories = [params.rootPrefix];
  const queuedDirectories = new Set(pendingDirectories);
  const objectPaths = new Set<string>();

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.shift()!;
    let offset = 0;

    while (true) {
      let result: StorageListResult;
      try {
        result = await params.list(directory, {
          limit: pageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      } catch {
        throw new StorageEnumerationError();
      }

      if (
        result.error || !Array.isArray(result.data) ||
        result.data.length > pageSize
      ) {
        throw new StorageEnumerationError();
      }

      for (const entry of result.data) {
        if (!entry || !isSafeEntryName(entry.name)) {
          throw new StorageEnumerationError();
        }

        const path = `${directory}/${entry.name}`;
        if (!path.startsWith(rootBoundary)) {
          throw new StorageEnumerationError();
        }

        if (entry.id === null) {
          if (!queuedDirectories.has(path)) {
            queuedDirectories.add(path);
            pendingDirectories.push(path);
          }
        } else if (typeof entry.id === "string" && entry.id.length > 0) {
          objectPaths.add(path);
        } else {
          throw new StorageEnumerationError();
        }
      }

      if (result.data.length < pageSize) break;
      offset += result.data.length;
    }
  }

  return [...objectPaths].sort();
}
