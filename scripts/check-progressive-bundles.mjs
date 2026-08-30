#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_MANIFEST = "apps/web/.next/app-build-manifest.json";
const LOADABLE_MANIFEST = "apps/web/.next/react-loadable-manifest.json";

const RULES = [
  {
    label: "home template browser",
    route: "/(app)/home/page",
    module: "app/(app)/home/HomeScreen.tsx -> @/components/organisms/BrowseModal",
  },
  {
    label: "home guided tour",
    route: "/(app)/home/page",
    module: "app/(app)/home/HomeScreen.tsx -> @/components/organisms/GuidedTour",
  },
  {
    label: "captured-operation admission",
    route: "/(app)/outcomes/[id]/page",
    module:
      "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/CapturedAdmission",
  },
  {
    label: "workspace guided tour",
    route: "/(app)/outcomes/[id]/page",
    module: "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/GuidedTour",
  },
  {
    label: "proofread tools",
    route: "/(app)/outcomes/[id]/page",
    module: "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/ProofreadPanel",
  },
  {
    label: "upload analysis",
    route: "/(app)/outcomes/[id]/page",
    module:
      "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/UploadAnalysisPanel",
  },
  {
    label: "full-document preview",
    route: "/(app)/outcomes/[id]/page",
    module: "components/organisms/WorkspacePane.tsx -> ./LivePreview",
  },
  {
    label: "revision history",
    route: "/(app)/outcomes/[id]/page",
    module: "components/organisms/WorkspacePane.tsx -> ./VersionHistory",
  },
  {
    label: "legacy generation catalogue",
    route: "/(app)/outcomes/[id]/page",
    module: "lib/document-generation.ts -> ./document-generation-catalogue",
  },
  {
    label: "analytics SDK",
    route: "/(app)/home/page",
    module: "components/providers/MonitoringProvider.tsx -> @/lib/analytics",
  },
  {
    label: "error-monitoring SDK",
    route: "/(app)/home/page",
    module: "components/providers/MonitoringProvider.tsx -> @/lib/monitoring",
  },
];

const CATALOGUE_ROUTES = ["/(app)/home/page", "/(app)/outcomes/[id]/page", "/(app)/workspace/page"];

// Uncompressed build-artifact ceilings intentionally leave modest headroom
// above the reviewed 2026-08-31 baseline. A dependency or static-import drift
// must be reviewed explicitly instead of silently expanding critical routes.
const INITIAL_ROUTE_BUDGETS = {
  "/(app)/home/page": 900_000,
  "/(app)/outcomes/[id]/page": 1_400_000,
  "/(app)/workspace/page": 850_000,
};

// These stable catalogue labels are content sentinels, not module-name hints.
// They catch a duplicated/static catalogue copy even when a new importer is
// absent from the React loadable manifest.
const CATALOGUE_SENTINELS = [
  "Career Change Decision Guide",
  "Business Plan",
  "Interview Preparation Guide",
];

function filesForModule(loadable, moduleName) {
  const entry = loadable[moduleName];
  return Array.isArray(entry?.files) ? entry.files : null;
}

export function findProgressiveBundleViolations(appManifest, loadableManifest) {
  const violations = [];

  for (const rule of RULES) {
    const initialFiles = appManifest.pages?.[rule.route];
    if (!Array.isArray(initialFiles)) {
      violations.push(`${rule.label}: missing route manifest entry ${rule.route}`);
      continue;
    }
    const deferredFiles = filesForModule(loadableManifest, rule.module);
    if (!deferredFiles || deferredFiles.length === 0) {
      violations.push(`${rule.label}: missing deferred chunk entry ${rule.module}`);
      continue;
    }
    const initial = new Set(initialFiles);
    const overlap = deferredFiles.filter((file) => initial.has(file));
    if (overlap.length > 0) {
      violations.push(`${rule.label}: deferred files entered ${rule.route}: ${overlap.join(", ")}`);
    }
  }

  const catalogueEntries = Object.entries(loadableManifest).filter(([name]) =>
    name.endsWith(" -> @prompted/shared/catalogue"),
  );
  const catalogueFiles = new Set(
    catalogueEntries.flatMap(([, entry]) => (Array.isArray(entry?.files) ? entry.files : [])),
  );
  if (catalogueFiles.size === 0) {
    violations.push("template catalogue: no separately loadable catalogue chunk found");
  }
  for (const route of CATALOGUE_ROUTES) {
    const initialFiles = appManifest.pages?.[route];
    if (!Array.isArray(initialFiles)) {
      violations.push(`template catalogue: missing route manifest entry ${route}`);
      continue;
    }
    const overlap = initialFiles.filter((file) => catalogueFiles.has(file));
    if (overlap.length > 0) {
      violations.push(`template catalogue: full catalogue entered ${route}: ${overlap.join(", ")}`);
    }
  }

  return violations;
}

