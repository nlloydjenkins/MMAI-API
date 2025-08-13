import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureClients } from "../../shared/azure-config";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
  validateRequiredFields,
  getDefaultAdviceSystemPrompt,
} from "../../shared/utils";

interface ProjectSettingsEntity {
  partitionKey: string; // "settings"
  rowKey: string; // projectId
  projectId: string;
  promptTemplate?: string;
  adviceTemplate?: string;
  aiRole?: string;
  adviceSystemPrompt?: string;
  showAgenda?: boolean;
  showActions?: boolean;
  showQuestions?: boolean;
  // Panel visibility states
  showContext?: boolean;
  showAnswers?: boolean;
  showInsights?: boolean;
  // Panel collapse states
  knowledgeCollapsed?: boolean;
  agendaCollapsed?: boolean;
  newInfoCollapsed?: boolean;
  adviceCollapsed?: boolean;
  adhocCollapsed?: boolean;
  questionsCollapsed?: boolean;
  actionsCollapsed?: boolean;
  // UI states
  showPrompts?: boolean;
  // Notepad content
  notepadContent?: string;
  // Cached advice data
  cachedAdvice?: string; // JSON string of AdviceItem[]
  cachedAdvicePrompt?: string; // JSON string of {systemPrompt: string, userPrompt: string}
  cachedAdviceGeneratedAt?: Date;
  // Cached agenda data
  cachedAgendaContent?: string; // String content of actions and questions
  cachedAgendaPrompt?: string; // JSON string of {systemPrompt: string, userPrompt: string}
  cachedAgendaGeneratedAt?: Date;
  // Cached actions data
  cachedActionsContent?: string; // String content of actions
  cachedActionsPrompt?: string; // Prompt used to generate actions
  cachedActionsGeneratedAt?: string; // ISO string timestamp
  // Cached questions data
  cachedQuestionsContent?: string; // String content of questions
  cachedQuestionItems?: string; // JSON string of QuestionItem objects with answers
  cachedQuestionsPrompt?: string; // Prompt used to generate questions
  cachedQuestionsGeneratedAt?: string; // ISO string timestamp
  // AdHoc panels data
  adHocPanels?: string; // JSON string of AdHocPanelData[]
  adHocPanelsContent?: string; // JSON string of panel content data
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectSettings {
  promptTemplate?: string;
  adviceTemplate?: string;
  aiRole?: string;
  adviceSystemPrompt?: string;
  showAgenda?: boolean;
  showActions?: boolean;
  showQuestions?: boolean;
  // Panel visibility states
  showContext?: boolean;
  showAnswers?: boolean;
  showInsights?: boolean;
  // Panel collapse states
  knowledgeCollapsed?: boolean;
  agendaCollapsed?: boolean;
  newInfoCollapsed?: boolean;
  adviceCollapsed?: boolean;
  adhocCollapsed?: boolean;
  questionsCollapsed?: boolean;
  actionsCollapsed?: boolean;
  // UI states
  showPrompts?: boolean;
  // Notepad content
  notepadContent?: string;
  // Cached advice data
  cachedAdvice?: string; // JSON string of AdviceItem[]
  cachedAdvicePrompt?: string; // JSON string of {systemPrompt: string, userPrompt: string}
  cachedAdviceGeneratedAt?: Date;
  // Cached agenda data
  cachedAgendaContent?: string; // String content of actions and questions
  cachedAgendaPrompt?: string; // JSON string of {systemPrompt: string, userPrompt: string}
  cachedAgendaGeneratedAt?: Date;
  // Cached actions data
  cachedActionsContent?: string; // String content of actions
  cachedActionsPrompt?: string; // Prompt used to generate actions
  cachedActionsGeneratedAt?: string; // ISO string timestamp
  // Cached questions data
  cachedQuestionsContent?: string; // String content of questions
  cachedQuestionItems?: any[]; // Array of QuestionItem objects with answers
  cachedQuestionsPrompt?: string; // Prompt used to generate questions
  cachedQuestionsGeneratedAt?: string; // ISO string timestamp
  // AdHoc panels data
  adHocPanels?: string; // JSON string of AdHocPanelData[]
  adHocPanelsContent?: string; // JSON string of panel content data
}

interface SaveSettingsRequest {
  settings: ProjectSettings;
}

export async function projectSettingsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(
    `HTTP trigger function processed a ${request.method} request to project settings endpoint.`
  );

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  const projectId = request.params.projectId;
  if (!projectId) {
    return createErrorResponse(
      400,
      "MISSING_PROJECT_ID",
      "Project ID is required"
    );
  }

