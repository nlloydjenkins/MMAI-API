import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureClients } from "../../shared/azure-config.js";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
} from "../../shared/utils.js";

interface BlobDocument {
  name: string;
  documentName: string;
  projectId: string;
  projectName?: string;
  size: number;
  lastModified: string;
  container: string;
  url?: string;
}

interface BlobListResponse {
  documents: BlobDocument[];
  totalCount: number;
}

interface Project {
  id: string;
  name: string;
}

export async function blobStorageHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Blob storage handler triggered");

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCors(request) || { status: 200 };
  }

  try {
    switch (request.method) {
      case "GET":
        return await listBlobDocuments(request, context);
      case "DELETE":
        const deleteAll = request.query.get("deleteAll");
        if (deleteAll === "true") {
          return await deleteAllBlobDocuments(request, context);
        } else {
          return await deleteBlobDocument(request, context);
        }
      default:
        return createErrorResponse(
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed"
        );
    }
  } catch (error) {
    context.log("Error in blob storage handler:", error);
    return createErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
  }
}

async function listBlobDocuments(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Listing blob documents");

  try {
    const projectIdFilter = request.query.get("projectId");

    const azureClients = AzureClients.getInstance();
    const blobServiceClient = azureClients.getBlobServiceClient();
    const tableClient = azureClients.getTableClient();
    const config = azureClients.getConfig();

    // Helper function to extract document name from blob path
    const extractDocumentName = (blobName: string): string => {
      // Remove any path prefixes and get the actual filename
      const pathParts = blobName.split("/");
      const fileName = pathParts[pathParts.length - 1];

      // For processed files, remove timestamp and UUID prefixes
      // Format like: 2025-08-20T13-32-38-339Z-abc123ef-originalname.md
      const timestampPattern =
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]+-/;
      if (timestampPattern.test(fileName)) {
        return fileName.replace(timestampPattern, "");
      }

      // For chunked files, extract original name
      // Format like: chunks/2025-08-20T13-32-38-339Z-abc123ef-originalname.jsonl
      if (
        fileName.includes("-") &&
        (fileName.endsWith(".jsonl") || fileName.endsWith(".md"))
      ) {
        const parts = fileName.split("-");
        if (parts.length >= 6) {
          // Rejoin everything after the UUID part
          const uuidIndex = parts.findIndex((part) =>
            /^[a-f0-9]{8}$/.test(part)
          );
          if (uuidIndex >= 0 && uuidIndex < parts.length - 1) {
            return parts.slice(uuidIndex + 1).join("-");
          }
        }
      }

      return fileName;
    };

    // Get all projects for name lookup
    const projectsMap = new Map<string, string>();
    try {
      const projectEntities = tableClient.listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${config.projects.partitionKey}'`,
        },
      });

      for await (const entity of projectEntities) {
        projectsMap.set(entity.rowKey as string, entity.name as string);
      }
    } catch (error) {
      context.log("Warning: Could not load projects for name lookup:", error);
    }

    // List containers to check
    const containersToCheck = ["blobmmai", "chunked-documents", "indexing"];
    const allDocuments: BlobDocument[] = [];

    for (const containerName of containersToCheck) {
      try {
        const containerClient =
          blobServiceClient.getContainerClient(containerName);
        const exists = await containerClient.exists();

        if (!exists) {
          context.log(`Container ${containerName} does not exist, skipping`);
          continue;
        }

        // List blobs in this container
        const blobsIter = containerClient.listBlobsFlat({
          includeMetadata: true,
          includeSnapshots: false,
          includeTags: false,
          includeVersions: false,
        });

        for await (const blobItem of blobsIter) {
          // Extract project ID from blob name (assuming format: projectId/filename)
          const pathParts = blobItem.name.split("/");
          let blobProjectId: string | undefined;

          if (pathParts.length >= 2) {
            // Standard format: projectId/filename
            blobProjectId = pathParts[0];
          } else {
            // Check metadata for project ID
            blobProjectId = blobItem.metadata?.projectId;
          }

          // Skip if we can't determine project ID
          if (!blobProjectId) {
            continue;
          }

          // Apply project filter if specified
          if (projectIdFilter && blobProjectId !== projectIdFilter) {
            continue;
          }

          const document: BlobDocument = {
            name: blobItem.name,
            documentName: extractDocumentName(blobItem.name),
            projectId: blobProjectId,
            projectName: projectsMap.get(blobProjectId) || "Unknown Project",
            size: blobItem.properties.contentLength || 0,
            lastModified: blobItem.properties.lastModified?.toISOString() || "",
            container: containerName,
          };

          allDocuments.push(document);
        }
      } catch (containerError) {
        context.log(
          `Error processing container ${containerName}:`,
          containerError
        );
        // Continue with other containers
      }
    }

    // Sort by last modified (newest first)
    allDocuments.sort(
      (a, b) =>
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    const response: BlobListResponse = {
      documents: allDocuments,
      totalCount: allDocuments.length,
    };

    context.log(`Found ${allDocuments.length} blob documents`);
    return createSuccessResponse(response);
  } catch (error) {
    context.log("Error listing blob documents:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to list blob documents"
    );
  }
}

