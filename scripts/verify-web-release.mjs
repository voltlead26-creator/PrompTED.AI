#!/usr/bin/env node
// Composite release gate for the web app. Runs the checks that already
// exist in package.json plus the deployment compatibility contract check,
// in an order that fails fast and cheap before anything expensive (type
// checking, tests, the Next.js build) runs.
//
// The deployment-contract check runs first and on its own: it is a pure
// static check (no install/build needed) that catches the exact class of
// bug this repo has already shipped -- an Edge Function relying on an RPC
// or migration nobody declared it depends on -- so there is no reason to
// pay for a full build before finding out about it.

import { spawn } from "node:child_process";

const STEPS = [
  // Tests the checker's own logic (scripts/check-deployment-contract.test.mjs)
  // before trusting its verdict below -- a regression in the checker itself
  // (e.g. a broken RPC scan or a loosened violation check) should fail loud
  // here, not silently pass everything downstream. This is also run as part
  // of the root "test" script (see package.json: "test" runs it before
  // `pnpm -r test`), which is what actually gets this suite into CI --
  // ci.yml's "Test all packages" step runs `pnpm test`, and no workflow
  // invokes this composite script directly. Kept here too, first, purely
  // for a faster local fail-fast signal; running it twice costs ~40ms.
  { name: "test:deployment-contract", command: "pnpm", args: ["test:deployment-contract"] },
  { name: "check:deployment-contract", command: "pnpm", args: ["check:deployment-contract"] },
  { name: "lint", command: "pnpm", args: ["lint"] },
  { name: "type-check", command: "pnpm", args: ["type-check"] },
  { name: "test", command: "pnpm", args: ["test"] },
  { name: "build", command: "pnpm", args: ["build"] },
  { name: "check:progressive-bundles", command: "pnpm", args: ["check:progressive-bundles"] },
];

function run(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n> verify:web -- ${step.name}`);
    const child = spawn(step.command, step.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step "${step.name}" failed with exit code ${code}.`));
    });
    child.on("error", reject);
  });
}

async function main() {
  for (const step of STEPS) {
    await run(step);
  }
  console.log("\nverify:web passed.");
}

main().catch((error) => {
  console.error(`\nverify:web failed: ${error.message}`);
  process.exitCode = 1;
});
