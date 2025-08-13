import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
} from "../../shared/utils";
import { AzureClients } from "../../shared/azure-config";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";

interface UpdateProjectIdsResponse {
  totalDocuments: number;
  documentsUpdated: number;
  documentsSkipped: number;
  errors: string[];
  updatedDocuments: any[];
}

export async function updateProjectIds(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Starting project_id update for all documents in search index");

  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();
    const searchClient = azureClients.getSearchClient();

    context.log("🔍 [UPDATE] Getting all documents from search index");

    // Get all documents in the index
    const allDocuments = await searchClient.search("*", {
      top: 1000, // Adjust if you have more than 1000 documents
      includeTotalCount: true,
      select: ["*"],
    });

    const documentsToUpdate: any[] = [];
    const errors: string[] = [];
    let documentsSkipped = 0;

    context.log(`🔍 [UPDATE] Found ${allDocuments.count || 0} total documents`);

    for await (const result of allDocuments.results) {
      const doc = result.document as any;

      try {
        // Skip if project_id is already set
        if (doc.project_id) {
          documentsSkipped++;
          continue;
        }

        // Try to extract project ID from metadata_storage_path
        let projectId = null;

        if (doc.metadata_storage_path) {
          // Pattern: /blobmmai/projectId/filename
          const pathMatch =
            doc.metadata_storage_path.match(/\/([^\/]+)\/[^\/]+$/);
          if (pathMatch) {
            projectId = pathMatch[1];
          }
        }

        // Alternative: try metadata_storage_name if path didn't work
        if (!projectId && doc.metadata_storage_name) {
          // Pattern: projectId/filename or projectId_filename
          const nameMatch = doc.metadata_storage_name.match(/^([^\/]+)\//);
          if (nameMatch) {
            projectId = nameMatch[1];
          }
        }

        // Alternative: try to extract from any field that might contain project info
        if (!projectId) {
          // Check if there's a projectId field (different case)
          if (doc.projectId) {
            projectId = doc.projectId;
          } else if (doc.project) {
            projectId = doc.project;
          }
        }

        if (projectId) {
          // Create update document
          const updateDoc = {
            "@search.action": "merge",
            id: doc.id,
            project_id: projectId,
          };

          documentsToUpdate.push(updateDoc);
          context.log(
            `🔍 [UPDATE] Will update document ${doc.id} with project_id: ${projectId}`
          );
        } else {
          const error = `Could not determine project_id for document ${doc.id}`;
          errors.push(error);
          context.log(`❌ [UPDATE] ${error}`);
        }
      } catch (docError) {
        const error = `Error processing document ${doc.id}: ${
          docError instanceof Error ? docError.message : String(docError)
        }`;
        errors.push(error);
        context.log(`❌ [UPDATE] ${error}`);
      }
    }

    context.log(
      `🔍 [UPDATE] Prepared ${documentsToUpdate.length} documents for update`
    );

    // Update documents in batches
    let documentsUpdated = 0;
    const batchSize = 50; // Azure Search recommends batches of 50-100 documents

    for (let i = 0; i < documentsToUpdate.length; i += batchSize) {
      const batch = documentsToUpdate.slice(i, i + batchSize);

      try {
        context.log(
          `🔍 [UPDATE] Updating batch ${Math.floor(i / batchSize) + 1} (${
            batch.length
          } documents)`
        );

        const uploadResult = await searchClient.uploadDocuments(batch);

        // Count successful updates
        const successCount = uploadResult.results.filter(
          (r) => r.succeeded
        ).length;
        documentsUpdated += successCount;

        // Log any failures in this batch
        const failures = uploadResult.results.filter((r) => !r.succeeded);
        failures.forEach((failure) => {
          const error = `Failed to update document ${failure.key}: ${failure.errorMessage}`;
          errors.push(error);
          context.log(`❌ [UPDATE] ${error}`);
        });

        context.log(
          `✅ [UPDATE] Batch completed: ${successCount}/${batch.length} successful`
        );
      } catch (batchError) {
        const error = `Batch update failed: ${
          batchError instanceof Error ? batchError.message : String(batchError)
        }`;
        errors.push(error);
        context.log(`❌ [UPDATE] ${error}`);
      }
    }

    const response: UpdateProjectIdsResponse = {
      totalDocuments: allDocuments.count || 0,
      documentsUpdated,
      documentsSkipped,
      errors,
      updatedDocuments: documentsToUpdate
        .map((doc) => ({
          id: doc.id,
          project_id: doc.project_id,
        }))
        .slice(0, 10), // Only return first 10 for brevity
    };

    context.log(
      `✅ [UPDATE] Update completed: ${documentsUpdated} updated, ${documentsSkipped} skipped, ${errors.length} errors`
    );

    return createSuccessResponse(response);
  } catch (error) {
    context.log("❌ [UPDATE] Error updating project IDs:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "UPDATE_ERROR",
      `Failed to update project IDs: ${errorMessage}`
    );
  }
}

app.http("updateProjectIds", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "search/update-project-ids",
  handler: updateProjectIds,
});
