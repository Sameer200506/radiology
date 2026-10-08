/**
 * Vitest setup.
 *
 * Loads `.env.local` so the integration project can find OPENROUTER_API_KEY
 * without the developer having to export it by hand. Node's built-in
 * `process.loadEnvFile` is used where available; older runtimes fall back to
 * parsing the file directly.
 *
 * This never applies to the `unit` project, which stays hermetic.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;

  const load = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof load === "function") {
    load.call(process, path);
    return;
  }

  // Minimal fallback parser: KEY=value, optional quotes, # comments.
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();