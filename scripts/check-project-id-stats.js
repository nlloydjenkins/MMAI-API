/*
  Summarize how many documents have project IDs vs those that don't.
  It reads Azure Search config from api/local.settings.json (Values) or environment variables:
    - AZURE_SEARCH_ENDPOINT
    - AZURE_SEARCH_API_KEY
    - AZURE_SEARCH_INDEX_NAME

  Usage:
    node scripts/check-project-id-stats.js
*/

const fs = require("fs");
const path = require("path");
const { SearchClient, AzureKeyCredential } = require("@azure/search-documents");

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
    "documents-index";
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
    top: 1000, // SDK will auto-paginate; we'll iterate over results
  });

  let total = 0;
  let withProjectId = 0;
  let withoutProjectId = 0;
  const samples = [];

  for await (const result of results.results) {
    const doc = result.document || {};
    total++;
    if (hasProjectId(doc)) {
      withProjectId++;
    } else {
      if (samples.length < 10) {
        samples.push({
          id: doc.id,
          name: doc.metadata_storage_name,
          path: doc.metadata_storage_path,
        });
      }
      withoutProjectId++;
    }
  }

  console.log("\n===== Project ID Summary =====");
  console.log("Total documents:", results.count ?? total);
  console.log("With project id:", withProjectId);
  console.log("Without project id:", withoutProjectId);
  if (samples.length) {
    console.log("\nSample without project id (up to 10):");
    samples.forEach((s, i) =>
      console.log(`${i + 1}. ${s.id}  ${s.name || "(no name)"}`)
    );
  }
}

main().catch((err) => {
  console.error("❌ Error:", err?.message || err);
  process.exit(1);
});
