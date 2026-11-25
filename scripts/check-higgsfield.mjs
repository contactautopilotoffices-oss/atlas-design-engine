#!/usr/bin/env node
/**
 * Free Higgsfield credential check. Uses NO generation credits.
 * It asks for the status of a request id that cannot exist:
 *   401 -> the key is not accepted
 *   404 -> the key IS accepted (the API looked up the request for your account and found nothing)
 * The key value is never printed.
 *
 * Run:  npm run check:higgsfield
 */
import { readFileSync, existsSync } from "node:fs";

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv(".env.local");
loadDotEnv(".env");

const e = process.env;
let credential = null;
let source = null;
if (e.HF_API_KEY_ID && e.HF_API_KEY_SECRET) [credential, source] = [`${e.HF_API_KEY_ID}:${e.HF_API_KEY_SECRET}`, "HF_API_KEY_ID + HF_API_KEY_SECRET"];
else for (const n of ["HIGGSFIELD_API_KEY", "HIGGSFIELF_API_KEY"]) if (e[n]) { [credential, source] = [e[n].trim(), n]; break; }

if (!credential) {
  console.log("No Higgsfield credential found in the environment or .env.");
  process.exit(1);
}
if (!/^[^:\s]+:[^:\s]+$/.test(credential)) {
  console.log(`${source} is set but is not in the "<key id>:<key secret>" format.`);
  process.exit(1);
}
const base = e.HIGGSFIELD_API_BASE || "https://api.higgsfield.ai";
const res = await fetch(`${base}/requests/00000000-0000-4000-8000-000000000000/status`, { headers: { Authorization: `Key ${credential}`, Accept: "application/json" } }).catch((err) => {
  console.log(`Could not reach ${base}: ${err.message}`);
  process.exit(1);
});
console.log(`Credential source: ${source} (value hidden)`);
if (res.status === 401) {
  console.log("RESULT: Higgsfield rejected the credential (401). Check the key id and secret in the Higgsfield console.");
  process.exit(1);
}
if (res.status === 404) {
  console.log("RESULT: Credential accepted. (404 for a made-up request id is the expected answer.) No credits were used.");
  process.exit(0);
}
console.log(`RESULT: Unexpected HTTP ${res.status}. The credential may be fine; check https://docs.higgsfield.ai/docs/concepts/errors.md`);
process.exit(2);
