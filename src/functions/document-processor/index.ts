import { app, InvocationContext } from "@azure/functions";
import { AzureClients } from "../../shared/azure-config.js";
import { JobManager } from "../../shared/job-manager.js";
import { DocumentQueueClient } from "../../shared/queue-client.js";
import { DocumentConverter } from "../../shared/document-converter.js";
import {
  ProcessingJobMessage,
  ChunkingJobMessage,
} from "../../types/document-processing.js";
import { v4 as uuidv4 } from "uuid";

export async function documentProcessorHandler(
  queueItem: unknown,
  context: InvocationContext
): Promise<void> {
  context.log("Document processor triggered");

  try {
    // Parse queue message - Azure Functions runtime already decodes base64 for us
    let jobMessage: ProcessingJobMessage;

    if (typeof queueItem === "string") {
      // If it's a string, parse as JSON directly
      jobMessage = JSON.parse(queueItem);
    } else {
      // If it's already an object, use it directly
      jobMessage = queueItem as ProcessingJobMessage;
    }

    context.log(
      `Processing job ${jobMessage.jobId} for file ${jobMessage.fileName}`
    );

    const jobManager = new JobManager();
    const queueClient = new DocumentQueueClient();

    // Update job status to processing
    await jobManager.updateJobStatus(jobMessage.jobId, "processing", 10);

    let conversionResult;
    let documentType = "url"; // Default for URL processing
    const startTime = Date.now();

    if (jobMessage.inputType === "url") {
      // Handle URL processing
      context.log(`Processing URL: ${jobMessage.inputSource}`);

      // Extract depth and maxPages from repurposed fields
      const depth = jobMessage.fileSize || 2;
      const maxPages = jobMessage.mimeType?.includes("maxPages=")
        ? parseInt(jobMessage.mimeType.split("maxPages=")[1]) || 10
        : 10;

      context.log(
        `Starting URL crawling with depth=${depth}, maxPages=${maxPages}`
      );
      await jobManager.updateJobStatus(jobMessage.jobId, "processing", 20);

      // Create progress callback for real-time updates
      const progressCallback = async (
        currentUrl: string,
        pageCount: number,
        maxPages: number
      ) => {
        const progressPercent = Math.min(20 + (pageCount / maxPages) * 30, 50); // Progress from 20% to 50%
        const statusMessage = `Crawling: ${
          new URL(currentUrl).pathname
        } (${pageCount}/${maxPages})`;

        context.log(`Progress update: ${statusMessage} - ${progressPercent}%`);
        await jobManager.updateJobStatus(
          jobMessage.jobId,
          "processing",
          progressPercent,
          undefined, // no error message
          undefined, // no results yet
          statusMessage
        );
      };

      conversionResult = await DocumentConverter.convertUrl(
        jobMessage.inputSource,
        depth,
        maxPages,
        jobMessage.fileName || "url-content",
        progressCallback
      );

      context.log(
        `URL conversion completed. Pages crawled: ${
          conversionResult.pagesCrawled || 0
        }`
      );
      
      // Check if the conversion failed due to crawling errors (e.g., bot detection)
      if (conversionResult.metadata.error) {
        context.log(`URL processing failed: ${conversionResult.metadata.error}`);
        
        // Update job status to failed with detailed error information
        const jobResults = {
          markdownFiles: [],
          chunkFiles: [],
          indexedDocuments: 0,
          processingTimeMs: conversionResult.processingTimeMs || 0,
          pagesCrawled: conversionResult.pagesCrawled || 0,
          crawlErrors: conversionResult.crawlErrors || []
        };

        await jobManager.updateJobStatus(
          jobMessage.jobId,
          "failed",
          100,
          conversionResult.metadata.error,
          jobResults
        );
        
        context.log(`Job ${jobMessage.jobId} marked as failed due to crawling errors`);
        return;
      }
      
      await jobManager.updateJobStatus(jobMessage.jobId, "processing", 50);
    } else {
      // Handle file processing (existing logic)
      const fileBuffer = await downloadFromBlob(jobMessage.inputSource);

      await jobManager.updateJobStatus(jobMessage.jobId, "processing", 30);

      // Detect document type and convert
      const detectedType = DocumentConverter.detectDocumentType(
        jobMessage.fileName || "unknown",
        jobMessage.mimeType
      );

      if (!detectedType) {
        throw new Error(
          `Unsupported document type: ${jobMessage.mimeType || "unknown"}`
        );
      }

      documentType = detectedType;

      switch (documentType) {
        case "docx":
          conversionResult = await DocumentConverter.convertWord(
            fileBuffer,
            jobMessage.fileName || "document.docx"
          );
          break;
        case "xlsx":
          conversionResult = await DocumentConverter.convertExcel(
            fileBuffer,
            jobMessage.fileName || "spreadsheet.xlsx"
          );
          break;
        case "pptx":
          conversionResult = await DocumentConverter.convertPowerPoint(
            fileBuffer,
            jobMessage.fileName || "presentation.pptx"
          );
          break;
        case "pdf":
          conversionResult = await DocumentConverter.convertPDF(
            fileBuffer,
            jobMessage.fileName || "document.pdf"
          );
          break;
        case "txt":
          conversionResult = await DocumentConverter.convertText(
            fileBuffer,
            jobMessage.fileName || "document.txt",
            "txt"
          );
          break;
        case "md":
          conversionResult = await DocumentConverter.convertText(
            fileBuffer,
            jobMessage.fileName || "document.md",
            "md"
          );
          break;
        default:
          throw new Error(`Unsupported document type: ${documentType}`);
      }
    }

    await jobManager.updateJobStatus(jobMessage.jobId, "processing", 70);

    // Upload markdown to blob storage
    const markdownBlobName = await uploadMarkdownToBlob(
      conversionResult.markdown,
      jobMessage.projectId,
      jobMessage.fileName || "document",
      documentType
    );

    const processingTime = Date.now() - startTime;

    // Update job status and send to chunking queue
    await jobManager.updateJobStatus(jobMessage.jobId, "processing", 90);

    const chunkingMessage: ChunkingJobMessage = {
      jobId: jobMessage.jobId,
      markdownFiles: [markdownBlobName],
      projectId: jobMessage.projectId,
    };

    await queueClient.sendChunkingJob(chunkingMessage);

    // Update job with processing results
    const jobResults = {
      markdownFiles: [markdownBlobName],
      chunkFiles: [],
      indexedDocuments: 0,
      processingTimeMs: processingTime,
    };

    // Add pagesCrawled and crawlErrors for URL processing
    if (jobMessage.inputType === "url" && conversionResult.pagesCrawled) {
      (jobResults as any).pagesCrawled = conversionResult.pagesCrawled;
    }
    
    if (jobMessage.inputType === "url" && conversionResult.crawlErrors && conversionResult.crawlErrors.length > 0) {
      (jobResults as any).crawlErrors = conversionResult.crawlErrors;
    }

    await jobManager.updateJobStatus(
      jobMessage.jobId,
      "chunking",
      100,
      undefined,
      jobResults
    );

    context.log(`Successfully processed job ${jobMessage.jobId}`);
  } catch (error) {
    context.log(`Processing failed:`, error);

    // Extract job ID from message if possible
    let jobId: string | undefined;
    try {
      const messageText = Buffer.from(queueItem as string, "base64").toString();
      const jobMessage: ProcessingJobMessage = JSON.parse(messageText);
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

async function downloadFromBlob(blobName: string): Promise<Buffer> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  const containerName = "documents";
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);

  const downloadResponse = await blobClient.download();

  if (!downloadResponse.readableStreamBody) {
    throw new Error("Failed to download blob");
  }

  const chunks: Uint8Array[] = [];
  const stream = downloadResponse.readableStreamBody as any;

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    stream.on("error", (error: Error) => {
      reject(error);
    });
  });
}

async function uploadMarkdownToBlob(
  markdown: string,
  projectId: string,
  originalFileName: string,
  documentType: string
): Promise<string> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  const containerName = "processed-documents";
  const containerClient = blobServiceClient.getContainerClient(containerName);

  // Ensure container exists
  await containerClient.createIfNotExists();

  // Create unique blob name for markdown
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uniqueId = uuidv4().split("-")[0];
  const baseName = originalFileName.replace(/\.[^.]+$/, ""); // Remove extension
  const blobName = `${projectId}/markdown/${timestamp}-${uniqueId}-${baseName}.md`;

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.upload(markdown, Buffer.byteLength(markdown, "utf8"), {
    blobHTTPHeaders: {
      blobContentType: "text/markdown",
    },
    metadata: {
      originalFileName,
      projectId,
      documentType,
      processedAt: new Date().toISOString(),
    },
  });

  return blobName;
}

app.storageQueue("document-processor", {
  queueName: "document-processing",
  connection: "AzureWebJobsStorage",
  handler: documentProcessorHandler,
});
