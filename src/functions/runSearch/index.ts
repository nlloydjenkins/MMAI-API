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
import { searchWithProjectFilter } from "../../shared/project-search-utils";

interface SearchRequest {
  query: string;
  top?: number;
  projectId?: string;
}

interface SearchResult {
  id: string;
  content: string;
  fileName: string;
  score: number;
  highlights?: string[];
}

interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
}

export async function runSearch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a runSearch request.");

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // Validate request method
    if (request.method !== "POST") {
      return createErrorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        "Only POST method is allowed"
      );
    }

    // Parse request body
    const requestData = (await request.json()) as SearchRequest;
    context.log("Search request:", requestData);

    if (!requestData.query) {
      return createErrorResponse(400, "VALIDATION_ERROR", "Query is required");
    }

    // Get Azure AI Search client
    const azureClients = AzureClients.getInstance();
    const searchClient = azureClients.getSearchClient();

    // Build search options
    const searchOptions: any = {
      top: requestData.top || 5,
      includeTotalCount: true,
      searchFields: ["content", "fileName", "chunk"],
      select: [
        "id",
        "content",
        "fileName",
        "projectId",
        "project_id",
        "chunk",
        "metadata_storage_name",
        "metadata_storage_path",
      ],
      highlight: "content,chunk",
      queryType: "simple" as const,
    };

    context.log("🔍 [SEARCH DEBUG] Search options:", searchOptions);
    context.log("🔍 [SEARCH DEBUG] Query:", requestData.query);
    context.log("🔍 [SEARCH DEBUG] ProjectId:", requestData.projectId);

    // Perform the search with automatic project filtering
    const searchResults = await searchWithProjectFilter(
      searchClient,
      requestData.query,
      requestData.projectId || null,
      searchOptions,
      context
    );

    const results: SearchResult[] = [];
    for await (const result of searchResults.results) {
      const doc = result.document;
      results.push({
        id: doc.id || doc.key || "unknown",
        content:
          doc.content ||
          doc.chunk ||
          doc.text ||
          JSON.stringify(doc).substring(0, 500),
        fileName:
          doc.fileName || doc.metadata_storage_name || doc.name || "unknown",
        score: result.score || 0,
        highlights:
          result.highlights?.content || result.highlights?.chunk || [],
      });
    }

    const response: SearchResponse = {
      results,
      totalCount: searchResults.count || 0,
    };

    context.log(
      `🔍 [SEARCH DEBUG] Search completed. Found ${
        results.length
      } results out of ${searchResults.count || 0} total.`
    );

    // Log first few results for debugging
    if (results.length > 0) {
      context.log(
        "🔍 [SEARCH DEBUG] Sample results:",
        results.slice(0, 2).map((r) => ({
          id: r.id,
          fileName: r.fileName,
          score: r.score,
          contentPreview: r.content.substring(0, 100) + "...",
        }))
      );
    }
    return createSuccessResponse(response);
  } catch (error) {
    context.log("Error running search:", error);

    // Provide more detailed error information for development
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.log("Detailed error:", errorMessage);

    return createErrorResponse(
      500,
      "SEARCH_ERROR",
      `Failed to search documents: ${errorMessage}`
    );
  }
}

app.http("runSearch", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "search",
  handler: runSearch,
});
