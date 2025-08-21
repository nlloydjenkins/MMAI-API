import { TableServiceClient, TableClient, odata } from "@azure/data-tables";
import { AzureClients } from "./azure-config.js";
import { DefaultAzureCredential } from "@azure/identity";
import { ProcessingJob, DocumentStatus } from "../types/document-processing.js";
import { v4 as uuidv4 } from "uuid";

export class JobManager {
  private tableClient: TableClient;

  constructor() {
    // For now, create a separate table client for processing jobs
    // since AzureClients doesn't have this table configured yet
    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();

    if (!config.storage.accountName) {
      throw new Error("Azure Storage Account Name not configured");
    }

    const credential = new DefaultAzureCredential();
    this.tableClient = new TableClient(
      `https://${config.storage.accountName}.table.core.windows.net`,
      "processingJobs",
      credential
    );
  }

  async initializeTable(): Promise<void> {
    try {
      await this.tableClient.createTable();
    } catch (error: any) {
      // Table might already exist
      if (error.statusCode !== 409) {
        console.error("Failed to initialize jobs table:", error);
        throw error;
      }
    }
  }

  async createJob(
    userId: string,
    projectId: string,
    inputType: "file" | "url" | "folder",
    inputSource: string,
    fileName?: string,
    fileSize?: number,
    mimeType?: string
  ): Promise<ProcessingJob> {
    const jobId = uuidv4();
    const now = new Date();

    const job: ProcessingJob = {
      partitionKey: "job",
      rowKey: jobId,
      userId,
      projectId,
      inputType,
      inputSource,
      fileName,
      fileSize,
      mimeType,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.tableClient.createEntity(job);
    return job;
  }

  async getJob(jobId: string): Promise<ProcessingJob | null> {
    try {
      const entity = await this.tableClient.getEntity<any>("job", jobId);

      // Deserialize results if it exists and is a string
      if (entity.results && typeof entity.results === "string") {
        try {
          entity.results = JSON.parse(entity.results);
        } catch (e) {
          console.warn("Failed to parse results JSON:", e);
          entity.results = undefined;
        }
      }

      return entity as ProcessingJob;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async updateJobStatus(
    jobId: string,
    status: DocumentStatus,
    progress?: number,
    errorMessage?: string,
    results?: ProcessingJob["results"]
  ): Promise<void> {
    const updateData = {
      partitionKey: "job",
      rowKey: jobId,
      status,
      updatedAt: new Date(),
    } as any;

    if (progress !== undefined) {
      updateData.progress = progress;
    }

    if (errorMessage !== undefined) {
      updateData.errorMessage = errorMessage;
    }

    if (results !== undefined) {
      updateData.results = JSON.stringify(results);
    }

    await this.tableClient.updateEntity(updateData, "Merge");
  }

  async getUserJobs(
    userId: string,
    projectId?: string,
    limit: number = 50,
    continuationToken?: string
  ): Promise<{ jobs: ProcessingJob[]; continuationToken?: string }> {
    let filter = odata`PartitionKey eq 'job' and userId eq ${userId}`;

    if (projectId) {
      filter = odata`PartitionKey eq 'job' and userId eq ${userId} and projectId eq ${projectId}`;
    }

    const entities = this.tableClient.listEntities<ProcessingJob>({
      queryOptions: {
        filter,
        select: [
          "rowKey",
          "userId",
          "projectId",
          "inputType",
          "inputSource",
          "fileName",
          "fileSize",
          "mimeType",
          "status",
          "progress",
          "createdAt",
          "updatedAt",
          "errorMessage",
          "results",
        ],
      },
    });

    const jobs: ProcessingJob[] = [];
    let count = 0;

    for await (const entity of entities) {
      if (count >= limit) break;

      // Deserialize results if it exists and is a string
      if (entity.results && typeof entity.results === "string") {
        try {
          entity.results = JSON.parse(entity.results);
        } catch (e) {
          console.warn("Failed to parse results JSON:", e);
          entity.results = undefined;
        }
      }

      jobs.push(entity);
      count++;
    }

    // Sort by creation date, newest first
    jobs.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return { jobs };
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.tableClient.deleteEntity("job", jobId);
  }

  async getJobStats(
    userId?: string,
    projectId?: string
  ): Promise<{
    total: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    let filter = odata`PartitionKey eq 'job'`;

    if (userId) {
      filter = odata`PartitionKey eq 'job' and userId eq ${userId}`;
    }

    if (projectId) {
      filter = userId
        ? odata`PartitionKey eq 'job' and userId eq ${userId} and projectId eq ${projectId}`
        : odata`PartitionKey eq 'job' and projectId eq ${projectId}`;
    }

    const entities = this.tableClient.listEntities<ProcessingJob>({
      queryOptions: {
        filter,
        select: ["status"],
      },
    });

    const stats = {
      total: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for await (const entity of entities) {
      stats.total++;

      switch (entity.status) {
        case "queued":
          stats.queued++;
          break;
        case "processing":
        case "chunking":
        case "indexing":
          stats.processing++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "failed":
          stats.failed++;
          break;
      }
    }

    return stats;
  }

  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const entities = this.tableClient.listEntities<ProcessingJob>({
      queryOptions: {
        filter: odata`PartitionKey eq 'job'`,
        select: ["rowKey", "createdAt", "status"],
      },
    });

    const toDelete: string[] = [];

    for await (const entity of entities) {
      const createdAt = new Date(entity.createdAt);
      if (
        createdAt < cutoffDate &&
        (entity.status === "completed" || entity.status === "failed")
      ) {
        toDelete.push(entity.rowKey);
      }
    }

    // Delete in batches
    for (const jobId of toDelete) {
      try {
        await this.deleteJob(jobId);
      } catch (error) {
        console.error(`Failed to delete job ${jobId}:`, error);
      }
    }

    return toDelete.length;
  }
}
