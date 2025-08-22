import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { odata } from "@azure/data-tables";
import { DocumentQueueClient } from "../../shared/queue-client.js";
import { JobManager } from "../../shared/job-manager.js";

export async function queueStatusHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Queue status request received");

  try {
    const queueClient = new DocumentQueueClient();
    await queueClient.initializeQueues();

    const processingQueueLength = await queueClient.getQueueLength(
      "processing"
    );
    const chunkingQueueLength = await queueClient.getQueueLength("chunking");
    const indexingQueueLength = await queueClient.getQueueLength("indexing");

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queues: {
          processing: {
            name: "document-processing",
            length: processingQueueLength,
          },
          chunking: {
            name: "document-chunking",
            length: chunkingQueueLength,
          },
          indexing: {
            name: "document-indexing",
            length: indexingQueueLength,
          },
        },
        totalPendingJobs:
          processingQueueLength + chunkingQueueLength + indexingQueueLength,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.log("Failed to get queue status:", error);
    return {
      status: 500,
      body: JSON.stringify({
        error: "Failed to get queue status",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

export async function queueClearHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Queue clear request received");

  try {
    const url = new URL(request.url);
    const queueName = url.searchParams.get("queue") as
      | "processing"
      | "chunking"
      | "indexing"
      | null;

    if (
      !queueName ||
      !["processing", "chunking", "indexing"].includes(queueName)
    ) {
      return {
        status: 400,
        body: JSON.stringify({
          error:
            "Invalid queue name. Must be one of: processing, chunking, indexing",
        }),
      };
    }

    const queueClient = new DocumentQueueClient();
    await queueClient.clearQueue(queueName);

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Queue '${queueName}' cleared successfully`,
        queueName,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.log("Failed to clear queue:", error);
    return {
      status: 500,
      body: JSON.stringify({
        error: "Failed to clear queue",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

export async function systemStatsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("System stats request received");

  try {
    const jobManager = new JobManager();
    const queueClient = new DocumentQueueClient();

    await queueClient.initializeQueues();

    // Get overall job stats
    const jobStats = await jobManager.getJobStats();

    // Get queue lengths
    const processingQueueLength = await queueClient.getQueueLength(
      "processing"
    );
    const chunkingQueueLength = await queueClient.getQueueLength("chunking");
    const indexingQueueLength = await queueClient.getQueueLength("indexing");

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobs: jobStats,
        queues: {
          processing: processingQueueLength,
          chunking: chunkingQueueLength,
          indexing: indexingQueueLength,
          total:
            processingQueueLength + chunkingQueueLength + indexingQueueLength,
        },
        system: {
          status: "healthy",
          timestamp: new Date().toISOString(),
          version: "0.4.0",
        },
      }),
    };
  } catch (error) {
    context.log("Failed to get system stats:", error);
    return {
      status: 500,
      body: JSON.stringify({
        error: "Failed to get system stats",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

export async function cleanupJobsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Cleanup jobs request received");

  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam) : 30;

    if (days < 1 || days > 365) {
      return {
        status: 400,
        body: JSON.stringify({
          error: "Days parameter must be between 1 and 365",
        }),
      };
    }

    const jobManager = new JobManager();
    const deletedCount = await jobManager.cleanupOldJobs(days);

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Cleanup completed`,
        deletedJobs: deletedCount,
        olderThanDays: days,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.log("Failed to cleanup jobs:", error);
    return {
      status: 500,
      body: JSON.stringify({
        error: "Failed to cleanup jobs",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

export async function reactivateStuckJobsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Reactivate stuck jobs request received");

  try {
    const jobManager = new JobManager();
    const queueClient = new DocumentQueueClient();
    await queueClient.initializeQueues();

    // Get jobs in processing status by querying the table directly
    const tableClient = (jobManager as any).tableClient;
    const filter = odata`PartitionKey eq 'job' and status eq 'processing'`;

    const entities = tableClient.listEntities({
      queryOptions: { filter },
    });

    const stuckJobs = [];
    for await (const entity of entities) {
      stuckJobs.push(entity);
    }

    context.log(`Found ${stuckJobs.length} stuck jobs in processing status`);

    let requeued = 0;
    for (const job of stuckJobs) {
      try {
        // Create a processing job message to requeue the job
        const processingMessage = {
          jobId: job.rowKey as string,
          userId: job.userId as string,
          projectId: job.projectId as string,
          inputType: job.inputType as "file" | "url",
          inputSource: job.inputSource as string,
          fileName: job.fileName as string,
          fileSize: job.fileSize as number,
          mimeType: job.mimeType as string,
        };

        // Reset the job to queued status and requeue it
        await jobManager.updateJobStatus(job.rowKey as string, "queued", 0);
        await queueClient.sendProcessingJob(processingMessage);

        context.log(`Requeued job ${job.rowKey}`);
        requeued++;
      } catch (error) {
        context.log(`Failed to requeue job ${job.rowKey}:`, error);
      }
    }

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Reactivation completed`,
        stuckJobs: stuckJobs.length,
        requeued: requeued,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    context.log("Failed to reactivate stuck jobs:", error);
    return {
      status: 500,
      body: JSON.stringify({
        error: "Failed to reactivate stuck jobs",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

// Register HTTP functions
app.http("admin-queue-status", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "queues/status",
  handler: queueStatusHandler,
});

app.http("admin-queue-clear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "queues/clear",
  handler: queueClearHandler,
});

app.http("admin-system-stats", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "system/stats",
  handler: systemStatsHandler,
});

app.http("admin-cleanup-jobs", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "jobs/cleanup",
  handler: cleanupJobsHandler,
});

// Add admin route aliases for frontend compatibility
app.http("admin-queue-status-alias", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "api-admin/queues/status",
  handler: queueStatusHandler,
});

app.http("admin-queue-clear-alias", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "api-admin/queues/clear",
  handler: queueClearHandler,
});

app.http("admin-system-stats-alias", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "api-admin/system/stats",
  handler: systemStatsHandler,
});

app.http("admin-cleanup-jobs-alias", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "api-admin/jobs/cleanup",
  handler: cleanupJobsHandler,
});

app.http("admin-reactivate-stuck-jobs", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "jobs/reactivate",
  handler: reactivateStuckJobsHandler,
});
