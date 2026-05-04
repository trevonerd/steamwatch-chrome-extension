#!/usr/bin/env node
/**
 * sync-version.ts — Single source of truth: manifest.json → package.json
 *
 * Reads the version from manifest.json and writes it to package.json.
 * Run automatically via the `version-sync` npm script, or as a pre-build hook.
 *
 * Usage:  npx tsx scripts/sync-version.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const manifestPath = resolve(root, "manifest.json");
const packagePath = resolve(root, "package.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

const manifestVersion: string = manifest.version;
if (!manifestVersion) {
  console.error("ERROR: manifest.json has no version field");
  process.exit(1);
}

if (pkg.version === manifestVersion) {
  console.log(`Version already in sync: ${manifestVersion}`);
  process.exit(0);
}

pkg.version = manifestVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
console.log(`Synced package.json version → ${manifestVersion}`);
