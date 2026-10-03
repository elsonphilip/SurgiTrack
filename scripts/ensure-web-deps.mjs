// Installs the website's dependencies the first time (or when package-lock.json changed), so
// `npm run dev` works straight from the repo root with nothing else to remember.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const lock = path.join(web, "package-lock.json");
const stamp = path.join(web, "node_modules", ".surgitrack-lock-hash");
const hash = (f) => createHash("sha1").update(readFileSync(f)).digest("hex");

const want = existsSync(lock) ? hash(lock) : "";
const have = existsSync(stamp) ? readFileSync(stamp, "utf8") : "";

if (!existsSync(path.join(web, "node_modules")) || want !== have) {
  console.log("\n▶ Installing website dependencies (first run, or dependencies changed)…\n");
  const r = spawnSync("npm", ["install"], { cwd: web, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  mkdirSync(path.join(web, "node_modules"), { recursive: true });
  writeFileSync(stamp, want);
}