async function deleteAllBlobDocuments(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Deleting all blob documents");

  try {
    const projectIdFilter = request.query.get("projectId");

    const azureClients = AzureClients.getInstance();
    const blobServiceClient = azureClients.getBlobServiceClient();

    // List containers to clear
    const containersToCheck = ["blobmmai", "chunked-documents", "indexing"];
    let totalDeleted = 0;
    const deletionResults: {
      container: string;
      deleted: number;
      errors: number;
    }[] = [];

    for (const containerName of containersToCheck) {
      let deletedInContainer = 0;
      let errorsInContainer = 0;

      try {
        const containerClient =
          blobServiceClient.getContainerClient(containerName);
        const exists = await containerClient.exists();

        if (!exists) {
          context.log(`Container ${containerName} does not exist, skipping`);
          deletionResults.push({
            container: containerName,
            deleted: 0,
            errors: 0,
          });
          continue;
        }

        // List blobs in this container
        const blobsIter = containerClient.listBlobsFlat({
          includeMetadata: true,
        });

        const blobsToDelete: string[] = [];

        for await (const blobItem of blobsIter) {
          // Extract project ID from blob name (assuming format: projectId/filename)
          const pathParts = blobItem.name.split("/");
          let blobProjectId: string | undefined;

          if (pathParts.length >= 2) {
            // Standard format: projectId/filename
            blobProjectId = pathParts[0];
          } else {
            // Check metadata for project ID
            blobProjectId = blobItem.metadata?.projectId;
          }

          // Apply project filter if specified
          if (projectIdFilter && blobProjectId !== projectIdFilter) {
            continue;
          }

          blobsToDelete.push(blobItem.name);
        }

        // Delete blobs in batches
        for (const blobName of blobsToDelete) {
          try {
            const blobClient = containerClient.getBlobClient(blobName);
            await blobClient.deleteIfExists({
              deleteSnapshots: "include",
            });
            deletedInContainer++;
            totalDeleted++;
          } catch (deleteError) {
            context.log(`Error deleting blob ${blobName}:`, deleteError);
            errorsInContainer++;
          }
        }

        deletionResults.push({
          container: containerName,
          deleted: deletedInContainer,
          errors: errorsInContainer,
        });
      } catch (containerError) {
        context.log(
          `Error processing container ${containerName}:`,
          containerError
        );
        deletionResults.push({
          container: containerName,
          deleted: 0,
          errors: 1,
        });
      }
    }

    context.log(
      `Successfully deleted ${totalDeleted} blob documents across all containers`
    );

    return createSuccessResponse({
      message: `Successfully deleted ${totalDeleted} documents`,
      totalDeleted,
      deletionResults,
      projectId: projectIdFilter || "all",
    });
  } catch (error) {
    context.log("Error deleting all blob documents:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to delete all blob documents"
    );
  }
}

async function deleteBlobDocument(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Deleting blob document");

  try {
    const blobName = request.query.get("blobName");
    const containerName = request.query.get("container");

    if (!blobName || !containerName) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "blobName and container are required"
      );
    }

    const azureClients = AzureClients.getInstance();
    const blobServiceClient = azureClients.getBlobServiceClient();

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    // Check if blob exists
    const exists = await blobClient.exists();
    if (!exists) {
      return createErrorResponse(404, "NOT_FOUND", "Blob not found");
    }

    // Delete the blob
    await blobClient.deleteIfExists({
      deleteSnapshots: "include",
    });

    context.log(`Successfully deleted blob: ${containerName}/${blobName}`);
    return createSuccessResponse({
      message: "Blob deleted successfully",
      blobName,
      container: containerName,
    });
  } catch (error) {
    context.log("Error deleting blob document:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to delete blob document"
    );
  }
}

app.http("blob-storage", {
  methods: ["GET", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "storage/blobs",
  handler: blobStorageHandler,
});
