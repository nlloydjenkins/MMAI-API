import { app, InvocationContext } from "@azure/functions";
import { AzureClients } from "../../shared/azure-config.js";
import { JobManager } from "../../shared/job-manager.js";
import { DocumentQueueClient } from "../../shared/queue-client.js";
import { DocumentChunker } from "../../shared/document-chunker.js";
import {
  ChunkingJobMessage,
  IndexingJobMessage,
} from "../../types/document-processing.js";
import { v4 as uuidv4 } from "uuid";

export async function documentChunkerHandler(
  queueItem: unknown,
  context: InvocationContext
): Promise<void> {
  context.log("Document chunker triggered");

  try {
    // Parse queue message - Azure Functions runtime already decodes base64 for us
    let jobMessage: ChunkingJobMessage;

    if (typeof queueItem === "string") {
      // If it's a string, parse as JSON directly
      jobMessage = JSON.parse(queueItem);
    } else {
      // If it's already an object, use it directly
      jobMessage = queueItem as ChunkingJobMessage;
    }

    context.log(`Chunking job ${jobMessage.jobId}`);

    const jobManager = new JobManager();
    const queueClient = new DocumentQueueClient();

    // Update job status to chunking
    await jobManager.updateJobStatus(jobMessage.jobId, "chunking", 10);

    // Download markdown files and chunk them
    const chunkFiles: string[] = [];

    for (const markdownBlobName of jobMessage.markdownFiles) {
      const markdownContent = await downloadMarkdownFromBlob(markdownBlobName);
      const fileName = extractFileNameFromBlobName(markdownBlobName);

      // Chunk the markdown content
      const chunks = DocumentChunker.chunkMarkdown(
        markdownContent,
        jobMessage.projectId,
        fileName
      );

      // Convert to JSONL format
      const jsonl = DocumentChunker.chunksToJsonl(chunks);

      // Upload chunks to blob storage
      const chunkBlobName = await uploadChunksToBlob(
        jsonl,
        jobMessage.projectId,
        fileName
      );

      chunkFiles.push(chunkBlobName);

      context.log(`Chunked ${chunks.length} pieces from ${fileName}`);
    }

    await jobManager.updateJobStatus(jobMessage.jobId, "chunking", 80);

    // Send to indexing queue
    const indexingMessage: IndexingJobMessage = {
      jobId: jobMessage.jobId,
      chunkFiles,
      projectId: jobMessage.projectId,
    };

    await queueClient.sendIndexingJob(indexingMessage);

    // Update job status
    const job = await jobManager.getJob(jobMessage.jobId);
    const updatedResults = {
      markdownFiles: job?.results?.markdownFiles || [],
      chunkFiles,
      indexedDocuments: job?.results?.indexedDocuments || 0,
      processingTimeMs: job?.results?.processingTimeMs || 0,
      ...(job?.results?.pagesCrawled && {
        pagesCrawled: job.results.pagesCrawled,
      }),
    };

    await jobManager.updateJobStatus(
      jobMessage.jobId,
      "indexing",
      100,
      undefined,
      updatedResults
    );

    context.log(`Successfully chunked job ${jobMessage.jobId}`);
  } catch (error) {
    context.log(`Chunking failed:`, error);

    // Extract job ID from message if possible
    let jobId: string | undefined;
    try {
      const messageText = Buffer.from(queueItem as string, "base64").toString();
      const jobMessage: ChunkingJobMessage = JSON.parse(messageText);
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

async function downloadMarkdownFromBlob(blobName: string): Promise<string> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  const containerName = "processed-documents";
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);

  const downloadResponse = await blobClient.download();

  if (!downloadResponse.readableStreamBody) {
    throw new Error("Failed to download markdown blob");
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

async function uploadChunksToBlob(
  jsonl: string,
  projectId: string,
  originalFileName: string
): Promise<string> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  const containerName = "chunked-documents";
  const containerClient = blobServiceClient.getContainerClient(containerName);

  // Ensure container exists
  await containerClient.createIfNotExists();

  // Create unique blob name for chunks
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uniqueId = uuidv4().split("-")[0];
  const baseName = originalFileName.replace(/\.[^.]+$/, ""); // Remove extension
  const blobName = `${projectId}/chunks/${timestamp}-${uniqueId}-${baseName}.jsonl`;

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.upload(jsonl, Buffer.byteLength(jsonl, "utf8"), {
    blobHTTPHeaders: {
      blobContentType: "application/jsonl",
    },
    metadata: {
      originalFileName,
      projectId,
      chunkedAt: new Date().toISOString(),
    },
  });

  return blobName;
}

function extractFileNameFromBlobName(blobName: string): string {
  // Extract filename from blob path like "projectId/markdown/timestamp-uuid-filename.md"
  const parts = blobName.split("/");
  const filename = parts[parts.length - 1];

  // Remove timestamp and UUID prefix
  const match = filename.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]+-(.+)$/
  );
  return match ? match[1] : filename;
}

app.storageQueue("document-chunker", {
  queueName: "document-chunking",
  connection: "AzureWebJobsStorage",
  handler: documentChunkerHandler,
});
