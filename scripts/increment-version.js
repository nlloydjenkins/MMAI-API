#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to package.json
const packagePath = join(__dirname, "..", "package.json");

try {
  // Read current package.json
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

  // Parse current version
  const versionParts = packageJson.version.split(".");
  const major = parseInt(versionParts[0]);
  const minor = parseInt(versionParts[1]);
  const patch = parseInt(versionParts[2]);

  // Increment patch version
  const newPatch = patch + 1;
  const newVersion = `${major}.${minor}.${newPatch}`;

  console.log(
    `🔄 Incrementing API version from ${packageJson.version} to ${newVersion}`
  );

  // Update package.json
  packageJson.version = newVersion;
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

  // Read current build number from version.json (if it exists)
  const versionPath = join(__dirname, "..", "src", "version.json");
  let buildNumber = 1;

  try {
    const versionFile = JSON.parse(readFileSync(versionPath, "utf8"));
    buildNumber = (versionFile.buildNumber || 0) + 1;
  } catch (e) {
    console.log("📄 Creating new version.json file");
  }

  // Create version info
  const versionInfo = {
    version: newVersion,
    buildDate: new Date().toISOString(),
    buildNumber: buildNumber,
  };

  // Write version.json
  writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2));

  console.log(
    `✅ API version updated to ${newVersion} (build #${buildNumber})`
  );
  console.log(`📅 Build date: ${versionInfo.buildDate}`);
} catch (error) {
  console.error("❌ Failed to increment API version:", error.message);
  process.exit(1);
}
