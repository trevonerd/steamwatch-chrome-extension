#!/usr/bin/env node
/**
 * package-zip.ts — Builds the extension and zips dist/ for the Chrome Web Store.
 *
 * Output: steamwatch.v<version>.zip in the project root (gitignored).
 * Usage:  pnpm zip
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf-8"));
const zipPath = resolve(root, `steamwatch.v${manifest.version}.zip`);

execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
rmSync(zipPath, { force: true });
// -X drops extra file attributes; zipping from inside dist/ keeps manifest.json at the archive root.
execFileSync("zip", ["-r", "-X", zipPath, ".", "-x", "*.DS_Store"], { cwd: resolve(root, "dist"), stdio: "inherit" });
console.log(`\nWrote ${zipPath}`);
