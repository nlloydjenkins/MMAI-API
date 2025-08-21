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
import { PromptRequest, PromptResponse } from "../../shared/types";
import { AzureClients } from "../../shared/azure-config";
import { searchWithProjectFilter } from "../../shared/project-search-utils";

interface SearchResult {
  id: string;
  content: string;
  fileName: string;
  score: number;
  highlights?: string[];
}

// Internal function to search for relevant documents
async function searchRelevantDocuments(
  query: string,
  projectId?: string,
  context?: InvocationContext
): Promise<SearchResult[]> {
  try {
    const azureClients = AzureClients.getInstance();
    const searchClient = azureClients.getSearchClient();

    const searchOptions: any = {
      top: 5, // Limit to top 5 most relevant documents
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

    context?.log(
      "🔍 [PROMPT SEARCH DEBUG] Searching for relevant documents with query:",
      query
    );
    context?.log("🔍 [PROMPT SEARCH DEBUG] ProjectId:", projectId);

    // Use the smart project filtering utility
    const searchResults = await searchWithProjectFilter(
      searchClient,
      query,
      projectId || null,
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

    context?.log(
      `🔍 [PROMPT SEARCH DEBUG] Found ${results.length} relevant documents`
    );

    // Log search results for debugging
    if (results.length > 0) {
      context?.log(
        "🔍 [PROMPT SEARCH DEBUG] Sample search results:",
        results.slice(0, 2).map((r) => ({
          fileName: r.fileName,
          score: r.score,
          contentPreview: r.content.substring(0, 100) + "...",
        }))
      );
    } else {
      context?.log(
        "🔍 [PROMPT SEARCH DEBUG] No documents found - checking if this is expected"
      );
    }
    return results;
  } catch (error) {
    context?.log("Error searching documents:", error);
    return []; // Return empty array if search fails, don't break the prompt flow
  }
}

export async function runPrompt(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a runPrompt request.");

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
        "Only POST method is allowed",
        request
      );
    }

    // Parse request body
    const requestData = (await request.json()) as PromptRequest;
    context.log("Prompt request:", requestData);

    if (!requestData.question) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Question is required",
        request
      );
    }

    // Get Azure OpenAI configuration
    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();

    // Search for relevant documents using AI Search
    context.log("Searching for relevant documents...");
    const searchResults = await searchRelevantDocuments(
      requestData.question,
      requestData.projectId,
      context
    );

    // Construct the prompt with search results context
    let contextualPrompt = requestData.question;

    if (searchResults.length > 0) {
      const searchContext = searchResults
        .map((result, index) => {
          const highlightText =
            result.highlights && result.highlights.length > 0
              ? result.highlights.join("...")
              : result.content.substring(0, 500) + "...";

          return `**Document ${index + 1}: ${
            result.fileName
          }** (Relevance: ${result.score.toFixed(2)})
${highlightText}`;
        })
        .join("\n\n");

      contextualPrompt = `Based on the following relevant documents from your knowledge base:

${searchContext}

---

Question: ${requestData.question}

Please provide a comprehensive answer based on the information in the documents above. If the documents don't contain sufficient information to answer the question, please indicate what additional information might be needed.`;
    } else {
      context.log(
        "No relevant documents found, proceeding with general knowledge"
      );
      contextualPrompt = `${requestData.question}

Note: No specific documents were found in your knowledge base related to this question. This response is based on general knowledge.`;
    }

    // Also include any additional search results passed in the request (for backward compatibility)
    if (requestData.searchResults && requestData.searchResults.length > 0) {
      const additionalContext = requestData.searchResults
        .map(
          (result, index) =>
            `Additional Context ${index + 1}: ${JSON.stringify(result)}`
        )
        .join("\n");
      contextualPrompt += `\n\nAdditional Context:\n${additionalContext}`;
    }

    // Call Azure OpenAI
    const endpoint =
      config.openai.endpoint &&
      config.openai.endpoint !== "REPLACE_WITH_YOUR_ENDPOINT_HERE"
        ? config.openai.endpoint
        : "https://openai-meetingmate.openai.azure.com/";

    const openaiUrl = `${endpoint}openai/deployments/${config.openai.deployment}/chat/completions?api-version=${config.openai.apiVersion}`;
    context.log("Calling Azure OpenAI URL:", openaiUrl);

    try {
      // Extract generation settings (fallback to conservative defaults)
      const temperature =
        typeof (requestData as any).temperature === "number"
          ? Math.max(0, Math.min(1, (requestData as any).temperature))
          : 0.7;
      const topP =
        typeof (requestData as any).topP === "number"
          ? Math.max(0, Math.min(1, (requestData as any).topP))
          : 1.0;

      const response = await fetch(openaiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.openai.apiKey,
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                requestData.systemPrompt ||
                "You are a helpful AI assistant specialized in meeting preparation, agenda creation, and strategic advice. When provided with relevant documents from the user's knowledge base, prioritize information from those documents in your response. Always cite specific documents when referencing information from them. If the provided documents don't contain sufficient information to fully answer the question, clearly indicate what additional information might be helpful. Provide clear, structured, and actionable responses.",
            },
            {
              role: "user",
              content: contextualPrompt,
            },
          ],
          model: config.openai.deployment,
          // Note: Azure OpenAI Chat Completions supports both max_tokens and max_completion_tokens in some API versions.
          // Keep the existing field but can be adjusted if needed.
          max_completion_tokens: 1500,
          temperature,
          top_p: topP,
          frequency_penalty: 0.0,
          presence_penalty: 0.0,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        context.log("OpenAI API error (raw suppressed to client)");
        context.log("OpenAI API error detail:", errorText);

        const debugAllowed = process.env.OPENAI_DEBUG === "true";
        if (debugAllowed) {
          context.log(
            "Returning verbose OpenAI debug response (OPENAI_DEBUG=true)"
          );
          const debugResponse = `⚠️ **Development Mode - Azure OpenAI API Error**\n\n**Original Prompt Sent:**\n${contextualPrompt}\n\n**API Error Details:**\n${errorText}\n\n**Configuration Check:**\n- Endpoint: ${config.openai.endpoint}\n- Deployment: ${config.openai.deployment}\n- API Version: ${config.openai.apiVersion}\n\nThis shows the actual prompt that was sent to Azure OpenAI. In production, this would return AI-generated strategic advice based on your project data.\n\n**Troubleshooting Steps:**\n1. Verify Azure OpenAI endpoint URL is correct\n2. Check API key permissions and validity\n3. Ensure deployment name matches Azure resource\n4. Confirm quota availability in Azure portal\n5. Test network connectivity to Azure services`;
          const result: PromptResponse = {
            response: debugResponse.trim(),
            tokensUsed: 0,
          };
          return createSuccessResponse(result, 200, request);
        }

        const correlationId = context.invocationId || Date.now().toString();
        const safeMessage = `The AI service is temporarily unavailable. Please retry soon. (Ref: ${correlationId})`;
        const result: PromptResponse = { response: safeMessage, tokensUsed: 0 };
        return createSuccessResponse(result, 200, request);
      }

      const openaiResponse = (await response.json()) as any;
      context.log("OpenAI response:", openaiResponse);

      const generatedText =
        openaiResponse.choices[0]?.message?.content || "No response generated";
      const tokensUsed = openaiResponse.usage?.total_tokens || 0;

      const result: PromptResponse = {
        response: generatedText,
        tokensUsed: tokensUsed,
      };

      return createSuccessResponse(result, 200, request);
    } catch (fetchError) {
      context.log(
        "Fetch error calling OpenAI (raw logged, suppressed to client)",
        fetchError
      );
      const debugAllowed = process.env.OPENAI_DEBUG === "true";
      if (debugAllowed) {
        const debugResponse = `⚠️ **Development Mode - Network/Fetch Error**\n\n**Original Prompt Sent:**\n${contextualPrompt}\n\n**Network Error Details:**\n${String(
          fetchError
        )}\n\n**Configuration Being Used:**\n- Endpoint: ${
          config.openai.endpoint
        }\n- Deployment: ${config.openai.deployment}\n- API Version: ${
          config.openai.apiVersion
        }\n\nThis shows the actual prompt that was sent to Azure OpenAI. The network request failed, which could indicate:\n\n**Possible Issues:**\n1. Network connectivity problems\n2. Incorrect Azure OpenAI endpoint URL\n3. Firewall or proxy blocking the request\n4. DNS resolution issues\n5. Azure service outage\n\n**Next Steps:**\n1. Check internet connectivity\n2. Verify Azure OpenAI endpoint URL format\n3. Test API access with curl or Postman\n4. Check Azure service health status`;
        const result: PromptResponse = {
          response: debugResponse.trim(),
          tokensUsed: 0,
        };
        return createSuccessResponse(result, 200, request);
      }
      const correlationId = context.invocationId || Date.now().toString();
      const safeMessage = `Could not reach AI service. Please retry. (Ref: ${correlationId})`;
      const result: PromptResponse = { response: safeMessage, tokensUsed: 0 };
      return createSuccessResponse(result, 200, request);
    }
  } catch (error) {
    context.log("Error running prompt:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to run prompt",
      request
    );
  }
}

app.http("runPrompt", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "prompt",
  handler: runPrompt,
});
