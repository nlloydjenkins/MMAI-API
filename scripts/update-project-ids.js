/*
  Update all documents without project_id to have a specific project_id.
  This script will:
  1. Find all documents where project_id is null/empty
  2. Update them with the specified project_id
  3. Upload the changes back to Azure Search

  Usage:
    node scripts/update-project-ids.js [project-id]
  
  Example:
    node scripts/update-project-ids.js d57ddc10-f73c-4274-addb-8686414ff71c
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
  const pid = doc.project_id;
  if (pid === null || pid === undefined) return false;
  if (typeof pid === "string" && pid.trim() === "") return false;
  return true;
}

async function main() {
  const targetProjectId = process.argv[2];
  if (!targetProjectId) {
    console.error("❌ Please provide a project ID as argument:");
    console.error("   node scripts/update-project-ids.js [project-id]");
    console.error(
      "   Example: node scripts/update-project-ids.js d57ddc10-f73c-4274-addb-8686414ff71c"
    );
    process.exit(1);
  }

  const { endpoint, apiKey, indexName } = getSearchConfig();
  const client = new SearchClient(
    endpoint,
    indexName,
    new AzureKeyCredential(apiKey)
  );

  console.log(
    "🔍 Searching for documents without project_id in index:",
    indexName
  );
  console.log("🎯 Will update them to project_id:", targetProjectId);

  // First, find all documents without project_id
  const results = await client.search("*", {
    includeTotalCount: true,
    top: 50, // Process in batches
    // Don't use select to avoid field name issues - get all fields
  });

  const documentsToUpdate = [];
  let totalProcessed = 0;

  console.log("📊 Finding documents to update...");

  for await (const result of results.results) {
    const doc = result.document || {};
    totalProcessed++;

    if (totalProcessed % 100 === 0) {
      console.log(`  Processed ${totalProcessed} documents...`);
    }

    if (!hasProjectId(doc)) {
      documentsToUpdate.push({
        id: doc.id,
        project_id: targetProjectId,
        // Preserve other fields that might exist
        ...doc,
      });
    }
  }

  console.log("\n===== Update Summary =====");
  console.log("Total documents found:", totalProcessed);
  console.log("Documents to update:", documentsToUpdate.length);

  if (documentsToUpdate.length === 0) {
    console.log(
      "✅ No documents need updating. All documents already have project_id."
    );
    return;
  }

  // Ask for confirmation
  console.log(`\n⚠️  This will update ${documentsToUpdate.length} documents.`);
  console.log("📝 Sample documents to be updated:");
  documentsToUpdate.slice(0, 5).forEach((doc, i) => {
    const name =
      doc.metadata_storage_name ||
      doc.fileName ||
      doc.name ||
      doc.id ||
      "unknown";
    console.log(`   ${i + 1}. ${name}`);
  });

  // In a real environment, you might want to add a confirmation prompt here
  console.log("\n🚀 Starting update process...");

  // Update documents in batches
  const batchSize = 100;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < documentsToUpdate.length; i += batchSize) {
    const batch = documentsToUpdate.slice(i, i + batchSize);

    try {
      console.log(
        `📤 Uploading batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          documentsToUpdate.length / batchSize
        )} (${batch.length} documents)...`
      );

      const uploadResult = await client.uploadDocuments(batch);

      // Check results
      for (const result of uploadResult.results) {
        if (result.succeeded) {
          updated++;
        } else {
          errors++;
          console.error(
            `❌ Failed to update document ${result.key}:`,
            result.errorMessage
          );
        }
      }
    } catch (error) {
      console.error(`❌ Batch upload failed:`, error.message);
      errors += batch.length;
    }
  }

  console.log("\n===== Final Results =====");
  console.log("✅ Successfully updated:", updated);
  console.log("❌ Errors:", errors);
  console.log("📊 Total processed:", updated + errors);

  if (updated > 0) {
    console.log(
      "\n🎉 Update complete! Documents now have project_id:",
      targetProjectId
    );
    console.log("💡 Try testing the API again with this project_id.");
  }
}

main().catch((err) => {
  console.error("❌ Script failed:", err?.message || err);
  process.exit(1);
});
