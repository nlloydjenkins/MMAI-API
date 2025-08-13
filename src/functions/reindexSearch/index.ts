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
import {
  SearchIndexerClient,
  AzureKeyCredential,
} from "@azure/search-documents";
import { getAzureConfig } from "../../shared/azure-config";

interface ReindexResponse {
  status: string;
  indexerName: string;
  message: string;
}

export async function reindexSearch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a reindexSearch request.");

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
        "Only POST method is supported"
      );
    }

    const config = getAzureConfig();

    // Validate search configuration
    if (!config.search.endpoint || !config.search.apiKey) {
      context.log("❌ [REINDEX DEBUG] Missing search configuration");
      return createErrorResponse(
        500,
        "SEARCH_NOT_CONFIGURED",
        "Azure Search is not properly configured"
      );
    }

    context.log("🔍 [REINDEX DEBUG] Creating search indexer client");

    // Create search indexer client using key credential (required for management operations)
    const searchIndexerClient = new SearchIndexerClient(
      config.search.endpoint,
      new AzureKeyCredential(config.search.apiKey)
    );

    // The indexer name from your screenshot
    const indexerName = "indexer-1753172373557";

    context.log(`🔍 [REINDEX DEBUG] Running indexer: ${indexerName}`);

    try {
      // Run the indexer to reindex all data
      const result = await searchIndexerClient.runIndexer(indexerName);

      context.log(`✅ [REINDEX DEBUG] Indexer run initiated successfully`);

      const response: ReindexResponse = {
        status: "initiated",
        indexerName: indexerName,
        message: "Search reindex has been initiated successfully",
      };

      return createSuccessResponse(response);
    } catch (indexerError: any) {
      context.log(`❌ [REINDEX DEBUG] Indexer run failed:`, indexerError);

      if (indexerError.statusCode === 404) {
        return createErrorResponse(
          404,
          "INDEXER_NOT_FOUND",
          `Indexer '${indexerName}' not found`
        );
      }

      return createErrorResponse(
        500,
        "INDEXER_ERROR",
        `Failed to run indexer: ${indexerError.message || "Unknown error"}`
      );
    }
  } catch (error: any) {
    context.log("❌ [REINDEX DEBUG] Unexpected error:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      `Reindex failed: ${error.message || "Unknown error"}`
    );
  }
}

app.http("reindexSearch", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "search/reindex",
  handler: reindexSearch,
});
