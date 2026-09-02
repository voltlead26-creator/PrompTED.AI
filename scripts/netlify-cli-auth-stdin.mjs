import { readFileSync } from "node:fs";

if (process.env.PROMPTED_NETLIFY_AUTH_STDIN !== "1") {
  throw new Error("Netlify stdin authentication bridge was not explicitly enabled.");
}

const authToken = readFileSync(0, "utf8").trim();
if (
  authToken.length === 0 ||
  authToken.length > 4096 ||
  /[\s\u0000-\u001f\u007f]/.test(authToken)
) {
  throw new Error("Netlify stdin authentication credential is malformed.");
}

delete process.env.NETLIFY_AUTH_TOKEN;
delete process.env.PROMPTED_NETLIFY_AUTH_STDIN;
delete process.env.NODE_OPTIONS;
process.argv.push("--auth", authToken);
