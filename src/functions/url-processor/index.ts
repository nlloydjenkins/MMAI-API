import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { JobManager } from "../../shared/job-manager.js";
import { DocumentQueueClient } from "../../shared/queue-client.js";
import { ProcessingJobMessage } from "../../types/document-processing.js";
import {
  handleCors,
  createErrorResponse,
  createSuccessResponse,
} from "../../shared/utils.js";

interface UrlProcessRequest {
  url: string;
  userId: string;
  projectId?: string;
  depth?: number;
  maxPages?: number;
}

export async function urlProcessHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("URL process request received");

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    // Parse request body
    const body = await request.text();
    let requestData: UrlProcessRequest;

    try {
      requestData = JSON.parse(body);
    } catch {
      return createErrorResponse(
        400,
        "INVALID_JSON",
        "Invalid JSON in request body",
        request
      );
    }

    // Validate required fields
    const { url, userId, projectId, depth = 2, maxPages = 10 } = requestData;

    if (!url) {
      return createErrorResponse(
        400,
        "MISSING_URL",
        "URL is required",
        request
      );
    }

    if (!userId) {
      return createErrorResponse(
        400,
        "MISSING_USER_ID",
        "User ID is required",
        request
      );
    }

    if (!projectId) {
      return createErrorResponse(
        400,
        "MISSING_PROJECT_ID",
        "Project ID is required",
        request
      );
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return createErrorResponse(
          400,
          "INVALID_URL",
          "URL must use HTTP or HTTPS protocol",
          request
        );
      }
    } catch {
      return createErrorResponse(
        400,
        "INVALID_URL",
        "Invalid URL format",
        request
      );
    }

    // Validate depth and maxPages
    if (depth < 1 || depth > 5) {
      return createErrorResponse(
        400,
        "INVALID_DEPTH",
        "Depth must be between 1 and 5",
        request
      );
    }

    if (maxPages < 1 || maxPages > 100) {
      return createErrorResponse(
        400,
        "INVALID_MAX_PAGES",
        "Max pages must be between 1 and 100",
        request
      );
    }

    // Initialize managers
    const jobManager = new JobManager();
    const queueClient = new DocumentQueueClient();

    await jobManager.initializeTable();
    await queueClient.initializeQueues();

    // Create processing job for URL
    const job = await jobManager.createJob(
      userId,
      projectId,
      "url",
      url,
      `${new URL(url).hostname} (depth: ${depth}, max: ${maxPages})`
    );

    // Send to processing queue with URL-specific parameters
    const jobMessage: ProcessingJobMessage = {
      jobId: job.rowKey,
      userId: job.userId,
      projectId: job.projectId,
      inputType: "url",
      inputSource: url,
      fileName: `url-${new URL(url).hostname}-${Date.now()}`,
      // Store URL processing parameters in unused fields for now
      // We'll need to extend the type later for proper URL support
      fileSize: depth, // Repurposing fileSize for depth
      mimeType: `url/crawl;maxPages=${maxPages}`, // Encoding parameters in mimeType
    };

    await queueClient.sendProcessingJob(jobMessage);

    context.log(`URL processing job ${job.rowKey} created for ${url}`);

    return createSuccessResponse(
      {
        id: job.rowKey,
        userId: job.userId,
        projectId: job.projectId,
        inputType: job.inputType,
        inputSource: job.inputSource,
        fileName: job.fileName || "",
        fileSize: 0,
        mimeType: "url/crawl",
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
      200,
      request
    );
  } catch (error) {
    context.log("URL processing failed:", error);
    return createErrorResponse(
      500,
      "PROCESSING_FAILED",
      error instanceof Error ? error.message : "URL processing failed",
      request
    );
  }
}

app.http("url-process", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "documents/process-url",
  handler: urlProcessHandler,
});
