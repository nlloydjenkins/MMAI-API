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

interface DebugSearchResponse {
  totalDocuments: number;
  sampleDocuments: any[];
  searchResults: any[];
}

export async function debugSearch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a debugSearch request.");

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // Get Azure AI Search client
    const azureClients = AzureClients.getInstance();
    const searchClient = azureClients.getSearchClient();

    context.log("🔍 [DEBUG] Getting sample documents from search index");

    // First, try to get all available fields by doing a wildcard search
    const allFieldsOptions = {
      top: 3,
      select: ["*"], // Select all fields to see what's available
      queryType: "simple" as const,
    };

    const allFieldsResults = await searchClient.search("*", allFieldsOptions);
    const sampleDocuments: any[] = [];

    for await (const result of allFieldsResults.results) {
      sampleDocuments.push(result.document);
    }

    context.log("🔍 [DEBUG] Sample documents:", sampleDocuments);

    // Test a specific search to see what happens
    const testQuery = "meeting";
    const testSearchOptions = {
      top: 5,
      includeTotalCount: true,
      searchFields: ["content", "fileName", "chunk"],
      select: ["*"],
      highlight: "content,chunk",
      queryType: "simple" as const,
    };

    context.log(`🔍 [DEBUG] Testing search with query: "${testQuery}"`);
    const testResults = await searchClient.search(testQuery, testSearchOptions);

    const searchResults: any[] = [];
    for await (const result of testResults.results) {
      searchResults.push({
        document: result.document,
        score: result.score,
        highlights: result.highlights,
      });
    }

    context.log("🔍 [DEBUG] Test search results:", searchResults);

    const response: DebugSearchResponse = {
      totalDocuments: allFieldsResults.count || 0,
      sampleDocuments,
      searchResults,
    };

    return createSuccessResponse(response);
  } catch (error) {
    context.log("❌ [DEBUG] Error in debug search:", error);

    // Provide detailed error information
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.log("❌ [DEBUG] Detailed error:", errorMessage);

    return createErrorResponse(
      500,
      "DEBUG_SEARCH_ERROR",
      `Failed to debug search: ${errorMessage}`
    );
  }
}

app.http("debugSearch", {
  methods: ["POST", "GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "debug-search",
  handler: debugSearch,
});
