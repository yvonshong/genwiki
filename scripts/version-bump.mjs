/**
 * version-bump.mjs
 * Run via: npm run version
 *
 * Reads `version` from package.json and writes it to manifest.json.
 * `minAppVersion` in manifest.json is left untouched (it tracks Obsidian's
 * minimum required app version, not the plugin's own version).
 */

import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

const newVersion = pkg.version;
if (!newVersion) {
	console.error("No version found in package.json");
	process.exit(1);
}

manifest.version = newVersion;

writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`✅ manifest.json version → ${newVersion}`);
