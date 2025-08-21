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

interface CheckProjectIdsResponse {
  totalDocuments: number;
  documentsWithProjectId: number;
  documentsWithoutProjectId: number;
  sampleDocuments: any[];
  pathPatterns: string[];
}

export async function checkProjectIds(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Checking project_id status for all documents in search index");

  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    const azureClients = AzureClients.getInstance();
    const searchClient = azureClients.getSearchClient();

    context.log("🔍 [CHECK] Getting all documents from search index");

    // Get all documents in the index
    const allDocuments = await searchClient.search("*", {
      top: 1000, // Adjust if you have more than 1000 documents
      includeTotalCount: true,
      select: ["*"],
    });

    let documentsWithProjectId = 0;
    let documentsWithoutProjectId = 0;
    const sampleDocuments: any[] = [];
    const pathPatterns = new Set<string>();

    context.log(`🔍 [CHECK] Found ${allDocuments.count || 0} total documents`);

    for await (const result of allDocuments.results) {
      const doc = result.document as any;

      if (doc.project_id) {
        documentsWithProjectId++;
      } else {
        documentsWithoutProjectId++;
      }

      // Collect sample documents (first 10 without project_id)
      if (!doc.project_id && sampleDocuments.length < 10) {
        sampleDocuments.push({
          id: doc.id,
          metadata_storage_path: doc.metadata_storage_path,
          metadata_storage_name: doc.metadata_storage_name,
          content: doc.content
            ? doc.content.substring(0, 100) + "..."
            : "No content",
          project_id: doc.project_id,
          projectId: doc.projectId,
          project: doc.project,
        });
      }

      // Collect path patterns to understand structure
      if (doc.metadata_storage_path) {
        pathPatterns.add(doc.metadata_storage_path);
      }
    }

    const response: CheckProjectIdsResponse = {
      totalDocuments: allDocuments.count || 0,
      documentsWithProjectId,
      documentsWithoutProjectId,
      sampleDocuments,
      pathPatterns: Array.from(pathPatterns).slice(0, 20), // First 20 patterns
    };

    context.log(
      `✅ [CHECK] Status: ${documentsWithProjectId} with project_id, ${documentsWithoutProjectId} without`
    );

    return createSuccessResponse(response, 200, request);
  } catch (error) {
    context.log("❌ [CHECK] Error checking project IDs:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "CHECK_ERROR",
      `Failed to check project IDs: ${errorMessage}`,
      request
    );
  }
}

app.http("checkProjectIds", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "search/check-project-ids",
  handler: checkProjectIds,
});
