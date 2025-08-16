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

    // Determine indexer name in this order:
    // 1) Explicit query param ?indexer=NAME
    // 2) Env var AZURE_SEARCH_INDEXER_NAME
    // 3) Auto-detect by listing indexers targeting the configured index
    const url = new URL(request.url);
    const queryIndexer = url.searchParams.get("indexer");
    const envIndexer = process.env.AZURE_SEARCH_INDEXER_NAME;
    const targetIndex = config.search.indexName;

    async function resolveIndexerName(): Promise<string> {
      if (queryIndexer) {
        context.log(
          `🔎 [REINDEX DEBUG] Using indexer from query: ${queryIndexer}`
        );
        return queryIndexer;
      }
      if (envIndexer) {
        context.log(`🔎 [REINDEX DEBUG] Using indexer from env: ${envIndexer}`);
        return envIndexer;
      }

      context.log(
        `🔎 [REINDEX DEBUG] Auto-detecting indexer targeting index '${targetIndex}'`
      );
      const candidates: string[] = [];
      const list = await (searchIndexerClient as any).listIndexers();
      // Handle both Promise<SearchIndexer[]> and async iterator shapes
      const pushIfCandidate = (idxr: any) => {
        if (!idxr || !idxr.name) return;
        const target = idxr.targetIndexName || idxr.targetIndex || "";
        if (target === targetIndex || String(idxr.name).includes(targetIndex)) {
          candidates.push(idxr.name as string);
        }
      };

      if (Array.isArray(list)) {
        for (const idxr of list) pushIfCandidate(idxr);
      } else if (list && typeof list === "object") {
        const asyncIt = (list as any)[Symbol.asyncIterator];
        if (typeof asyncIt === "function") {
          for await (const idxr of list as any) pushIfCandidate(idxr);
        } else if (Array.isArray((list as any).indexers)) {
          for (const idxr of (list as any).indexers) pushIfCandidate(idxr);
        }
      }
      context.log(
        `� [REINDEX DEBUG] Found ${
          candidates.length
        } candidate indexer(s): ${candidates.join(", ")}`
      );
      if (candidates.length === 0) {
        throw createErrorResponse(
          404,
          "INDEXER_NOT_FOUND",
          `No indexer found targeting index '${targetIndex}'. Set 'AZURE_SEARCH_INDEXER_NAME' or pass ?indexer=NAME.`
        );
      }
      // Prefer exact match by naming convention '<index>-indexer'
      const preferred = candidates.find(
        (n) => n === `${targetIndex}-indexer` || n === `indexer-${targetIndex}`
      );
      return preferred || candidates[0];
    }

    let indexerName: string;
    try {
      indexerName = await resolveIndexerName();
    } catch (e: any) {
      context.log("❌ [REINDEX DEBUG] Failed to resolve indexer:", e);
      // If e is already an HttpResponseInit from createErrorResponse, return it directly
      if (e && typeof e === "object" && "status" in e && "jsonBody" in e) {
        return e as HttpResponseInit;
      }
      return createErrorResponse(
        404,
        "INDEXER_NOT_FOUND",
        `No indexer available for index '${targetIndex}'.`
      );
    }

    context.log(`🔍 [REINDEX DEBUG] Running indexer: ${indexerName}`);

    try {
      // Run the indexer to reindex all data
      await searchIndexerClient.runIndexer(indexerName);

      context.log(`✅ [REINDEX DEBUG] Indexer run initiated successfully`);

      const response: ReindexResponse = {
        status: "initiated",
        indexerName,
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
