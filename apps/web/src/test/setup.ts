import "@testing-library/jest-dom/vitest";
import { afterEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as axeMatchers from "vitest-axe/matchers";

// Register vitest-axe's accessibility matchers (e.g. toHaveNoViolations).
expect.extend(axeMatchers);

// jsdom has no canvas; axe-core probes getContext during contrast checks.
// Stub it to keep test output clean. (Real contrast is verified numerically
// from the tokens in contrast.test.ts, since jsdom cannot compute it.)
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
}

// jsdom does not implement scrollIntoView. Components that call it on mount
// or on list updates (e.g. EditWithTED's auto-scroll-to-latest-message)
// throw "is not a function" in every test that renders them, regardless of
// whether scrolling itself is under test. Stub it as a no-op.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

afterEach(() => {
  cleanup();
});
