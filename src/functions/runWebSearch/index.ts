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

interface WebSearchRequest {
  query: string;
  count?: number;
  market?: string;
  safeSearch?: "Off" | "Moderate" | "Strict";
}

interface WebSearchResult {
  id: string;
  name: string;
  url: string;
  snippet: string;
  displayUrl: string;
  dateLastCrawled?: string;
  searchScore: number;
  sourceType: "web";
}

interface WebSearchResponse {
  results: WebSearchResult[];
  totalCount: number;
  queryExpansions?: string[];
}

export async function runWebSearch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a runWebSearch request.");

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
    const requestData = (await request.json()) as WebSearchRequest;
    context.log("Web search request:", requestData);

    if (!requestData.query) {
      return createErrorResponse(400, "VALIDATION_ERROR", "Query is required");
    }

    // Get Bing Search API configuration
    const bingApiKey = process.env.BING_SEARCH_API_KEY;
    const bingEndpoint = process.env.BING_SEARCH_ENDPOINT || "https://api.bing.microsoft.com/v7.0/search";

    if (!bingApiKey) {
      context.log("Bing Search API key not configured, returning empty results");
      const response: WebSearchResponse = {
        results: [],
        totalCount: 0,
        queryExpansions: [],
      };
      return createSuccessResponse(response);
    }

    // Build search parameters
    const searchParams = new URLSearchParams({
      q: requestData.query,
      count: String(requestData.count || 5),
      market: requestData.market || "en-US",
      safeSearch: requestData.safeSearch || "Moderate",
      responseFilter: "webpages",
      textFormat: "Raw"
    });

    const searchUrl = `${bingEndpoint}?${searchParams.toString()}`;
    context.log("🔍 [WEB SEARCH] Calling Bing Search API:", searchUrl);

    // Call Bing Search API
    const bingResponse = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": bingApiKey,
        "Accept": "application/json"
      }
    });

    if (!bingResponse.ok) {
      const errorText = await bingResponse.text();
      context.log("Bing Search API error:", errorText);
      return createErrorResponse(
        500,
        "BING_SEARCH_ERROR",
        `Bing Search API error: ${bingResponse.status}`
      );
    }

    const bingData = await bingResponse.json() as any;
    context.log("🔍 [WEB SEARCH] Bing Search response:", JSON.stringify(bingData, null, 2));

    // Transform Bing results to our format
    const results: WebSearchResult[] = [];
    const webPages = bingData.webPages?.value || [];

    for (let i = 0; i < webPages.length; i++) {
      const page = webPages[i];
      results.push({
        id: page.id || `web-${i}`,
        name: page.name || "Untitled",
        url: page.url || "",
        snippet: page.snippet || "",
        displayUrl: page.displayUrl || page.url || "",
        dateLastCrawled: page.dateLastCrawled,
        searchScore: 1.0 - (i * 0.1), // Decreasing relevance score
        sourceType: "web"
      });
    }

    const response: WebSearchResponse = {
      results,
      totalCount: bingData.webPages?.totalEstimatedMatches || results.length,
      queryExpansions: bingData.queryExpansions?.map((qe: any) => qe.text) || []
    };

    context.log(
      `🔍 [WEB SEARCH] Web search completed. Found ${results.length} results.`
    );

    return createSuccessResponse(response);
  } catch (error) {
    context.log("Error running web search:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "WEB_SEARCH_ERROR",
      `Failed to perform web search: ${errorMessage}`
    );
  }
}

app.http("runWebSearch", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "web-search",
  handler: runWebSearch,
});