  try {
    if (request.method === "GET") {
      return await getProjectSettings(projectId, context);
    } else if (request.method === "POST") {
      return await saveProjectSettings(request, projectId, context);
    } else {
      return createErrorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${request.method} not allowed`
      );
    }
  } catch (error) {
    context.log("Error in project settings handler:", error);
    return createErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
  }
}

async function getProjectSettings(
  projectId: string,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    context.log(`Getting project settings for project: ${projectId}`);
    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();

    const entity = await tableClient.getEntity<ProjectSettingsEntity>(
      "settings",
      projectId
    );

    context.log(`Found project settings entity:`, {
      hasCachedAdvice: !!entity.cachedAdvice,
      hasCachedAdvicePrompt: !!entity.cachedAdvicePrompt,
      cachedAdviceGeneratedAt: entity.cachedAdviceGeneratedAt,
      cachedAdviceLength: entity.cachedAdvice?.length || 0,
      hasCachedAgendaContent: !!entity.cachedAgendaContent,
      hasCachedAgendaPrompt: !!entity.cachedAgendaPrompt,
      cachedAgendaGeneratedAt: entity.cachedAgendaGeneratedAt,
      cachedAgendaLength: entity.cachedAgendaContent?.length || 0,
      hasAdHocPanels: !!entity.adHocPanels,
    });

    const settings: ProjectSettings = {
      promptTemplate: entity.promptTemplate,
      adviceTemplate: entity.adviceTemplate,
      aiRole: entity.aiRole,
      adviceSystemPrompt:
        entity.adviceSystemPrompt || getDefaultAdviceSystemPrompt(),
      showAgenda: entity.showAgenda,
      showActions: entity.showActions,
      showQuestions: entity.showQuestions,
      // Panel visibility states
      showContext: entity.showContext,
      showAnswers: entity.showAnswers,
      showInsights: entity.showInsights,
      // Panel collapse states
      knowledgeCollapsed: entity.knowledgeCollapsed,
      agendaCollapsed: entity.agendaCollapsed,
      newInfoCollapsed: entity.newInfoCollapsed,
      adviceCollapsed: entity.adviceCollapsed,
      adhocCollapsed: entity.adhocCollapsed,
      questionsCollapsed: entity.questionsCollapsed,
      actionsCollapsed: entity.actionsCollapsed,
      // UI states
      showPrompts: entity.showPrompts,
      // Notepad content
      notepadContent: entity.notepadContent,
      // Cached advice data
      cachedAdvice: entity.cachedAdvice,
      cachedAdvicePrompt: entity.cachedAdvicePrompt,
      cachedAdviceGeneratedAt: entity.cachedAdviceGeneratedAt,
      // Cached agenda data
      cachedAgendaContent: entity.cachedAgendaContent,
      cachedAgendaPrompt: entity.cachedAgendaPrompt,
      cachedAgendaGeneratedAt: entity.cachedAgendaGeneratedAt,
      // Cached actions data
      cachedActionsContent: entity.cachedActionsContent,
      cachedActionsPrompt: entity.cachedActionsPrompt,
      cachedActionsGeneratedAt: entity.cachedActionsGeneratedAt,
      // Cached questions data
      cachedQuestionsContent: entity.cachedQuestionsContent,
      cachedQuestionItems: entity.cachedQuestionItems
        ? JSON.parse(entity.cachedQuestionItems)
        : undefined,
      cachedQuestionsPrompt: entity.cachedQuestionsPrompt,
      cachedQuestionsGeneratedAt: entity.cachedQuestionsGeneratedAt,
      // AdHoc panels data
      adHocPanels: entity.adHocPanels,
      adHocPanelsContent: entity.adHocPanelsContent,
    };

    return createSuccessResponse({ settings });
  } catch (error: any) {
    if (error.statusCode === 404) {
      context.log(
        `No settings found for project: ${projectId}, returning defaults`
      );
      // No settings found, return settings with default values
      return createSuccessResponse({
        settings: {
          adviceSystemPrompt: getDefaultAdviceSystemPrompt(),
          notepadContent: "",
        },
      });
    }
    context.log("Error getting project settings:", error);
    return createErrorResponse(500, "INTERNAL_ERROR", "Failed to get settings");
  }
}

async function saveProjectSettings(
  request: HttpRequest,
  projectId: string,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const requestBody: SaveSettingsRequest =
      (await request.json()) as SaveSettingsRequest;

    if (!requestBody.settings) {
      return createErrorResponse(
        400,
        "INVALID_REQUEST",
        "Settings object is required"
      );
    }

    context.log(`Saving project settings for project: ${projectId}`, {
      hasCachedAdvice: !!requestBody.settings.cachedAdvice,
      hasCachedAdvicePrompt: !!requestBody.settings.cachedAdvicePrompt,
      cachedAdviceGeneratedAt: requestBody.settings.cachedAdviceGeneratedAt,
      cachedAdviceLength: requestBody.settings.cachedAdvice?.length || 0,
      hasCachedAgendaContent: !!requestBody.settings.cachedAgendaContent,
      hasCachedAgendaPrompt: !!requestBody.settings.cachedAgendaPrompt,
      cachedAgendaGeneratedAt: requestBody.settings.cachedAgendaGeneratedAt,
      cachedAgendaLength: requestBody.settings.cachedAgendaContent?.length || 0,
      hasAdHocPanels: !!requestBody.settings.adHocPanels,
    });

    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();

    const now = new Date();
    const entity: ProjectSettingsEntity = {
      partitionKey: "settings",
      rowKey: projectId,
      projectId: projectId,
      promptTemplate: requestBody.settings.promptTemplate,
      adviceTemplate: requestBody.settings.adviceTemplate,
      aiRole: requestBody.settings.aiRole,
      adviceSystemPrompt: requestBody.settings.adviceSystemPrompt,
      showAgenda: requestBody.settings.showAgenda,
      showActions: requestBody.settings.showActions,
      showQuestions: requestBody.settings.showQuestions,
      // Panel visibility states
      showContext: requestBody.settings.showContext,
      showAnswers: requestBody.settings.showAnswers,
      showInsights: requestBody.settings.showInsights,
      // Panel collapse states
      knowledgeCollapsed: requestBody.settings.knowledgeCollapsed,
      agendaCollapsed: requestBody.settings.agendaCollapsed,
      newInfoCollapsed: requestBody.settings.newInfoCollapsed,
      adviceCollapsed: requestBody.settings.adviceCollapsed,
      adhocCollapsed: requestBody.settings.adhocCollapsed,
      questionsCollapsed: requestBody.settings.questionsCollapsed,
      actionsCollapsed: requestBody.settings.actionsCollapsed,
      // UI states
      showPrompts: requestBody.settings.showPrompts,
      // Notepad content
      notepadContent: requestBody.settings.notepadContent,
      // Cached advice data
      cachedAdvice: requestBody.settings.cachedAdvice,
      cachedAdvicePrompt: requestBody.settings.cachedAdvicePrompt,
      cachedAdviceGeneratedAt: requestBody.settings.cachedAdviceGeneratedAt,
      // Cached agenda data
      cachedAgendaContent: requestBody.settings.cachedAgendaContent,
      cachedAgendaPrompt: requestBody.settings.cachedAgendaPrompt,
      cachedAgendaGeneratedAt: requestBody.settings.cachedAgendaGeneratedAt,
      // Cached actions data
      cachedActionsContent: requestBody.settings.cachedActionsContent,
      cachedActionsPrompt: requestBody.settings.cachedActionsPrompt,
      cachedActionsGeneratedAt: requestBody.settings.cachedActionsGeneratedAt,
      // Cached questions data
      cachedQuestionsContent: requestBody.settings.cachedQuestionsContent,
      cachedQuestionItems: requestBody.settings.cachedQuestionItems
        ? JSON.stringify(requestBody.settings.cachedQuestionItems)
        : undefined,
      cachedQuestionsPrompt: requestBody.settings.cachedQuestionsPrompt,
      cachedQuestionsGeneratedAt:
        requestBody.settings.cachedQuestionsGeneratedAt,
      // AdHoc panels data
      adHocPanels: requestBody.settings.adHocPanels,
      adHocPanelsContent: requestBody.settings.adHocPanelsContent,
      createdAt: now,
      updatedAt: now,
    };

    // Use upsert to create or update
    await tableClient.upsertEntity(entity, "Replace");

    context.log(
      `Project settings saved successfully for project: ${projectId}`
    );
    return createSuccessResponse({ message: "Settings saved successfully" });
  } catch (error) {
    context.log("Error saving project settings:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to save settings"
    );
  }
}

app.http("projectSettings", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "projects/{projectId}/settings",
  handler: projectSettingsHandler,
});
