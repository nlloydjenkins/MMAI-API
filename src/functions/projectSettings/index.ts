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
  cachedActionItems?: string; // JSON string of ActionItem objects with statuses
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
  cachedActionItems?: any[]; // Array of ActionItem objects with statuses
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
      cachedActionItems: entity.cachedActionItems
        ? JSON.parse(entity.cachedActionItems)
        : undefined,
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

    // Build a partial entity with only provided fields so we don't wipe existing data
    const partialEntity: Partial<ProjectSettingsEntity> & {
      partitionKey: string;
      rowKey: string;
      projectId: string;
      updatedAt: Date;
      createdAt?: Date;
    } = {
      partitionKey: "settings",
      rowKey: projectId,
      projectId,
      updatedAt: now,
      // createdAt will be set on insert automatically below
    };

    const s = requestBody.settings;

    // Helper to conditionally assign if value !== undefined
    const assignIfDefined = <K extends keyof ProjectSettingsEntity>(
      key: K,
      value: ProjectSettingsEntity[K] | undefined
    ) => {
      if (value !== undefined) {
        partialEntity[key] = value as any;
      }
    };

    assignIfDefined("promptTemplate", s.promptTemplate);
    assignIfDefined("adviceTemplate", s.adviceTemplate);
    assignIfDefined("aiRole", s.aiRole);
    assignIfDefined("adviceSystemPrompt", s.adviceSystemPrompt);
    assignIfDefined("showAgenda", s.showAgenda);
    assignIfDefined("showActions", s.showActions);
    assignIfDefined("showQuestions", s.showQuestions);
    // Panel visibility states
    assignIfDefined("showContext", s.showContext);
    assignIfDefined("showAnswers", s.showAnswers);
    assignIfDefined("showInsights", s.showInsights);
    // Panel collapse states
    assignIfDefined("knowledgeCollapsed", s.knowledgeCollapsed as any);
    assignIfDefined("agendaCollapsed", s.agendaCollapsed as any);
    assignIfDefined("newInfoCollapsed", s.newInfoCollapsed as any);
    assignIfDefined("adviceCollapsed", s.adviceCollapsed as any);
    assignIfDefined("adhocCollapsed", s.adhocCollapsed as any);
    assignIfDefined("questionsCollapsed", s.questionsCollapsed as any);
    assignIfDefined("actionsCollapsed", s.actionsCollapsed as any);
    // UI states
    assignIfDefined("showPrompts", s.showPrompts);
    // Notepad content
    assignIfDefined("notepadContent", s.notepadContent);
    // Cached advice data
    assignIfDefined("cachedAdvice", s.cachedAdvice);
    assignIfDefined("cachedAdvicePrompt", s.cachedAdvicePrompt);
    assignIfDefined(
      "cachedAdviceGeneratedAt",
      s.cachedAdviceGeneratedAt as any
    );
    // Cached agenda data
    assignIfDefined("cachedAgendaContent", s.cachedAgendaContent);
    assignIfDefined("cachedAgendaPrompt", s.cachedAgendaPrompt);
    assignIfDefined(
      "cachedAgendaGeneratedAt",
      s.cachedAgendaGeneratedAt as any
    );
    // Cached actions data
    assignIfDefined("cachedActionsContent", s.cachedActionsContent);
    if (s.cachedActionItems !== undefined) {
      partialEntity.cachedActionItems = JSON.stringify(s.cachedActionItems);
    }
    assignIfDefined("cachedActionsPrompt", s.cachedActionsPrompt);
    assignIfDefined("cachedActionsGeneratedAt", s.cachedActionsGeneratedAt);
    // Cached questions data
    assignIfDefined("cachedQuestionsContent", s.cachedQuestionsContent);
    if (s.cachedQuestionItems !== undefined) {
      partialEntity.cachedQuestionItems = JSON.stringify(s.cachedQuestionItems);
    }
    assignIfDefined("cachedQuestionsPrompt", s.cachedQuestionsPrompt);
    assignIfDefined("cachedQuestionsGeneratedAt", s.cachedQuestionsGeneratedAt);
    // AdHoc panels data
    assignIfDefined("adHocPanels", s.adHocPanels);
    assignIfDefined("adHocPanelsContent", s.adHocPanelsContent);

    // Try to see if entity exists to set createdAt only when inserting
    try {
      await tableClient.getEntity("settings", projectId);
    } catch (e: any) {
      if (e?.statusCode === 404) {
        partialEntity.createdAt = now;
      }
    }

    // Merge so unspecified fields are preserved
    await tableClient.upsertEntity(partialEntity as any, "Merge");

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
