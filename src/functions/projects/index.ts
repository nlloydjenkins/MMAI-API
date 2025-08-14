import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { v4 as uuidv4 } from "uuid";
import { AzureClients } from "../../shared/azure-config";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
  validateRequiredFields,
} from "../../shared/utils";
import {
  requireAuthentication,
  logAuthInfo,
  getCurrentUser,
} from "../../shared/auth";
import {
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectEntity,
  ListProjectsResponse,
  UpdateProjectRequest,
} from "../../shared/types";

export async function projectsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(
    `HTTP trigger function processed a ${request.method} request to projects endpoint.`
  );

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  // Log authentication info for debugging
  logAuthInfo(request, context);

  // Check authentication (bypassed in local development)
  const authError = requireAuthentication(request, context);
  if (authError) {
    return authError;
  }

  try {
    const projectId = request.params.id;

    if (request.method === "POST") {
      return await createProject(request, context);
    } else if (request.method === "GET") {
      if (!projectId) {
        return await listProjects(request, context);
      } else {
        return createErrorResponse(
          404,
          "NOT_FOUND",
          "Single project GET not implemented"
        );
      }
    } else if (request.method === "PUT") {
      if (!projectId) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Project ID is required for PUT requests"
        );
      }
      return await updateProject(request, context);
    } else if (request.method === "DELETE") {
      if (!projectId) {
        return createErrorResponse(
          400,
          "VALIDATION_ERROR",
          "Project ID is required for DELETE requests"
        );
      }
      return await deleteProject(request, context, projectId);
    } else {
      return createErrorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${request.method} not allowed`
      );
    }
  } catch (error: any) {
    context.log("Error in projects handler:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      error.message || "Internal server error"
    );
  }
}

async function createProject(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // Get current user for audit trail
  const currentUser = getCurrentUser(request);
  
  // Parse request body
  const body = (await request.json()) as CreateProjectRequest;

  // Validate required fields
  const missingFields = validateRequiredFields(body, ["name"]);
  if (missingFields.length > 0) {
    return createErrorResponse(
      400,
      "VALIDATION_ERROR",
      `Missing required fields: ${missingFields.join(", ")}`
    );
  }

  // Validate project name
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return createErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Project name must be a non-empty string"
    );
  }

  if (body.name.trim().length > 100) {
    return createErrorResponse(
      400,
      "VALIDATION_ERROR",
      "Project name must be 100 characters or less"
    );
  }

  // Get Azure clients
  const azureClients = AzureClients.getInstance();
  const tableClient = azureClients.getTableClient();
  const config = azureClients.getConfig();

  // Create project entity
  const projectId = uuidv4();
  const now = new Date();

  const projectEntity: ProjectEntity = {
    partitionKey: config.projects.partitionKey,
    rowKey: projectId,
    name: body.name.trim(),
    createdAt: now.toISOString(),
    customerId: body.customerId,
    deadline: body.deadline, // Add deadline support
    createdBy: currentUser?.userDetails || "System",
    createdByUserId: currentUser?.userId || "system",
  };

  // Save to Table Storage
  await tableClient.createEntity(projectEntity);

  // Return success response
  const response: CreateProjectResponse = {
    id: projectId,
    name: body.name.trim(),
    createdAt: now.toISOString(),
    customerId: body.customerId,
    deadline: body.deadline, // Add deadline to response
  };

  context.log(`Created project: ${projectId} - ${body.name}`);
  return createSuccessResponse(response, 201);
}

async function listProjects(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // Get Azure clients
  const azureClients = AzureClients.getInstance();
  const tableClient = azureClients.getTableClient();
  const config = azureClients.getConfig();

  // Query all projects
  const entities = tableClient.listEntities<ProjectEntity>({
    queryOptions: {
      filter: `PartitionKey eq '${config.projects.partitionKey}'`,
    },
  });

  const projects: CreateProjectResponse[] = [];
  for await (const entity of entities) {
    projects.push({
      id: entity.rowKey!,
      name: entity.name!,
      createdAt: entity.createdAt!,
      goals: entity.goals,
      customerId: entity.customerId,
      deadline: entity.deadline, // Add deadline to response
    });
  }

  // Sort by creation date (newest first)
  projects.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const response: ListProjectsResponse = {
    projects,
  };

  context.log(`Retrieved ${projects.length} projects`);
  return createSuccessResponse(response);
}

async function updateProject(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
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

  // Parse request body
  const body = (await request.json()) as UpdateProjectRequest;

  // Get Azure clients
  const azureClients = AzureClients.getInstance();
  const tableClient = azureClients.getTableClient();
  const config = azureClients.getConfig();

  try {
    // Get existing project
    const existingEntity = await tableClient.getEntity<ProjectEntity>(
      config.projects.partitionKey,
      projectId
    );

    // Update the project entity
    const updatedEntity: ProjectEntity = {
      ...existingEntity,
      goals: body.goals !== undefined ? body.goals : existingEntity.goals,
      customerId:
        body.customerId !== undefined
          ? body.customerId
          : existingEntity.customerId,
      deadline:
        body.deadline !== undefined ? body.deadline : existingEntity.deadline,
    };

    // Save updated entity
    await tableClient.updateEntity(updatedEntity, "Merge");

    // Return success response
    const response: CreateProjectResponse = {
      id: projectId,
      name: updatedEntity.name,
      createdAt: updatedEntity.createdAt,
      goals: updatedEntity.goals,
      customerId: updatedEntity.customerId,
      deadline: updatedEntity.deadline, // Add deadline to response
    };

    context.log(`Updated project goals: ${projectId}`);
    return createSuccessResponse(response);
  } catch (error: any) {
    context.log("Error updating project:", error);

    if (error.statusCode === 404) {
      return createErrorResponse(404, "NOT_FOUND", "Project not found");
    }

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to update project"
    );
  }
}

async function deleteProject(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string
): Promise<HttpResponseInit> {
  try {
    context.log(`Deleting project: ${projectId}`);

    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();

    // Check if project exists before deleting
    try {
      await tableClient.getEntity("project", projectId);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return createErrorResponse(404, "NOT_FOUND", "Project not found");
      }
      throw error;
    }

    // Delete the project
    await tableClient.deleteEntity("project", projectId);

    context.log(`Project deleted successfully: ${projectId}`);
    return createSuccessResponse({ message: "Project deleted successfully" });
  } catch (error: any) {
    context.log("Error deleting project:", error);

    if (error.statusCode === 404) {
      return createErrorResponse(404, "NOT_FOUND", "Project not found");
    }

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to delete project"
    );
  }
}

app.http("projects", {
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "projects/{id?}",
  handler: projectsHandler,
});
