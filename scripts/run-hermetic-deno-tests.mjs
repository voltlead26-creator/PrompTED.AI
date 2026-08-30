// Runs the repository's hermetic Deno.test files through the installed Vite
// TypeScript loader when the Deno binary is unavailable. Test files selected
// here must not import remote modules or require Deno runtime APIs beyond
// Deno.test.

const tests = [];

globalThis.Deno = {
  test(name, fn) {
    tests.push({ name, fn });
  },
};

for (const path of process.argv.slice(2)) {
  await import(new URL(`../${path}`, import.meta.url));
}

let failed = 0;
for (const test of tests) {
  try {
    await test.fn();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${test.name}`);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}

console.log(`${tests.length - failed}/${tests.length} tests passed`);
if (failed > 0) process.exitCode = 1;
