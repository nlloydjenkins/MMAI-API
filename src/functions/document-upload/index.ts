import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import busboy from "busboy";
import { AzureClients } from "../../shared/azure-config.js";
import { JobManager } from "../../shared/job-manager.js";
import { DocumentQueueClient } from "../../shared/queue-client.js";
import { DocumentConverter } from "../../shared/document-converter.js";
import { ProcessingJobMessage } from "../../types/document-processing.js";
import {
  handleCors,
  createErrorResponse,
  createSuccessResponse,
} from "../../shared/utils.js";
import { v4 as uuidv4 } from "uuid";
import * as mimeTypes from "mime-types";

interface UploadedFile {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
}

interface UploadRequest {
  projectId: string;
  userId: string;
}

export async function documentUploadHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Document upload request received");

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    // Parse multipart form data
    const { files, fields } = await parseMultipartForm(request);

    if (files.length === 0) {
      return createErrorResponse(400, "NO_FILES", "No files uploaded", request);
    }

    // Validate required fields
    const projectId = fields.projectId;
    const userId = fields.userId || "anonymous";

    if (!projectId) {
      return createErrorResponse(
        400,
        "MISSING_PROJECT_ID",
        "Project ID is required",
        request
      );
    }

    // Process each uploaded file
    const results = [];
    const jobManager = new JobManager();
    const queueClient = new DocumentQueueClient();

    await jobManager.initializeTable();
    await queueClient.initializeQueues();

    for (const file of files) {
      try {
        // Validate file type
        const documentType = DocumentConverter.detectDocumentType(
          file.fileName,
          file.mimeType
        );
        if (!documentType) {
          results.push({
            fileName: file.fileName,
            success: false,
            error: "Unsupported file type",
          });
          continue;
        }

        // Validate file size (max 50MB)
        if (file.size > 50 * 1024 * 1024) {
          results.push({
            fileName: file.fileName,
            success: false,
            error: "File too large (max 50MB)",
          });
          continue;
        }

        // Upload file to blob storage
        const blobName = await uploadToBlob(file, projectId);

        // Create processing job
        const job = await jobManager.createJob(
          userId,
          projectId,
          "file",
          blobName,
          file.fileName,
          file.size,
          file.mimeType
        );

        // Send to processing queue
        const jobMessage: ProcessingJobMessage = {
          jobId: job.rowKey,
          userId: job.userId,
          projectId: job.projectId,
          inputType: "file",
          inputSource: blobName,
          fileName: file.fileName,
          fileSize: file.size,
          mimeType: file.mimeType,
        };

        await queueClient.sendProcessingJob(jobMessage);

        results.push({
          fileName: file.fileName,
          success: true,
          jobId: job.rowKey,
          blobName,
        });

        context.log(`File ${file.fileName} uploaded and queued for processing`);
      } catch (error) {
        context.log(`Failed to process file ${file.fileName}:`, error);
        results.push({
          fileName: file.fileName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return createSuccessResponse(
      {
        message: "Upload completed",
        results,
        totalFiles: files.length,
        successfulUploads: results.filter((r) => r.success).length,
      },
      200,
      request
    );
  } catch (error) {
    context.log("Upload failed:", error);
    return createErrorResponse(
      500,
      "UPLOAD_FAILED",
      error instanceof Error ? error.message : "Unknown error",
      request
    );
  }
}

async function parseMultipartForm(request: HttpRequest): Promise<{
  files: UploadedFile[];
  fields: Record<string, string>;
}> {
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};

  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    throw new Error("Content-Type must be multipart/form-data");
  }

  // Get request body as buffer
  let bodyBuffer: Buffer;
  if (!request.body) {
    throw new Error("No request body");
  }

  if (typeof request.body === "string") {
    bodyBuffer = Buffer.from(request.body);
  } else if (request.body instanceof ArrayBuffer) {
    bodyBuffer = Buffer.from(request.body);
  } else {
    // Handle ReadableStream
    const chunks: Uint8Array[] = [];
    const reader = (request.body as ReadableStream).getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      bodyBuffer = Buffer.concat(chunks);
    } finally {
      reader.releaseLock();
    }
  }

  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: { "content-type": contentType } });

    bb.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];

      file.on("data", (chunk) => {
        chunks.push(chunk);
      });

      file.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const detectedMimeType =
          mimeType || mimeTypes.lookup(filename) || "application/octet-stream";

        files.push({
          fileName: filename,
          mimeType: detectedMimeType,
          buffer,
          size: buffer.length,
        });
      });
    });

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("finish", () => {
      resolve({ files, fields });
    });

    bb.on("error", (err) => {
      reject(err);
    });

    bb.end(bodyBuffer);
  });
}

async function uploadToBlob(
  file: UploadedFile,
  projectId: string
): Promise<string> {
  const azureClients = AzureClients.getInstance();
  const blobServiceClient = azureClients.getBlobServiceClient();

  const containerName = "documents";
  const containerClient = blobServiceClient.getContainerClient(containerName);

  // Ensure container exists
  await containerClient.createIfNotExists();

  // Create unique blob name
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uniqueId = uuidv4().split("-")[0];
  const blobName = `${projectId}/${timestamp}-${uniqueId}-${file.fileName}`;

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.upload(file.buffer, file.buffer.length, {
    blobHTTPHeaders: {
      blobContentType: file.mimeType,
    },
    metadata: {
      originalFileName: file.fileName,
      projectId,
      uploadedAt: new Date().toISOString(),
    },
  });

  return blobName;
}

app.http("document-upload", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "documents/upload",
  handler: documentUploadHandler,
});
