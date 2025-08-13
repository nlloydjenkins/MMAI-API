/*
  Cleanup orphan blobs: Deletes blobs in the container that lack a project id in metadata.
  - Detects connection using (in order):
    1) local.settings.json Values.AzureWebJobsStorage (SAS connection string)
    2) local.settings.json Values.AZURE_BLOB_CONNECTION_STRING
    3) DefaultAzureCredential + AZURE_STORAGE_ACCOUNT_NAME
  - Queries first and shows a summary
  - Asks for confirmation before deleting

  Usage:
    node scripts/cleanup-orphan-blobs.js
    node scripts/cleanup-orphan-blobs.js --yes  # skip confirmation
*/

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

const DEFAULT_CONTAINER = "blobmmai"; // matches api/src/shared/azure-config.ts

function readLocalSettings() {
  try {
    const p = path.join(__dirname, "..", "local.settings.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

async function getBlobServiceClient() {
  const settings = readLocalSettings();
  const values = settings?.Values || {};

  const connStr =
    process.env.AzureWebJobsStorage ||
    process.env.AZURE_BLOB_CONNECTION_STRING ||
    values.AzureWebJobsStorage ||
    values.AZURE_BLOB_CONNECTION_STRING;

  if (connStr) {
    console.log("🔗 Using connection string from settings/env");
    return BlobServiceClient.fromConnectionString(connStr);
  }

  const accountName =
    process.env.AZURE_STORAGE_ACCOUNT_NAME || values.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error(
      "AZURE_STORAGE_ACCOUNT_NAME not set and no connection string found"
    );
  }
  console.log("🔐 Using DefaultAzureCredential with account:", accountName);
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );
}

function getArgFlag(name) {
  return process.argv.includes(name);
}

async function promptYesNo(question) {
  if (getArgFlag("--yes")) return true;
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

function hasProjectMetadata(meta) {
  if (!meta) return false;
  return Boolean(meta.project_id || meta.projectId || meta.project);
}

async function main() {
  const containerName = process.env.BLOB_CONTAINER || DEFAULT_CONTAINER;
  const service = await getBlobServiceClient();
  const container = service.getContainerClient(containerName);

  console.log(`📦 Target container: ${containerName}`);
  const exists = await container.exists();
  if (!exists) {
    console.error(`❌ Container '${containerName}' does not exist.`);
    process.exit(1);
  }

  console.log("🔍 Listing blobs (including metadata)...");
  const orphanBlobs = [];
  let totalCount = 0;

  const iter = container.listBlobsFlat({ includeMetadata: true });
  for await (const blob of iter) {
    totalCount++;
    const meta = blob.metadata || {};
    if (!hasProjectMetadata(meta)) {
      orphanBlobs.push({
        name: blob.name,
        size: blob.properties?.contentLength || 0,
        metadata: meta,
      });
    }
  }

  const totalOrphans = orphanBlobs.length;
  const totalSize = orphanBlobs.reduce((s, b) => s + (b.size || 0), 0);
  console.log("\n===== Scan Summary =====");
  console.log("Total blobs scanned:", totalCount);
  console.log("Blobs without project metadata:", totalOrphans);
  console.log(
    "Approx total size of orphans:",
    `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
  );
  if (totalOrphans > 0) {
    console.log("Sample (up to 10):");
    orphanBlobs.slice(0, 10).forEach((b, i) => {
      console.log(
        `${i + 1}. ${b.name}  size=${b.size}  metadataKeys=${Object.keys(
          b.metadata || {}
        ).join(",")}`
      );
    });
  }

  if (totalOrphans === 0) {
    console.log("✅ No orphan blobs found. Nothing to delete.");
    return;
  }

  const proceed = await promptYesNo(
    `⚠️ Delete ${totalOrphans} blobs WITHOUT project metadata from '${containerName}'?`
  );
  if (!proceed) {
    console.log("✋ Aborted. No deletions performed.");
    return;
  }

  // Delete with modest concurrency
  console.log("🗑️ Deleting orphan blobs...");
  const concurrency = 10;
  let deleted = 0;
  let failed = 0;

  async function worker(items) {
    for (const b of items) {
      try {
        await container.deleteBlob(b.name, { deleteSnapshots: "include" });
        deleted++;
        if (deleted % 50 === 0)
          console.log(`...deleted ${deleted}/${totalOrphans}`);
      } catch (err) {
        failed++;
        console.warn("⚠️ Failed to delete", b.name, err?.message || err);
      }
    }
  }

  const chunks = Array.from({ length: concurrency }, (_, i) =>
    orphanBlobs.filter((_, idx) => idx % concurrency === i)
  );
  await Promise.all(chunks.map(worker));

  console.log(`\n✅ Done. Deleted: ${deleted}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("❌ Unhandled error:", err?.message || err);
  process.exit(1);
});
