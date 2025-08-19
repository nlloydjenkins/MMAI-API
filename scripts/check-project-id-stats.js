/*
  Summarize how many documents have project IDs vs those that don't.
  It reads Azure Search config from api/local.settings.json (Values) or environment variables:
    - AZURE_SEARCH_ENDPOINT
    - AZURE_SEARCH_API_KEY
    - AZURE_SEARCH_INDEX_NAME

  Usage:
    node scripts/check-project-id-stats.js
*/

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readLocalSettings() {
  try {
    const p = path.join(__dirname, "..", "local.settings.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function getSearchConfig() {
  const settings = readLocalSettings();
  const values = settings?.Values || {};
  const endpoint =
    process.env.AZURE_SEARCH_ENDPOINT || values.AZURE_SEARCH_ENDPOINT;
  const apiKey =
    process.env.AZURE_SEARCH_API_KEY || values.AZURE_SEARCH_API_KEY;
  const indexName =
    process.env.AZURE_SEARCH_INDEX_NAME ||
    values.AZURE_SEARCH_INDEX_NAME ||
    "documents-index-v2";
  if (!endpoint || !apiKey) {
    throw new Error(
      "Missing AZURE_SEARCH_ENDPOINT or AZURE_SEARCH_API_KEY. Set them in local.settings.json or env."
    );
  }
  return { endpoint, apiKey, indexName };
}

function hasProjectId(doc) {
  const pid = doc.project_id ?? doc.projectId ?? doc.project;
  if (pid === null || pid === undefined) return false;
  if (typeof pid === "string" && pid.trim() === "") return false;
  return true;
}

async function main() {
  const { endpoint, apiKey, indexName } = getSearchConfig();
  const client = new SearchClient(
    endpoint,
    indexName,
    new AzureKeyCredential(apiKey)
  );

  console.log("🔍 Querying Azure Search index:", indexName);

  const results = await client.search("*", {
    includeTotalCount: true,
    top: 50, // Process in batches to avoid memory issues
  });

  let total = 0;
  let withProjectId = 0;
  let withoutProjectId = 0;
  const samples = [];
  const projectIdSamples = new Set(); // Track unique project IDs
  const detailedSamples = []; // Store filename + project_id pairs

  console.log("📊 Processing documents...");

  for await (const result of results.results) {
    const doc = result.document || {};
    total++;

    if (total % 100 === 0) {
      console.log(`  Processed ${total} documents...`);
    }

    if (hasProjectId(doc)) {
      withProjectId++;
      // Collect sample project IDs
      const pid = doc.project_id ?? doc.projectId ?? doc.project;
      if (projectIdSamples.size < 20) {
        projectIdSamples.add(String(pid));
      }
      // Collect detailed samples (filename + project_id)
      if (detailedSamples.length < 50) {
        detailedSamples.push({
          filename:
            doc.metadata_storage_name || doc.fileName || doc.id || "unknown",
          projectId: String(pid),
          id: doc.id,
        });
      }
    } else {
      withoutProjectId++;
      if (samples.length < 10) {
        samples.push({
          id: doc.id,
          name: doc.metadata_storage_name,
          path: doc.metadata_storage_path,
        });
      }
    }
  }

  console.log("\n===== Project ID Summary =====");
  console.log("Total documents:", results.count ?? total);
  console.log("Total processed:", total);
  console.log("With project id:", withProjectId);
  console.log("Without project id:", withoutProjectId);
  console.log(
    "Math check:",
    withProjectId + withoutProjectId,
    "should equal",
    total
  );
  if (samples.length) {
    console.log("\nSample without project id (up to 10):");
    samples.forEach((s, i) =>
      console.log(`${i + 1}. ${s.id}  ${s.name || "(no name)"}`)
    );
  }

  if (projectIdSamples.size > 0) {
    console.log("\nSample project IDs found (up to 20):");
    Array.from(projectIdSamples).forEach((pid, i) =>
      console.log(`${i + 1}. "${pid}"`)
    );
  }

  if (detailedSamples.length > 0) {
    console.log("\nDetailed samples - Filename + Project ID (up to 50):");
    detailedSamples.forEach((sample, i) =>
      console.log(`${i + 1}. ${sample.filename} -> ${sample.projectId}`)
    );
  }
}

main().catch((err) => {
  console.error("❌ Error:", err?.message || err);
  process.exit(1);
});
