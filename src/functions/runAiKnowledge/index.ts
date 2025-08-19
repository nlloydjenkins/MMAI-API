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

interface AiKnowledgeRequest {
  query: string;
  maxResults?: number;
  systemPrompt?: string;
}

interface AiKnowledgeResult {
  id: string;
  content: string;
  fileName: string;
  score: number;
  sourceType: "ai_knowledge";
}

interface AiKnowledgeResponse {
  results: AiKnowledgeResult[];
  totalCount: number;
  reasoning: string;
}

export async function runAiKnowledge(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a runAiKnowledge request.");

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
    const requestData = (await request.json()) as AiKnowledgeRequest;
    context.log("AI knowledge search request:", requestData);

    if (!requestData.query) {
      return createErrorResponse(400, "VALIDATION_ERROR", "Query is required");
    }

    const maxResults = requestData.maxResults || 3;

    // Get Azure configuration
    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();

    // Use Azure OpenAI to generate knowledge-based responses
    const endpoint =
      config.openai.endpoint &&
      config.openai.endpoint !== "REPLACE_WITH_YOUR_ENDPOINT_HERE"
        ? config.openai.endpoint
        : "https://openai-meetingmate.openai.azure.com/";

    const openaiUrl = `${endpoint}openai/deployments/${config.openai.deployment}/chat/completions?api-version=${config.openai.apiVersion}`;

    const systemPrompt = requestData.systemPrompt || `You are a helpful AI assistant with broad knowledge. 

The user has asked a question that couldn't be fully answered by their organization's specific documents. 

Please provide helpful information based on your training data and general knowledge. Structure your response as follows:

1. **Direct Answer**: Provide a clear, direct answer to the question if possible
2. **Context & Background**: Give relevant background information 
3. **Best Practices**: Share industry best practices or common approaches
4. **Considerations**: Mention important factors to consider

Keep each section concise but informative. Focus on practical, actionable information.`;

    const userPrompt = `Question: ${requestData.query}

Please provide helpful information about this topic using your general knowledge.`;

    context.log("🧠 [AI KNOWLEDGE] Generating response for:", requestData.query);

    const apiResponse = await fetch(openaiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.openai.apiKey,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        model: config.openai.deployment,
        max_tokens: 800,
        temperature: 0.3, // Lower temperature for more focused responses
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      context.log("AI Knowledge API error:", errorText);
      throw new Error(`AI Knowledge API error: ${apiResponse.status} ${apiResponse.statusText}`);
    }

    const aiResult = await apiResponse.json() as any;
    const aiResponse = aiResult.choices?.[0]?.message?.content || "";
    
    if (!aiResponse) {
      context.log("🧠 [AI KNOWLEDGE] No response generated");
      return createSuccessResponse({
        results: [],
        totalCount: 0,
        reasoning: "No AI response generated"
      });
    }

    // Parse the AI response into structured sections
    const sections = [];
    const lines = aiResponse.split('\n').filter((line: string) => line.trim());
    
    let currentSection = '';
    let currentContent = '';
    
    for (const line of lines) {
      if (line.startsWith('**') && line.endsWith('**:')) {
        // New section header
        if (currentSection && currentContent) {
          sections.push({
            title: currentSection,
            content: currentContent.trim()
          });
        }
        currentSection = line.replace(/\*\*/g, '').replace(':', '').trim();
        currentContent = '';
      } else {
        currentContent += line + '\n';
      }
    }
    
    // Add the last section
    if (currentSection && currentContent) {
      sections.push({
        title: currentSection,
        content: currentContent.trim()
      });
    }
    
    // If no structured sections found, treat the whole response as one section
    if (sections.length === 0) {
      sections.push({
        title: "AI Knowledge Response",
        content: aiResponse
      });
    }

    // Convert sections to search results format
    const results: AiKnowledgeResult[] = sections.slice(0, maxResults).map((section, index) => ({
      id: `ai_knowledge_${Date.now()}_${index}`,
      content: section.content,
      fileName: `🧠 AI Knowledge: ${section.title}`,
      score: 0.8 - (index * 0.1), // Decreasing scores for multiple sections
      sourceType: "ai_knowledge" as const
    }));

    const finalResponse: AiKnowledgeResponse = {
      results,
      totalCount: results.length,
      reasoning: `Generated ${results.length} knowledge-based responses from AI training data`
    };

    context.log(
      `🧠 [AI KNOWLEDGE] Generated ${results.length} knowledge sections for query: "${requestData.query}"`
    );

    return createSuccessResponse(finalResponse);
  } catch (error) {
    context.log("Error in AI knowledge search:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "AI_KNOWLEDGE_ERROR",
      `Failed to generate AI knowledge response: ${errorMessage}`
    );
  }
}

app.http("runAiKnowledge", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "ai-knowledge",
  handler: runAiKnowledge,
});
