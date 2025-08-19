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

interface HybridSearchRequest {
  query: string;
  projectId?: string;
  top?: number;
  confidenceThreshold?: number; // Minimum confidence score for Azure AI Search results
  includeWebSearch?: boolean; // Whether to include web search results
  includeAiKnowledge?: boolean; // Whether to include AI knowledge fallback
}

interface SearchResult {
  id: string;
  content: string;
  fileName: string;
  score: number;
  highlights: string[];
  sourceType: "azure_search" | "ai_knowledge" | "web";
  url?: string; // For web search results
  snippet?: string; // For web search results
}

interface HybridSearchResponse {
  results: SearchResult[];
  totalCount: number;
  searchStrategies: {
    azureSearch: {
      attempted: boolean;
      resultCount: number;
      avgScore: number;
    };
    aiKnowledge: {
      attempted: boolean;
      resultCount: number;
      reason?: string;
    };
    webSearch: {
      attempted: boolean;
      resultCount: number;
      reason?: string;
    };
  };
  recommendation: "azure_only" | "ai_knowledge_used" | "web_fallback_used" | "full_hybrid";
}

export async function runHybridSearch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a runHybridSearch request.");

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
    const requestData = (await request.json()) as HybridSearchRequest;
    context.log("Hybrid search request:", requestData);

    if (!requestData.query) {
      return createErrorResponse(400, "VALIDATION_ERROR", "Query is required");
    }

    const confidenceThreshold = requestData.confidenceThreshold || 0.7;
    const topResults = requestData.top || 5;

    let azureResults: SearchResult[] = [];
    let aiKnowledgeResults: SearchResult[] = [];
    let webResults: SearchResult[] = [];
    let azureSearchAttempted = false;
    let aiKnowledgeAttempted = false;
    let webSearchAttempted = false;
    let aiKnowledgeReason = "";
    let webSearchReason = "";

    // Step 1: Try Azure AI Search first
    context.log("🔍 [HYBRID] Step 1: Attempting Azure AI Search");
    try {
      azureSearchAttempted = true;
      const azureClients = AzureClients.getInstance();
      const searchClient = azureClients.getSearchClient();

      const searchOptions: any = {
        top: topResults,
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

      const searchResults = await searchWithProjectFilter(
        searchClient,
        requestData.query,
        requestData.projectId || null,
        searchOptions,
        context
      );

      for await (const result of searchResults.results) {
        const doc = result.document;
        azureResults.push({
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
          sourceType: "azure_search"
        });
      }

      context.log(
        `🔍 [HYBRID] Azure AI Search found ${azureResults.length} results`
      );
    } catch (error) {
      context.log("Azure AI Search failed:", error);
      azureResults = [];
    }

    // Step 2: Evaluate Azure AI Search results quality
    const azureAvgScore = azureResults.length > 0 
      ? azureResults.reduce((sum, r) => sum + r.score, 0) / azureResults.length
      : 0;

    const highConfidenceResults = azureResults.filter(r => r.score >= confidenceThreshold);
    
    context.log(
      `🔍 [HYBRID] Azure results evaluation: ${azureResults.length} total, ${highConfidenceResults.length} high-confidence (>${confidenceThreshold}), avg score: ${azureAvgScore.toFixed(3)}`
    );

    // Step 3: Determine if AI knowledge fallback is needed
    let needsAiKnowledge = false;
    
    if (!requestData.includeAiKnowledge && requestData.includeAiKnowledge !== undefined) {
      // AI knowledge explicitly disabled
      aiKnowledgeReason = "disabled_by_request";
    } else if (azureResults.length === 0) {
      // No Azure results found
      needsAiKnowledge = true;
      aiKnowledgeReason = "no_azure_results";
    } else if (highConfidenceResults.length === 0) {
      // Low confidence Azure results
      needsAiKnowledge = true;
      aiKnowledgeReason = "low_confidence_azure_results";
    } else if (azureAvgScore < confidenceThreshold) {
      // Average score below threshold
      needsAiKnowledge = true;
      aiKnowledgeReason = "low_average_score";
    } else {
      // Azure results are good enough
      aiKnowledgeReason = "azure_results_sufficient";
    }

    // Step 4: Perform AI knowledge search if needed
    if (needsAiKnowledge) {
      context.log(`🔍 [HYBRID] Step 2: Performing AI knowledge search (reason: ${aiKnowledgeReason})`);
      try {
        aiKnowledgeAttempted = true;
        
        // Call our AI knowledge function
        const aiKnowledgeUrl = `${request.url.split('/api/')[0]}/api/ai-knowledge`;
        const aiKnowledgeResponse = await fetch(aiKnowledgeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: requestData.query,
            maxResults: Math.max(1, Math.ceil(topResults / 2))
          })
        });

        if (aiKnowledgeResponse.ok) {
          const aiKnowledgeData = await aiKnowledgeResponse.json() as any;
          const aiResults = aiKnowledgeData.results || [];

          for (const aiResult of aiResults) {
            aiKnowledgeResults.push({
              id: aiResult.id,
              content: aiResult.content,
              fileName: aiResult.fileName,
              score: aiResult.score,
              highlights: [],
              sourceType: "ai_knowledge"
            });
          }

          context.log(
            `🔍 [HYBRID] AI knowledge search found ${aiKnowledgeResults.length} results`
          );
        } else {
          context.log("AI knowledge search failed:", await aiKnowledgeResponse.text());
          aiKnowledgeReason = "ai_knowledge_api_failed";
        }
      } catch (error) {
        context.log("AI knowledge search error:", error);
        aiKnowledgeReason = "ai_knowledge_error";
      }
    }

    // Step 5: Determine if web search is still needed
    let needsWebSearch = false;
    const combinedResults = [...azureResults, ...aiKnowledgeResults];
    const combinedAvgScore = combinedResults.length > 0 
      ? combinedResults.reduce((sum, r) => sum + r.score, 0) / combinedResults.length
      : 0;
    
    if (!requestData.includeWebSearch) {
      // Web search explicitly disabled
      webSearchReason = "disabled_by_request";
    } else if (combinedResults.length === 0) {
      // No results from Azure or AI knowledge
      needsWebSearch = true;
      webSearchReason = "no_previous_results";
    } else if (combinedAvgScore < confidenceThreshold && azureResults.length < 2) {
      // Still low confidence and few Azure results
      needsWebSearch = true;
      webSearchReason = "still_low_confidence_results";
    } else {
      // Combined results are sufficient
      webSearchReason = "combined_results_sufficient";
    }

    // Step 6: Perform web search if needed
    if (needsWebSearch) {
      context.log(`🔍 [HYBRID] Step 3: Performing web search (reason: ${webSearchReason})`);
      try {
        webSearchAttempted = true;
        
        // Check if Bing Search API is configured
        const bingApiKey = process.env.BING_SEARCH_API_KEY;
        if (!bingApiKey) {
          context.log("Bing Search API key not configured, skipping web search");
          webSearchReason = "bing_api_not_configured";
        } else {
          // Call our web search function
          const webSearchUrl = `${request.url.split('/api/')[0]}/api/web-search`;
          const webSearchResponse = await fetch(webSearchUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              query: requestData.query,
              count: Math.max(1, topResults - combinedResults.length)
            })
          });

          if (webSearchResponse.ok) {
            const webSearchData = await webSearchResponse.json() as any;
            const webSearchResults = webSearchData.results || [];

            for (const webResult of webSearchResults) {
              webResults.push({
                id: webResult.id,
                content: webResult.snippet || "",
                fileName: webResult.name || "Web Result",
                score: webResult.searchScore || 0.5,
                highlights: [],
                sourceType: "web",
                url: webResult.url,
                snippet: webResult.snippet
              });
            }

            context.log(
              `🔍 [HYBRID] Web search found ${webResults.length} results`
            );
          } else {
            context.log("Web search failed:", await webSearchResponse.text());
            webSearchReason = "web_search_api_failed";
          }
        }
      } catch (error) {
        context.log("Web search error:", error);
        webSearchReason = "web_search_error";
      }
    }

    // Step 7: Combine and rank results
    const allResults = [...azureResults, ...aiKnowledgeResults, ...webResults];
    
    // Sort by score (descending) and limit to topResults
    allResults.sort((a, b) => b.score - a.score);
    const finalResults = allResults.slice(0, topResults);

    // Determine recommendation strategy
    let recommendation: "azure_only" | "ai_knowledge_used" | "web_fallback_used" | "full_hybrid";
    if (azureResults.length > 0 && aiKnowledgeResults.length > 0 && webResults.length > 0) {
      recommendation = "full_hybrid";
    } else if (azureResults.length > 0 && (aiKnowledgeResults.length > 0 || webResults.length > 0)) {
      recommendation = webResults.length > 0 ? "web_fallback_used" : "ai_knowledge_used";
    } else if (aiKnowledgeResults.length > 0 || webResults.length > 0) {
      recommendation = webResults.length > 0 ? "web_fallback_used" : "ai_knowledge_used";
    } else {
      recommendation = "azure_only";
    }

    const response: HybridSearchResponse = {
      results: finalResults,
      totalCount: allResults.length,
      searchStrategies: {
        azureSearch: {
          attempted: azureSearchAttempted,
          resultCount: azureResults.length,
          avgScore: azureAvgScore
        },
        aiKnowledge: {
          attempted: aiKnowledgeAttempted,
          resultCount: aiKnowledgeResults.length,
          reason: aiKnowledgeReason
        },
        webSearch: {
          attempted: webSearchAttempted,
          resultCount: webResults.length,
          reason: webSearchReason
        }
      },
      recommendation
    };

    context.log(
      `🔍 [HYBRID] Hybrid search completed. Final: ${finalResults.length} results (${azureResults.length} Azure + ${aiKnowledgeResults.length} AI Knowledge + ${webResults.length} Web). Strategy: ${recommendation}`
    );

    return createSuccessResponse(response);
  } catch (error) {
    context.log("Error running hybrid search:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "HYBRID_SEARCH_ERROR",
      `Failed to perform hybrid search: ${errorMessage}`
    );
  }
}

app.http("runHybridSearch", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "hybrid-search",
  handler: runHybridSearch,
});
