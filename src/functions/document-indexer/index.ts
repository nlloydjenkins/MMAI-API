import { app, InvocationContext } from "@azure/functions";
import { AzureClients } from "../../shared/azure-config.js";
import { JobManager } from "../../shared/job-manager.js";
import { DocumentChunker } from "../../shared/document-chunker.js";
import {
  IndexingJobMessage,
  DocumentChunk,
} from "../../types/document-processing.js";
import { SearchIndexClient } from "@azure/search-documents";

export async function documentIndexerHandler(
  queueItem: unknown,
  context: InvocationContext
): Promise<void> {
  context.log("Document indexer triggered");

  try {
    // Parse queue message - Azure Functions runtime already decodes base64 for us
    let jobMessage: IndexingJobMessage;

    if (typeof queueItem === "string") {
      // If it's a string, parse as JSON directly
      jobMessage = JSON.parse(queueItem);
    } else {
      // If it's already an object, use it directly
      jobMessage = queueItem as IndexingJobMessage;
    }

    context.log(`Indexing job ${jobMessage.jobId}`);

    const jobManager = new JobManager();

    // Update job status to indexing
    await jobManager.updateJobStatus(jobMessage.jobId, "indexing", 10);

    let totalIndexedDocuments = 0;

    // Process each chunk file
    for (const chunkBlobName of jobMessage.chunkFiles) {
      const jsonlContent = await downloadChunksFromBlob(chunkBlobName);
      const chunks = DocumentChunker.jsonlToChunks(jsonlContent);

      // Upload chunks to AI Search index
      await indexChunksInSearch(chunks, context);

      // Also upload to final blob storage for backup
      await uploadToIndexingBlob(
        jsonlContent,
        jobMessage.projectId,
        chunkBlobName
      );

      totalIndexedDocuments += chunks.length;

      context.log(`Indexed ${chunks.length} chunks from ${chunkBlobName}`);
    }

    await jobManager.updateJobStatus(jobMessage.jobId, "indexing", 80);

    // Update job status to completed
    const job = await jobManager.getJob(jobMessage.jobId);
    const finalResults = {
      markdownFiles: job?.results?.markdownFiles || [],
      chunkFiles: job?.results?.chunkFiles || [],
      indexedDocuments: totalIndexedDocuments,
      processingTimeMs: job?.results?.processingTimeMs || 0,
    };

    await jobManager.updateJobStatus(
      jobMessage.jobId,
      "completed",
      100,
      undefined,
      finalResults
    );

    context.log(
      `Successfully indexed job ${jobMessage.jobId} with ${totalIndexedDocuments} documents`
    );
  } catch (error) {
    context.log(`Indexing failed:`, error);

    // Extract job ID from message if possible
    let jobId: string | undefined;
    try {
      const messageText = Buffer.from(queueItem as string, "base64").toString();
      const jobMessage: IndexingJobMessage = JSON.parse(messageText);
      jobId = jobMessage.jobId;
    } catch {
      // Could not parse message
    }

    if (jobId) {
      const jobManager = new JobManager();
      await jobManager.updateJobStatus(
        jobId,
        "failed",
        0,
        error instanceof Error ? error.message : "Unknown error"
      );
    }

    throw error;
  }
}

async function downloadChunksFromBlob(blobName: string): Promise<string> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  const containerName = "chunked-documents";
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);

  const downloadResponse = await blobClient.download();

  if (!downloadResponse.readableStreamBody) {
    throw new Error("Failed to download chunks blob");
  }

  const chunks: Uint8Array[] = [];
  const stream = downloadResponse.readableStreamBody as any;

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer.toString("utf-8"));
    });

    stream.on("error", (error: Error) => {
      reject(error);
    });
  });
}

async function indexChunksInSearch(
  chunks: DocumentChunk[],
  context: InvocationContext
): Promise<void> {
  const azureClients = AzureClients.getInstance();
  const searchClient = azureClients.getSearchClient();

  // Convert chunks to search documents
  const searchDocuments = chunks.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    title: chunk.metadata.title || chunk.metadata.source_file || "Untitled",
    url: chunk.metadata.source_file || "",
    project_id: chunk.metadata.project_id || "",
    section_heading: "", // Not available in chunk metadata
    anchor: "", // Not available in chunk metadata
    breadcrumbs: [], // Not available in chunk metadata
    crawl_time: chunk.metadata.crawl_time || new Date().toISOString(),
    hash: "", // Not available in chunk metadata
  }));

  // Upload documents to search index in batches
  const batchSize = 100;
  for (let i = 0; i < searchDocuments.length; i += batchSize) {
    const batch = searchDocuments.slice(i, i + batchSize);

    try {
      const result = await searchClient.uploadDocuments(batch);
      context.log(
        `Uploaded batch of ${batch.length} documents to search index`
      );

      // Check for any failures
      const failures = result.results.filter((r) => !r.succeeded);
      if (failures.length > 0) {
        context.log(
          `Warning: ${failures.length} documents failed to index:`,
          failures.map((f) => ({ key: f.key, error: f.errorMessage }))
        );
      }
    } catch (error) {
      context.log(`Error uploading batch to search index:`, error);
      throw error;
    }
  }
}

async function uploadToIndexingBlob(
  jsonlContent: string,
  projectId: string,
  originalBlobName: string
): Promise<string> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  // Upload to the main blob container for AI search indexing
  const containerName = "blobmmai";
  const containerClient = blobServiceClient.getContainerClient(containerName);

  // Ensure container exists
  await containerClient.createIfNotExists();

  // Create blob name for final indexing
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = extractFileNameFromBlobName(originalBlobName);
  const blobName = `${projectId}/${timestamp}-${fileName}`;

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.upload(
    jsonlContent,
    Buffer.byteLength(jsonlContent, "utf8"),
    {
      blobHTTPHeaders: {
        blobContentType: "application/jsonl",
      },
      metadata: {
        projectId,
        indexedAt: new Date().toISOString(),
        originalBlobName,
      },
    }
  );

  return blobName;
}

function extractFileNameFromBlobName(blobName: string): string {
  // Extract filename from blob path
  const parts = blobName.split("/");
  const filename = parts[parts.length - 1];

  // Remove timestamp and UUID prefix if present
  const match = filename.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]+-(.+)$/
  );
  return match ? match[1] : filename;
}

app.storageQueue("document-indexer", {
  queueName: "document-indexing",
  connection: "AzureWebJobsStorage",
  handler: documentIndexerHandler,
});
