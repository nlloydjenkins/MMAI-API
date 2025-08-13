#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to version.json
const versionPath = join(__dirname, "..", "src", "version.json");

try {
  // Read current version file
  const versionInfo = JSON.parse(readFileSync(versionPath, "utf8"));

  // Parse the current version (e.g., "0.3.1" -> [0, 3, 1])
  const versionParts = versionInfo.version.split('.').map(Number);
  const [major, minor, patch] = versionParts;

  // Increment patch version automatically
  const newPatch = patch + 1;
  const newVersion = `${major}.${minor}.${newPatch}`;

  // Update build date, increment build number, and update version
  const updatedVersionInfo = {
    ...versionInfo,
    version: newVersion,
    buildDate: new Date().toISOString(),
    buildNumber: (versionInfo.buildNumber || 0) + 1,
  };

  // Write updated version.json
  writeFileSync(versionPath, JSON.stringify(updatedVersionInfo, null, 2));

  console.log(
    `✅ API version updated: v${updatedVersionInfo.version} (build #${updatedVersionInfo.buildNumber})`
  );
  console.log(`📅 Build date: ${updatedVersionInfo.buildDate}`);
} catch (error) {
  console.error("❌ Failed to update API version:", error.message);
  process.exit(1);
}
