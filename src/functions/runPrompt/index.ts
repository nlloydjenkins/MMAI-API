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
// Pre-search removed: rely on Chat Completions data_sources for retrieval

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
        "Only POST method is allowed"
      );
    }

    // Parse request body
    const requestData = (await request.json()) as PromptRequest;
    context.log("Prompt request:", requestData);

    if (!requestData.question) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Question is required"
      );
    }

    // Get Azure OpenAI configuration
    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();

    // Construct the prompt without pre-search; retrieval comes from data_sources
    let contextualPrompt = requestData.question;

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
          // Configure Azure Search as a retrieval data source (On Your Data)
          // Include semantic_configuration when using query_type: "semantic" to avoid 400 errors from Azure Search.
          data_sources: [
            {
              type: "azure_search",
              parameters: {
                endpoint: config.search.endpoint,
                index_name: config.search.indexName,
                // Use semantic query with explicit configuration
                query_type: "semantic",
                semantic_configuration: "default",
                filter: requestData.projectId
                  ? `project_id eq '${requestData.projectId}'`
                  : undefined,
                strictness: 3,
                top_n_documents: 5,
                authentication: {
                  type: "api_key",
                  key: config.search.apiKey,
                },
              },
            },
          ],
          // Use max_tokens for the preview API to avoid validation errors
          max_tokens: 1500,
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
          return createSuccessResponse(result);
        }

        const correlationId = context.invocationId || Date.now().toString();
        const safeMessage = `The AI service is temporarily unavailable. Please retry soon. (Ref: ${correlationId})`;
        const result: PromptResponse = { response: safeMessage, tokensUsed: 0 };
        return createSuccessResponse(result);
      }

      const openaiResponse = (await response.json()) as any;
      context.log("OpenAI response:", openaiResponse);

      const message = openaiResponse.choices?.[0]?.message ?? {};
      const generatedText = message?.content || "No response generated";
      const tokensUsed = openaiResponse.usage?.total_tokens || 0;

      // Try to extract citations (titles + URLs) from the response context if present
      const contextBlock: any = message?.context || openaiResponse?.context;
      let citationItems: Array<{ title?: string; url: string }> = [];
      try {
        const rawCitations: any[] = Array.isArray(contextBlock?.citations)
          ? contextBlock.citations
          : [];
        const items: Array<{ title?: string; url: string }> = [];
        for (const c of rawCitations) {
          const url = c?.url || c?.uri || c?.source?.url || c?.source?.uri;
          if (typeof url === "string" && url.trim().length > 0) {
            const titleVal = c?.title || c?.source?.title || c?.name;
            const title =
              typeof titleVal === "string" && titleVal.trim().length > 0
                ? titleVal
                : undefined;
            items.push({ url, title });
          }
        }
        // De-duplicate by URL while preserving order
        const seen = new Set<string>();
        citationItems = items.filter((it) => {
          if (seen.has(it.url)) return false;
          seen.add(it.url);
          return true;
        });
      } catch {}

      let finalText = generatedText;
      if (citationItems.length > 0) {
        const sourcesList = citationItems
          .map((it) => (it.title ? `- ${it.title} — ${it.url}` : `- ${it.url}`))
          .join("\n");
        finalText = `${generatedText}\n\nSources:\n${sourcesList}`;
      }

      const result: PromptResponse = {
        response: finalText,
        tokensUsed,
      };

      return createSuccessResponse(result);
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
        return createSuccessResponse(result);
      }
      const correlationId = context.invocationId || Date.now().toString();
      const safeMessage = `Could not reach AI service. Please retry. (Ref: ${correlationId})`;
      const result: PromptResponse = { response: safeMessage, tokensUsed: 0 };
      return createSuccessResponse(result);
    }
  } catch (error) {
    context.log("Error running prompt:", error);
    return createErrorResponse(500, "INTERNAL_ERROR", "Failed to run prompt");
  }
}

app.http("runPrompt", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "prompt",
  handler: runPrompt,
});
