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
} from "../../shared/utils";
import { GetProjectResponse, ProjectEntity } from "../../shared/types";

export async function getProject(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("HTTP trigger function processed a getProject request.");

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // Validate request method
    if (request.method !== "GET") {
      return createErrorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        "Only GET method is allowed"
      );
    }

    // Get project ID from route parameters
    const projectId = request.params.id;
    if (!projectId) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Project ID is required"
      );
    }

    // Validate project ID format (UUID)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Invalid project ID format"
      );
    }

    // Get Azure clients
    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();
    const config = azureClients.getConfig();

    // Get project from Table Storage
    const entity = await tableClient.getEntity<ProjectEntity>(
      config.projects.partitionKey,
      projectId
    );

    const response: GetProjectResponse = {
      id: entity.rowKey!,
      name: entity.name,
      createdAt: entity.createdAt,
      goals: entity.goals,
    };

    context.log(`Retrieved project: ${projectId} - ${entity.name}`);
    return createSuccessResponse(response);
  } catch (error: any) {
    context.log("Error getting project:", error);

    if (error.statusCode === 404) {
      return createErrorResponse(404, "NOT_FOUND", "Project not found");
    }

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to retrieve project"
    );
  }
}

app.http("getProject", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "projects/{id}",
  handler: getProject,
});
