import assert from "node:assert/strict";
import test from "node:test";
import {
  findCriticalArtifactViolations,
  findProgressiveBundleViolations,
} from "./check-progressive-bundles.mjs";

function fixture() {
  const routeFiles = ["static/chunks/base.js", "static/chunks/page.js"];
  const pages = {
    "/(app)/home/page": [...routeFiles],
    "/(app)/outcomes/[id]/page": [...routeFiles],
    "/(app)/workspace/page": [...routeFiles],
  };
  const modules = {
    "app/(app)/home/HomeScreen.tsx -> @/components/organisms/BrowseModal": "browse",
    "app/(app)/home/HomeScreen.tsx -> @/components/organisms/GuidedTour": "home-tour",
    "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/CapturedAdmission":
      "admission",
    "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/GuidedTour":
      "workspace-tour",
    "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/ProofreadPanel":
      "proofread",
    "app/(app)/outcomes/[id]/WorkspaceScreen.tsx -> @/components/organisms/UploadAnalysisPanel":
      "upload",
    "components/organisms/WorkspacePane.tsx -> ./LivePreview": "preview",
    "components/organisms/WorkspacePane.tsx -> ./VersionHistory": "history",
    "lib/document-generation.ts -> ./document-generation-catalogue": "generation-catalogue",
    "components/providers/MonitoringProvider.tsx -> @/lib/analytics": "analytics",
    "components/providers/MonitoringProvider.tsx -> @/lib/monitoring": "monitoring",
    "hooks/useOutcome.ts -> @prompted/shared/catalogue": "catalogue",
  };
  return {
    app: { pages },
    loadable: Object.fromEntries(
      Object.entries(modules).map(([name, chunk]) => [
        name,
        { files: [`static/chunks/${chunk}.js`] },
      ]),
    ),
  };
}

test("accepts optional modules that are absent from critical initial routes", () => {
  const { app, loadable } = fixture();
  assert.deepEqual(findProgressiveBundleViolations(app, loadable), []);
});

test("rejects a deferred panel bundled into its critical route", () => {
  const { app, loadable } = fixture();
  app.pages["/(app)/outcomes/[id]/page"].push("static/chunks/proofread.js");
  assert.match(
    findProgressiveBundleViolations(app, loadable).join("\n"),
    /proofread tools: deferred files entered/,
  );
});

test("rejects the full catalogue in any protected initial route", () => {
  const { app, loadable } = fixture();
  app.pages["/(app)/home/page"].push("static/chunks/catalogue.js");
  assert.match(
    findProgressiveBundleViolations(app, loadable).join("\n"),
    /template catalogue: full catalogue entered \/\(app\)\/home\/page/,
  );
});

test("rejects catalogue content duplicated under an unrecognised importer", () => {
  const { app } = fixture();
  const artifacts = new Map([
    ["static/chunks/base.js", { bytes: 100, content: "Career Change Decision Guide" }],
    ["static/chunks/page.js", { bytes: 100, content: "ordinary route content" }],
  ]);
  assert.match(
    findCriticalArtifactViolations(app, artifacts).join("\n"),
    /full-catalogue content entered initial JavaScript/,
  );
});

test("rejects an initial route that exceeds its reviewed byte budget", () => {
  const { app } = fixture();
  const artifacts = new Map([
    ["static/chunks/base.js", { bytes: 800_000, content: "" }],
    ["static/chunks/page.js", { bytes: 700_000, content: "" }],
  ]);
  assert.match(
    findCriticalArtifactViolations(app, artifacts).join("\n"),
    /above [0-9]+-byte budget/,
  );
});