export function findCriticalArtifactViolations(appManifest, artifacts) {
  const violations = [];
  for (const [route, byteBudget] of Object.entries(INITIAL_ROUTE_BUDGETS)) {
    const initialFiles = appManifest.pages?.[route];
    if (!Array.isArray(initialFiles)) continue;

    const missing = initialFiles.filter((file) => !artifacts.has(file));
    if (missing.length > 0) {
      violations.push(`${route}: initial artifacts are missing: ${missing.join(", ")}`);
      continue;
    }

    const bytes = initialFiles.reduce(
      (total, file) => total + (artifacts.get(file)?.bytes ?? 0),
      0,
    );
    if (bytes > byteBudget) {
      violations.push(
        `${route}: initial artifacts total ${bytes} bytes, above ${byteBudget}-byte budget`,
      );
    }

    const javascript = initialFiles
      .filter((file) => file.endsWith(".js"))
      .map((file) => artifacts.get(file)?.content ?? "")
      .join("\n");
    const leaked = CATALOGUE_SENTINELS.filter((sentinel) =>
      javascript.includes(sentinel),
    );
    if (leaked.length > 0) {
      violations.push(
        `${route}: full-catalogue content entered initial JavaScript (${leaked.join(", ")})`,
      );
    }
  }
  return violations;
}

export async function checkProgressiveBundles(root = process.cwd()) {
  const [appRaw, loadableRaw] = await Promise.all([
    readFile(path.join(root, APP_MANIFEST), "utf8"),
    readFile(path.join(root, LOADABLE_MANIFEST), "utf8"),
  ]);
  const appManifest = JSON.parse(appRaw);
  const loadableManifest = JSON.parse(loadableRaw);
  const initialFiles = new Set(
    Object.keys(INITIAL_ROUTE_BUDGETS).flatMap(
      (route) => appManifest.pages?.[route] ?? [],
    ),
  );
  const artifacts = new Map(
    await Promise.all(
      [...initialFiles].map(async (file) => {
        const artifactPath = path.join(root, "apps/web/.next", file);
        const [metadata, content] = await Promise.all([
          stat(artifactPath),
          file.endsWith(".js") ? readFile(artifactPath, "utf8") : Promise.resolve(""),
        ]);
        return [file, { bytes: metadata.size, content }];
      }),
    ),
  );
  const violations = [
    ...findProgressiveBundleViolations(appManifest, loadableManifest),
    ...findCriticalArtifactViolations(appManifest, artifacts),
  ];
  if (violations.length > 0) {
    throw new Error(`Progressive bundle gate failed:\n- ${violations.join("\n- ")}`);
  }
  return {
    checkedRoutes: [...new Set(RULES.map((rule) => rule.route)), ...CATALOGUE_ROUTES].filter(
      (route, index, routes) => routes.indexOf(route) === index,
    ),
    deferredBoundaries: RULES.length,
    catalogueChunks: new Set(
      Object.entries(loadableManifest)
        .filter(([name]) => name.endsWith(" -> @prompted/shared/catalogue"))
        .flatMap(([, entry]) => entry.files ?? []),
    ).size,
  };
}

async function main() {
  try {
    const result = await checkProgressiveBundles();
    console.log(
      `Progressive bundle gate passed: ${result.deferredBoundaries} deferred boundaries, ` +
        `${result.checkedRoutes.length} critical routes, ${result.catalogueChunks} catalogue chunks.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
