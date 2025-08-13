/*
  Clear all data: deletes ALL documents and projects so you can start fresh.
  - Deletes: Azure Search index documents, all blobs in the container, all entities in 'files' and 'projects' tables
  - Leaves: infrastructure/resources (index definition, container, tables) intact

  Safety:
  - Shows counts first
  - Prompts for confirmation (use --yes to skip)

  Usage:
    node scripts/clear-all-data.js
    node scripts/clear-all-data.js --yes  # skip confirmation
*/

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { DefaultAzureCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");
const { TableClient } = require("@azure/data-tables");
const {
  SearchClient,
  SearchIndexClient,
  AzureKeyCredential,
} = require("@azure/search-documents");

const DEFAULT_CONTAINER = "blobmmai"; // matches api/src/shared/azure-config.ts
const FILES_TABLE = "files";
const FILES_PARTITION = "file";
const PROJECTS_TABLE = "projects";
const PROJECTS_PARTITION = "project";

function readLocalSettings() {
  try {
    const p = path.join(__dirname, "..", "local.settings.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function getFlag(name) {
  return process.argv.includes(name);
}

async function promptYesNo(question) {
  if (getFlag("--yes")) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function getStorageConnectionStrings() {
  const settings = readLocalSettings();
  const values = settings?.Values || {};
  return {
    connStr:
      process.env.AzureWebJobsStorage ||
      process.env.AZURE_BLOB_CONNECTION_STRING ||
      values.AzureWebJobsStorage ||
      values.AZURE_BLOB_CONNECTION_STRING ||
      null,
    accountName:
      process.env.AZURE_STORAGE_ACCOUNT_NAME ||
      values.AZURE_STORAGE_ACCOUNT_NAME ||
      null,
  };
}

async function getBlobServiceClient() {
  const { connStr, accountName } = getStorageConnectionStrings();
  if (connStr) {
    console.log("🔗 Using storage connection string for blobs");
    return BlobServiceClient.fromConnectionString(connStr);
  }
  if (!accountName)
    throw new Error(
      "AZURE_STORAGE_ACCOUNT_NAME not set and no connection string found"
    );
  console.log("🔐 Using DefaultAzureCredential for blobs:", accountName);
  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

async function getTableClient(tableName) {
  const { connStr, accountName } = getStorageConnectionStrings();
  if (connStr) {
    const { TableClient: TableClientConn } = require("@azure/data-tables");
    return TableClientConn.fromConnectionString(connStr, tableName);
  }
  if (!accountName)
    throw new Error(
      "AZURE_STORAGE_ACCOUNT_NAME not set and no connection string found for tables"
    );
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    tableName,
    new DefaultAzureCredential()
  );
}

function getSearchConfig() {
  const settings = readLocalSettings();
  const v = settings?.Values || {};
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT || v.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY || v.AZURE_SEARCH_API_KEY;
  const indexName =
    process.env.AZURE_SEARCH_INDEX_NAME ||
    v.AZURE_SEARCH_INDEX_NAME ||
    "documents-index";
  if (!endpoint || !apiKey) {
    throw new Error(
      "AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY are required to clear search documents"
    );
  }
  return { endpoint, apiKey, indexName };
}

async function getSearchClients() {
  const { endpoint, apiKey, indexName } = getSearchConfig();
  const credential = new AzureKeyCredential(apiKey);
  return {
    indexName,
    searchClient: new SearchClient(endpoint, indexName, credential),
    indexClient: new SearchIndexClient(endpoint, credential),
  };
}

async function countTableEntities(tableClient, partitionKey) {
  let count = 0;
  try {
    const iter = tableClient.listEntities({
      queryOptions: partitionKey
        ? { filter: `PartitionKey eq '${partitionKey}'` }
        : undefined,
    });
    for await (const _ of iter) count++;
    return count;
  } catch (e) {
    if (e.statusCode === 404) return 0; // table might not exist
    throw e;
  }
}

async function listAllKeys(searchClient, keyField) {
  const keys = [];
  const results = await searchClient.search("*", {
    select: [keyField],
    includeTotalCount: true,
    top: 1000,
  });
  for await (const r of results.results) {
    const key = r.document?.[keyField];
    if (key != null) keys.push(key);
  }
  return { keys, total: results.count || keys.length };
}

async function deleteAllSearchDocs(searchClient, indexClient, indexName) {
  // Determine key field name
  let keyField = "id";
  try {
    const index = await indexClient.getIndex(indexName);
    const keyDef = index.fields.find((f) => f.key);
    if (keyDef) keyField = keyDef.name;
    console.log(`🔎 Search index key field: ${keyField}`);
  } catch (e) {
    console.warn(
      "⚠️ Could not fetch index schema, defaulting key field to 'id'",
      e.message || e
    );
  }

  // Collect keys in batches and delete
  let totalDeleted = 0;
  while (true) {
    const { keys } = await listAllKeys(searchClient, keyField);
    if (keys.length === 0) break;
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const slice = keys.slice(i, i + batchSize);
      try {
        const res = await searchClient.deleteDocuments(keyField, slice);
        const succeeded = res.results.filter((r) => r.succeeded).length;
        totalDeleted += succeeded;
        console.log(
          `🗑️ Deleted ${succeeded}/${slice.length} docs (cumulative ${totalDeleted})`
        );
      } catch (err) {
        console.warn("⚠️ Delete batch failed:", err?.message || err);
      }
    }
    // Loop again in case there are more than one page of results
  }
  console.log(`✅ Search documents deleted: ${totalDeleted}`);
}

async function deleteAllBlobs(containerClient) {
  let count = 0;
  const toDelete = [];
  for await (const b of containerClient.listBlobsFlat()) {
    toDelete.push(b.name);
  }
  if (toDelete.length === 0) {
    console.log("✅ No blobs to delete");
    return 0;
  }
  const concurrency = 10;
  async function worker(names) {
    for (const name of names) {
      try {
        await containerClient.deleteBlob(name, { deleteSnapshots: "include" });
        count++;
        if (count % 100 === 0)
          console.log(`...deleted ${count}/${toDelete.length} blobs`);
      } catch (e) {
        console.warn("⚠️ Failed to delete blob:", name, e?.message || e);
      }
    }
  }
  const chunks = Array.from({ length: concurrency }, (_, i) =>
    toDelete.filter((_, idx) => idx % concurrency === i)
  );
  await Promise.all(chunks.map(worker));
  console.log(`✅ Blobs deleted: ${count}`);
  return count;
}

async function deleteAllEntities(tableClient, partitionKey) {
  let deleted = 0;
  try {
    const iter = tableClient.listEntities({
      queryOptions: partitionKey
        ? { filter: `PartitionKey eq '${partitionKey}'` }
        : undefined,
    });
    const tasks = [];
    for await (const e of iter) {
      tasks.push({ pk: e.partitionKey, rk: e.rowKey });
    }
    if (tasks.length === 0) return 0;
    const concurrency = 10;
    async function worker(items) {
      for (const { pk, rk } of items) {
        try {
          await tableClient.deleteEntity(pk, rk);
          deleted++;
          if (deleted % 200 === 0)
            console.log(`...deleted ${deleted}/${tasks.length} entities`);
        } catch (e) {
          console.warn("⚠️ Failed to delete entity:", pk, rk, e?.message || e);
        }
      }
    }
    const chunks = Array.from({ length: concurrency }, (_, i) =>
      tasks.filter((_, idx) => idx % concurrency === i)
    );
    await Promise.all(chunks.map(worker));
    console.log(`✅ Table entities deleted: ${deleted}`);
    return deleted;
  } catch (e) {
    if (e.statusCode === 404) {
      console.log("ℹ️ Table not found – skipping");
      return 0;
    }
    throw e;
  }
}

async function main() {
  const containerName = process.env.BLOB_CONTAINER || DEFAULT_CONTAINER;

  // Clients
  const blobService = await getBlobServiceClient();
  const container = blobService.getContainerClient(containerName);
  const filesTable = await getTableClient(FILES_TABLE);
  const projectsTable = await getTableClient(PROJECTS_TABLE);
  const { searchClient, indexClient, indexName } = await getSearchClients();

  // Existence checks
  const containerExists = await container.exists();
  if (!containerExists) {
    console.warn(
      `⚠️ Blob container '${containerName}' does not exist. Continuing.`
    );
  }

  // Counts
  console.log("\n===== Current Data Summary =====");
  let blobCount = 0;
  if (containerExists) {
    for await (const _ of container.listBlobsFlat()) blobCount++;
  }
  const filesCount = await countTableEntities(filesTable, FILES_PARTITION);
  const projectsCount = await countTableEntities(
    projectsTable,
    PROJECTS_PARTITION
  );
  // Search count (fast): fetch minimal
  let searchCount = 0;
  try {
    const sr = await searchClient.search("*", {
      top: 1,
      includeTotalCount: true,
    });
    searchCount = sr.count || 0;
  } catch (e) {
    console.warn("⚠️ Could not get search count:", e?.message || e);
  }
  console.log(`Blobs in '${containerName}':`, blobCount);
  console.log(`Files table entities:`, filesCount);
  console.log(`Projects table entities:`, projectsCount);
  console.log(`Search index '${indexName}' documents:`, searchCount);

  const proceed = await promptYesNo(
    `\n⚠️ This will DELETE: all search documents, all blobs in '${containerName}', and ALL entities in tables '${FILES_TABLE}' and '${PROJECTS_TABLE}'. Proceed?`
  );
  if (!proceed) {
    console.log("✋ Aborted. No deletions performed.");
    return;
  }

  console.log("\n🔎 Step 1/4: Deleting all search index documents...");
  await deleteAllSearchDocs(searchClient, indexClient, indexName);

  console.log("\n📦 Step 2/4: Deleting all blobs...");
  if (containerExists) await deleteAllBlobs(container);

  console.log("\n📄 Step 3/4: Clearing 'files' table entities...");
  await deleteAllEntities(filesTable, FILES_PARTITION);

  console.log("\n🗂️ Step 4/4: Clearing 'projects' table entities...");
  await deleteAllEntities(projectsTable, PROJECTS_PARTITION);

  console.log("\n✅ Done. Data cleared. You can now start fresh.");
}

main().catch((err) => {
  console.error("❌ Unhandled error:", err?.message || err);
  process.exit(1);
});
