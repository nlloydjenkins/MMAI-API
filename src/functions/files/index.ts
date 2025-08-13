import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { v4 as uuidv4 } from "uuid";
import * as busboy from "busboy";
import { AzureClients } from "../../shared/azure-config";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
  validateRequiredFields,
} from "../../shared/utils";
import {
  FileUploadResponse,
  FileMetadata,
  ListFilesResponse,
  UploadTextRequest,
  ProjectEntity,
  CreateProjectResponse,
} from "../../shared/types";

export async function filesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(
    `🔧 [API DEBUG] filesHandler invoked with method: ${request.method}`
  );
  context.log(`🔧 [API DEBUG] Request URL: ${request.url}`);
  context.log(
    `🔧 [API DEBUG] Headers:`,
    Object.fromEntries(request.headers.entries())
  );

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    context.log(`🔧 [API DEBUG] Returning CORS preflight response`);
    return corsResponse;
  }

  try {
    // Get project ID from route parameters
    const projectId = request.params.projectId;
    context.log(`🔧 [API DEBUG] Project ID from params: ${projectId}`);

    if (!projectId) {
      context.log(`❌ [API DEBUG] Missing project ID`);
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Project ID is required"
      );
    }

    if (request.method === "GET") {
      const fileId = request.query.get("fileId");
      const getContent = request.query.get("content");
      const getBlobProxy = request.query.get("blob");

      if (fileId && getContent === "true") {
        context.log(`🔧 [API DEBUG] Routing to getFileContent`);
        return await getFileContent(request, context, projectId, fileId);
      } else if (fileId && getBlobProxy === "true") {
        context.log(`🔧 [API DEBUG] Routing to getBlobProxyHandler`);
        return await getBlobProxyHandler(request, context, projectId, fileId);
      } else {
        context.log(`🔧 [API DEBUG] Routing to listFiles`);
        return await listFiles(request, context, projectId);
      }
    } else if (request.method === "POST") {
      context.log(`🔧 [API DEBUG] Routing to uploadFile`);
      return await uploadFile(request, context, projectId);
    } else if (request.method === "DELETE") {
      context.log(`🔧 [API DEBUG] Routing to deleteFile`);
      return await deleteFile(request, context, projectId);
    } else {
      context.log(`❌ [API DEBUG] Method not allowed: ${request.method}`);
      return createErrorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        `Method ${request.method} not allowed`
      );
    }
  } catch (error) {
    context.log("❌ [API DEBUG] Unexpected error in filesHandler:", error);
    return createErrorResponse(500, "INTERNAL_ERROR", "Internal server error");
  }
}

async function listFiles(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string
): Promise<HttpResponseInit> {
  try {
    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getFilesTableClient();
    const projectTableClient = azureClients.getTableClient();
    const config = azureClients.getConfig();

    // Ensure table exists
    try {
      await tableClient.createTable();
      context.log(`Table '${config.files.tableName}' ensured to exist`);
    } catch (tableError: any) {
      if (tableError.statusCode !== 409) {
        // 409 = table already exists
        context.log(`Error creating table: ${tableError}`);
      }
    }

    // Query all files for this project
    const entities = tableClient.listEntities<FileMetadata>({
      queryOptions: {
        filter: `PartitionKey eq '${config.files.partitionKey}' and projectId eq '${projectId}'`,
      },
    });

    const files: FileUploadResponse[] = [];
    for await (const entity of entities) {
      // For Azure Identity authentication, create proxy URLs for blob access
      const proxyUrl = `${
        request.url.split("/api/")[0]
      }/api/projects/${projectId}/files?fileId=${entity.rowKey}&blob=true`;

      files.push({
        id: entity.rowKey!,
        url: proxyUrl, // Use proxy URL for client access
        fileName: entity.fileName!,
        originalName: entity.originalName!,
        projectId: entity.projectId!,
        fileType: entity.fileType!,
        uploadedAt: entity.uploadedAt!,
        size: entity.size!,
        content: entity.content, // Include content for links
      });
    }

    // Also get goals from project table
    try {
      const projectEntity = await projectTableClient.getEntity<ProjectEntity>(
        config.projects.partitionKey,
        projectId
      );

      if (projectEntity.goals) {
        // Add goal as a virtual file
        files.push({
          id: `goal-${projectId}`,
          url: `project://${projectId}/goals`,
          fileName: "goals.txt",
          originalName: "Project Goals",
          projectId,
          fileType: "goal",
          uploadedAt: projectEntity.createdAt,
          size: Buffer.byteLength(projectEntity.goals, "utf8"),
          content: projectEntity.goals,
        });
        context.log(`📝 [API DEBUG] Added project goals to file list`);
      }
    } catch (error: any) {
      context.log("⚠️ [API DEBUG] Could not fetch project goals:", error);
      // Continue without goals if project doesn't exist or has no goals
    }

    const response: ListFilesResponse = { files };
    context.log(`Listed ${files.length} files for project ${projectId}`);
    return createSuccessResponse(response);
  } catch (error) {
    context.log("Error listing files:", error);
    return createErrorResponse(500, "INTERNAL_ERROR", "Failed to list files");
  }
}

async function getFileContent(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string,
  fileId: string
): Promise<HttpResponseInit> {
  context.log(
    `📄 [API DEBUG] getFileContent started for fileId: ${fileId}, projectId: ${projectId}`
  );

  try {
    const azureClients = AzureClients.getInstance();
    const blobClient = azureClients.getBlobClient();
    const tableClient = azureClients.getFilesTableClient();
    const projectTableClient = azureClients.getTableClient();
    const config = azureClients.getConfig();

    // Handle special goal file ID
    if (fileId.startsWith("goal-")) {
      context.log(`🎯 [API DEBUG] Handling goal file request`);
      try {
        const projectEntity = await projectTableClient.getEntity<ProjectEntity>(
          config.projects.partitionKey,
          projectId
        );

        if (!projectEntity.goals) {
          return createErrorResponse(
            404,
            "NOT_FOUND",
            "No goals found for this project"
          );
        }

        return createSuccessResponse({
          content: projectEntity.goals,
          fileName: "goals.txt",
          originalName: "Project Goals",
          fileType: "goal",
        });
      } catch (error: any) {
        context.log(`❌ [API DEBUG] Error fetching project goals:`, error);
        if (error.statusCode === 404) {
          return createErrorResponse(404, "NOT_FOUND", "Project not found");
        }
        return createErrorResponse(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch project goals"
        );
      }
    }

    // Get file metadata from table storage
    context.log(`📄 [API DEBUG] Getting file metadata from table`);
    const fileEntity = await tableClient.getEntity<FileMetadata>(
      config.files.partitionKey,
      fileId
    );

    if (fileEntity.projectId !== projectId) {
      context.log(`❌ [API DEBUG] File does not belong to project`);
      return createErrorResponse(
        403,
        "FORBIDDEN",
        "File does not belong to this project"
      );
    }

    // If it's a link and content is already stored in metadata, return it
    if (fileEntity.fileType === "link" && fileEntity.content) {
      context.log(`📄 [API DEBUG] Returning cached content for link`);
      return createSuccessResponse({
        content: fileEntity.content,
        fileName: fileEntity.fileName,
        originalName: fileEntity.originalName,
        fileType: fileEntity.fileType,
      });
    }

    // For other files, fetch content from blob storage
    context.log(`📄 [API DEBUG] Fetching content from blob storage`);
    const containerClient = blobClient.getContainerClient(
      config.files.containerName
    );
    const blobName = `${projectId}/${fileEntity.fileName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const downloadResponse = await blockBlobClient.download();
    const content = await streamToString(downloadResponse.readableStreamBody!);

    context.log(`📄 [API DEBUG] Successfully retrieved file content`);
    return createSuccessResponse({
      content,
      fileName: fileEntity.fileName,
      originalName: fileEntity.originalName,
      fileType: fileEntity.fileType,
    });
  } catch (error) {
    context.log("❌ [API DEBUG] Error getting file content:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to get file content"
    );
  }
}

async function getBlobProxyHandler(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string,
  fileId: string
): Promise<HttpResponseInit> {
  context.log(
    `🖼️ [API DEBUG] getBlobProxy started for fileId: ${fileId}, projectId: ${projectId}`
  );

  try {
    const azureClients = AzureClients.getInstance();
    const blobClient = azureClients.getBlobClient();
    const tableClient = azureClients.getFilesTableClient();
    const config = azureClients.getConfig();

    // Get file metadata from table
    try {
      const entity = await tableClient.getEntity<FileMetadata>(
        config.files.partitionKey,
        fileId
      );

      if (!entity || entity.projectId !== projectId) {
        return createErrorResponse(404, "NOT_FOUND", "File not found");
      }

      // Get blob from storage
      const containerClient = blobClient.getContainerClient(
        config.files.containerName
      );
      const blobName = `${projectId}/${entity.fileName}`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      // Download blob content
      const downloadResponse = await blockBlobClient.download();

      if (!downloadResponse.readableStreamBody) {
        return createErrorResponse(
          500,
          "INTERNAL_ERROR",
          "Failed to read blob content"
        );
      }

      // Convert Node.js stream to buffer
      const chunks: Buffer[] = [];
      const stream = downloadResponse.readableStreamBody;

      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }

      const buffer = Buffer.concat(chunks);

      // Return blob content with appropriate headers
      return {
        status: 200,
        headers: {
          "Content-Type":
            downloadResponse.contentType || "application/octet-stream",
          "Content-Length": buffer.length.toString(),
          "Cache-Control": "public, max-age=3600", // Cache for 1 hour
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: buffer,
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        return createErrorResponse(404, "NOT_FOUND", "File not found");
      }
      throw error;
    }
  } catch (error) {
    context.log("❌ [API DEBUG] Error in getBlobProxy:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to get blob content"
    );
  }
}

async function uploadFile(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string
): Promise<HttpResponseInit> {
  context.log(`📝 [API DEBUG] uploadFile started for projectId: ${projectId}`);

  try {
    const azureClients = AzureClients.getInstance();
    context.log(`📝 [API DEBUG] Got Azure clients instance`);

    const blobClient = azureClients.getBlobClient();
    const tableClient = azureClients.getFilesTableClient();
    const config = azureClients.getConfig();
    context.log(`📝 [API DEBUG] Got blob client, table client, and config`);

    // Ensure table exists
    try {
      await tableClient.createTable();
      context.log(
        `✅ [API DEBUG] Table '${config.files.tableName}' ensured to exist`
      );
    } catch (tableError: any) {
      if (tableError.statusCode !== 409) {
        // 409 = table already exists
        context.log(`❌ [API DEBUG] Error creating table: ${tableError}`);
      } else {
        context.log(`📝 [API DEBUG] Table already exists (409 error)`);
      }
    }

    const contentType = request.headers.get("content-type") || "";
    context.log(`📝 [API DEBUG] Content-Type: ${contentType}`);

    // Check if content type indicates multipart, or if it's missing/wrong but body looks like multipart
    let isMultipartRequest = contentType.includes("multipart/form-data");

    // If content type is not clearly multipart, peek at the request to detect multipart data
    // This handles cases where Content-Type header is wrong (e.g., application/json for multipart data)
    if (!isMultipartRequest) {
      try {
        // Clone the request to peek at the body without consuming it
        const clonedRequest = request.clone();
        const bodyPreview = await clonedRequest.text();
        const looksLikeMultipart =
          bodyPreview.startsWith("------") ||
          bodyPreview.includes("Content-Disposition: form-data");

        context.log(
          `📝 [API DEBUG] Body preview (first 100 chars):`,
          bodyPreview.substring(0, 100)
        );
        context.log(
          `📝 [API DEBUG] Detected multipart pattern:`,
          looksLikeMultipart
        );

        if (looksLikeMultipart) {
          isMultipartRequest = true;
          context.log(
            `📝 [API DEBUG] Overriding content type detection - treating as multipart despite header: ${contentType}`
          );
        }
      } catch (peekError) {
        context.log(
          `⚠️ [API DEBUG] Could not peek at request body:`,
          peekError
        );
      }
    }

    context.log(
      `📝 [API DEBUG] Final decision - treating as multipart:`,
      isMultipartRequest
    );

    // Handle text uploads (goal, transcript, email, link) - must be JSON
    if (contentType.includes("application/json") && !isMultipartRequest) {
      context.log(`📝 [API DEBUG] Processing JSON content`);
      return await handleTextUpload(
        request,
        context,
        projectId,
        blobClient,
        tableClient,
        config
      );
    } else if (isMultipartRequest) {
      context.log(`📁 [API DEBUG] Processing multipart/form-data upload`);
      return await handleFileUpload(
        request,
        context,
        projectId,
        blobClient,
        tableClient,
        config
      );
    } else {
      // Handle unsupported content types
      context.log(`❌ [API DEBUG] Unsupported content type: ${contentType}`);
      return createErrorResponse(
        400,
        "UNSUPPORTED_CONTENT_TYPE",
        `Content type ${contentType} is not supported. Use application/json for text or multipart/form-data for files.`
      );
    }
  } catch (error) {
    context.log("❌ [API DEBUG] Error uploading file:", error);
    context.log("❌ [API DEBUG] Error details:", {
      name: (error as any)?.name,
      message: (error as any)?.message,
      stack: (error as any)?.stack,
    });
    return createErrorResponse(500, "INTERNAL_ERROR", "Failed to upload file");
  }
}

async function handleTextUpload(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string,
  blobClient: any,
  tableClient: any,
  config: any
): Promise<HttpResponseInit> {
  try {
    // Log raw request info for debugging
    context.log(
      `📝 [API DEBUG] handleTextUpload - Content-Type:`,
      request.headers.get("content-type")
    );

    // Try to get request body as text first to debug JSON parsing issues
    const requestText = await request.text();
    context.log(
      `📝 [API DEBUG] Raw request body:`,
      requestText.substring(0, 200) + (requestText.length > 200 ? "..." : "")
    );

    // Parse the JSON
    let body: UploadTextRequest;
    try {
      body = JSON.parse(requestText) as UploadTextRequest;
    } catch (parseError: any) {
      context.log(`❌ [API DEBUG] JSON parsing failed:`, parseError.message);
      context.log(
        `❌ [API DEBUG] Request body that failed to parse:`,
        requestText
      );
      return createErrorResponse(
        400,
        "JSON_PARSE_ERROR",
        `Invalid JSON in request body: ${parseError.message}`
      );
    }

    context.log(`📝 [API DEBUG] Parsed request body:`, {
      fileType: body.fileType,
      title: body.title,
      contentLength: body.content?.length,
    });

    // Validate required fields
    const missingFields = validateRequiredFields(body, ["content", "fileType"]);
    if (missingFields.length > 0) {
      context.log(
        `❌ [API DEBUG] Missing required fields: ${missingFields.join(", ")}`
      );
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        `Missing required fields: ${missingFields.join(", ")}`
      );
    }

    // Handle goals differently - store in project table instead of as files
    if (body.fileType === "goal") {
      context.log(`🎯 [API DEBUG] Handling goal - updating project table`);
      return await handleGoalUpdate(request, context, projectId, body);
    }

    const fileId = uuidv4();
    const timestamp = new Date().toISOString();
    const fileName = `${body.fileType}_${timestamp
      .slice(0, 19)
      .replace(/[:-]/g, "")}.txt`;
    const blobName = `${projectId}/${fileName}`;

    context.log(`📝 [API DEBUG] Generated file details:`, {
      fileId,
      fileName,
      blobName,
      timestamp,
    });

    // Upload text content as blob
    const containerClient = blobClient.getContainerClient(
      config.files.containerName
    );

    // Create container if it doesn't exist
    try {
      const containerExists = await containerClient.exists();
      if (!containerExists) {
        await containerClient.create({ access: "container" });
        context.log(`✅ [API DEBUG] Container created successfully`);
      }
    } catch (containerError: any) {
      context.log(
        `❌ [API DEBUG] Error with container: ${
          containerError.message || containerError
        }`
      );
    }

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const contentBuffer = Buffer.byteLength(body.content, "utf8");

    // Prepare blob metadata - include title and project_id for search indexing
    const blobMetadata: Record<string, string> = {
      project_id: projectId, // Add project_id for search filtering
    };
    if (body.title) {
      blobMetadata.title = body.title;
      context.log(
        `📝 [API DEBUG] Adding title to blob metadata: ${body.title}`
      );
    }
    context.log(
      `📝 [API DEBUG] Adding project_id to blob metadata: ${projectId}`
    );

    await blockBlobClient.upload(body.content, contentBuffer, {
      blobHTTPHeaders: { blobContentType: "text/plain" },
      metadata: blobMetadata,
    });

    context.log(
      `✅ [API DEBUG] Blob uploaded successfully with metadata:`,
      blobMetadata
    );

    // Save metadata to table storage first to get the file ID
    const fileMetadata: FileMetadata = {
      partitionKey: config.files.partitionKey,
      rowKey: fileId,
      id: fileId,
      projectId,
      fileName,
      originalName: body.title || `${body.fileType} entry`,
      fileType: body.fileType,
      uploadedAt: timestamp,
      size: contentBuffer,
      url: blockBlobClient.url, // Store original blob URL in database
      content: body.fileType === "link" ? body.content : undefined,
    };

    await tableClient.createEntity(fileMetadata);
    context.log(`✅ [API DEBUG] Metadata saved to table successfully`);

    // Generate proxy URL for secure access through our API
    const proxyUrl = `${
      request.url.split("/api/")[0]
    }/api/projects/${projectId}/files?fileId=${fileId}&blob=true`;
    context.log(`🔗 [API DEBUG] Generated proxy URL for text file access`);

    const response: FileUploadResponse = {
      id: fileId,
      url: proxyUrl, // Use proxy URL instead of direct blob URL
      fileName,
      originalName: body.title || `${body.fileType} entry`,
      projectId,
      fileType: body.fileType,
      uploadedAt: timestamp,
      size: contentBuffer,
      content: body.fileType === "link" ? body.content : undefined,
    };

    return createSuccessResponse(response, 201);
  } catch (error: any) {
    context.log(`❌ [API DEBUG] Error in handleTextUpload:`, error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      `Text upload failed: ${error.message}`
    );
  }
}

async function handleGoalUpdate(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string,
  body: UploadTextRequest
): Promise<HttpResponseInit> {
  context.log(
    `🎯 [API DEBUG] handleGoalUpdate started for project: ${projectId}`
  );

  try {
    // Get Azure clients for project table
    const azureClients = AzureClients.getInstance();
    const projectTableClient = azureClients.getTableClient();
    const config = azureClients.getConfig();

    // Get existing project
    const existingProject = await projectTableClient.getEntity<ProjectEntity>(
      config.projects.partitionKey,
      projectId
    );

    // Update the project with goal content
    const updatedProject: ProjectEntity = {
      ...existingProject,
      goals: body.content,
    };

    // Save updated project
    await projectTableClient.updateEntity(updatedProject, "Merge");
    context.log(`✅ [API DEBUG] Project goals updated successfully`);

    // Return a response that matches FileUploadResponse format for compatibility
    const response: FileUploadResponse = {
      id: `goal-${projectId}`, // Special ID for goals
      url: `project://${projectId}/goals`, // Special URL format
      fileName: "goals.txt",
      originalName: body.title || "Project Goals",
      projectId,
      fileType: "goal",
      uploadedAt: new Date().toISOString(),
      size: Buffer.byteLength(body.content, "utf8"),
      content: body.content,
    };

    context.log(`✅ [API DEBUG] Goal update completed:`, response);
    return createSuccessResponse(response, 201);
  } catch (error: any) {
    context.log("❌ [API DEBUG] Error updating project goals:", error);

    if (error.statusCode === 404) {
      return createErrorResponse(404, "NOT_FOUND", "Project not found");
    }

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to update project goals"
    );
  }
}

async function handleGoalDeletion(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string
): Promise<HttpResponseInit> {
  context.log(
    `🎯 [API DEBUG] handleGoalDeletion started for project: ${projectId}`
  );

  try {
    // Get Azure clients for project table
    const azureClients = AzureClients.getInstance();
    const projectTableClient = azureClients.getTableClient();
    const config = azureClients.getConfig();

    // Get existing project
    const existingProject = await projectTableClient.getEntity<ProjectEntity>(
      config.projects.partitionKey,
      projectId
    );

    // Update the project to remove goals
    const updatedProject: ProjectEntity = {
      ...existingProject,
      goals: undefined, // Remove goals
    };

    // Save updated project
    await projectTableClient.updateEntity(updatedProject, "Merge");
    context.log(`✅ [API DEBUG] Project goals deleted successfully`);

    return createSuccessResponse({ message: "Goals deleted successfully" });
  } catch (error: any) {
    context.log("❌ [API DEBUG] Error deleting project goals:", error);

    if (error.statusCode === 404) {
      return createErrorResponse(404, "NOT_FOUND", "Project not found");
    }

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Failed to delete project goals"
    );
  }
}

async function handleFileUpload(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string,
  blobClient: any,
  tableClient: any,
  config: any
): Promise<HttpResponseInit> {
  // First, get the request body to extract boundary if needed
  const requestBody = await request.arrayBuffer();
  const bodyBuffer = Buffer.from(requestBody);
  const bodyText = bodyBuffer.toString(
    "utf8",
    0,
    Math.min(200, bodyBuffer.length)
  ); // First 200 chars

  context.log(`📁 [API DEBUG] Request body preview:`, bodyText);

  // Extract boundary from the body if content type is wrong
  let contentType = request.headers.get("content-type") || "";
  let boundary = "";

  if (!contentType.includes("multipart/form-data")) {
    // Extract boundary from the actual body
    const firstLine = bodyText.split("\r\n")[0] || bodyText.split("\n")[0];
    if (firstLine.startsWith("------")) {
      // Remove the leading -- and keep the rest as boundary
      boundary = firstLine.substring(2);

      // Clean the boundary - remove any trailing characters that might be problematic
      boundary = boundary.trim();

      // Validate boundary format - should contain alphanumeric characters and possibly hyphens
      if (!/^[a-zA-Z0-9\-]+$/.test(boundary)) {
        context.log(`❌ [API DEBUG] Invalid boundary format: ${boundary}`);
        return createErrorResponse(
          400,
          "PARSE_ERROR",
          "Invalid boundary format"
        );
      }

      // Ensure proper formatting for busboy
      contentType = `multipart/form-data; boundary=${boundary}`;
      context.log(`📁 [API DEBUG] Extracted boundary from body: ${boundary}`);
      context.log(`📁 [API DEBUG] Fixed content type: ${contentType}`);
    } else {
      context.log(
        `❌ [API DEBUG] Could not extract boundary from body, first line: ${firstLine}`
      );
      return createErrorResponse(
        400,
        "PARSE_ERROR",
        "Invalid multipart data - could not extract boundary"
      );
    }
  }

  // Parse multipart form data with corrected content type
  const parseResult = await parseMultipartDataWithBuffer(
    bodyBuffer,
    contentType,
    context
  );
  if (!parseResult.success) {
    return createErrorResponse(400, "PARSE_ERROR", parseResult.error!);
  }

  const { fileData, fileName: originalFileName } = parseResult;

  context.log(`📁 [API DEBUG] Parsed file:`, {
    originalFileName,
    fileSize: fileData.length,
  });

  // Generate file details
  const fileId = uuidv4();
  const timestamp = new Date().toISOString();
  const fileExtension = originalFileName.split(".").pop() || "bin";

  // Preserve info_ prefix for New Information items, otherwise use timestamp
  let fileName: string;
  if (originalFileName.startsWith("info_")) {
    fileName = originalFileName; // Keep the original filename with info_ prefix
    context.log(
      `📁 [API DEBUG] Preserving info_ prefix for filename: ${fileName}`
    );
  } else {
    fileName = `file_${timestamp
      .slice(0, 19)
      .replace(/[:-]/g, "")}.${fileExtension}`;
    context.log(
      `📁 [API DEBUG] Generated timestamp-based filename: ${fileName}`
    );
  }

  const blobName = `${projectId}/${fileName}`;

  context.log(`📁 [API DEBUG] Generated file details:`, {
    fileId,
    fileName,
    blobName,
    originalFileName,
    timestamp,
  });

  // Upload binary content as blob
  const containerClient = blobClient.getContainerClient(
    config.files.containerName
  );

  // Create container if it doesn't exist
  try {
    const containerExists = await containerClient.exists();
    if (!containerExists) {
      await containerClient.create({ access: "container" });
      context.log(`✅ [API DEBUG] Container created successfully`);
    }
  } catch (containerError: any) {
    context.log(
      `❌ [API DEBUG] Error with container: ${
        containerError.message || containerError
      }`
    );
  }

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const detectedContentType = getContentTypeFromExtension(fileExtension);

  context.log(
    `📁 [API DEBUG] About to upload binary blob, size: ${fileData.length} bytes, content-type: ${detectedContentType}`
  );

  // Prepare blob metadata - include project_id for search indexing
  const blobMetadata: Record<string, string> = {
    project_id: projectId, // Add project_id for search filtering
    original_name: originalFileName, // Store original filename for search
  };
  context.log(
    `📁 [API DEBUG] Adding metadata to blob: project_id=${projectId}, original_name=${originalFileName}`
  );

  await blockBlobClient.upload(fileData, fileData.length, {
    blobHTTPHeaders: { blobContentType: detectedContentType },
    metadata: blobMetadata,
  });

  context.log(`✅ [API DEBUG] Binary blob uploaded successfully`);

  // Save metadata to table storage first
  const fileMetadata: FileMetadata = {
    partitionKey: config.files.partitionKey,
    rowKey: fileId,
    id: fileId,
    projectId,
    fileName,
    originalName: originalFileName,
    fileType: "file",
    uploadedAt: timestamp,
    size: fileData.length,
    url: blockBlobClient.url, // Store original blob URL in database
  };

  await tableClient.createEntity(fileMetadata);
  context.log(`✅ [API DEBUG] Metadata saved to table successfully`);

  // Generate proxy URL for secure access through our API
  const proxyUrl = `${
    request.url.split("/api/")[0]
  }/api/projects/${projectId}/files?fileId=${fileId}&blob=true`;
  context.log(`🔗 [API DEBUG] Generated proxy URL for file access`);

  const response: FileUploadResponse = {
    id: fileId,
    url: proxyUrl, // Use proxy URL instead of direct blob URL
    fileName,
    originalName: originalFileName,
    projectId,
    fileType: "file",
    uploadedAt: timestamp,
    size: fileData.length,
  };

  context.log(`✅ [API DEBUG] Binary upload completed successfully:`, response);
  return createSuccessResponse(response, 201);
}

async function deleteFile(
  request: HttpRequest,
  context: InvocationContext,
  projectId: string
): Promise<HttpResponseInit> {
  try {
    const fileId = request.query.get("fileId");
    context.log(
      `🗑️ [API DEBUG] DeleteFile called with fileId: ${fileId}, projectId: ${projectId}`
    );

    if (!fileId) {
      context.log(`❌ [API DEBUG] File ID is missing`);
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "File ID is required"
      );
    }

    // Handle special goal file deletion
    if (fileId.startsWith("goal-")) {
      context.log(
        `🎯 [API DEBUG] Handling goal deletion - updating project table`
      );
      return await handleGoalDeletion(request, context, projectId);
    }

    const azureClients = AzureClients.getInstance();
    const blobClient = azureClients.getBlobClient();
    const tableClient = azureClients.getFilesTableClient();
    const config = azureClients.getConfig();

    context.log(`🗑️ [API DEBUG] Getting file entity for fileId: ${fileId}`);

    // Get file metadata
    let fileEntity;
    try {
      fileEntity = await tableClient.getEntity<FileMetadata>(
        config.files.partitionKey,
        fileId
      );
      context.log(`🗑️ [API DEBUG] File entity found:`, fileEntity);
    } catch (entityError: any) {
      context.log(`❌ [API DEBUG] Error getting file entity:`, entityError);

      // If the file doesn't exist in table storage, consider it already deleted
      if (
        entityError.statusCode === 404 ||
        entityError.message?.includes("does not exist")
      ) {
        context.log(
          `🗑️ [API DEBUG] File entity not found - treating as already deleted`
        );
        return createSuccessResponse({
          message: "File already deleted or does not exist",
          wasAlreadyDeleted: true,
        });
      }

      return createErrorResponse(404, "NOT_FOUND", "File not found");
    }

    if (fileEntity.projectId !== projectId) {
      context.log(
        `❌ [API DEBUG] Project ID mismatch. Expected: ${projectId}, Got: ${fileEntity.projectId}`
      );
      return createErrorResponse(
        403,
        "FORBIDDEN",
        "File does not belong to this project"
      );
    }

    context.log(
      `🗑️ [API DEBUG] Deleting blob: ${projectId}/${fileEntity.fileName}`
    );

    // Delete from blob storage
    try {
      const containerClient = blobClient.getContainerClient(
        config.files.containerName
      );
      const blobName = `${projectId}/${fileEntity.fileName}`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const deleteResult = await blockBlobClient.deleteIfExists();
      context.log(`🗑️ [API DEBUG] Blob delete result:`, deleteResult);
    } catch (blobError) {
      context.log(`❌ [API DEBUG] Error deleting blob:`, blobError);
      // Continue with table deletion even if blob deletion fails
    }

    context.log(
      `🗑️ [API DEBUG] Deleting table entity: ${config.files.partitionKey}, ${fileId}`
    );

    // Delete metadata from table storage
    try {
      await tableClient.deleteEntity(config.files.partitionKey, fileId);
      context.log(`🗑️ [API DEBUG] Table entity deleted successfully`);
    } catch (tableError) {
      context.log(`❌ [API DEBUG] Error deleting table entity:`, tableError);
      throw tableError; // This is critical - if we can't delete the metadata, the operation failed
    }

    context.log(
      `✅ [API DEBUG] Successfully deleted file: ${fileEntity.fileName} for project ${projectId}`
    );
    return createSuccessResponse({ message: "File deleted successfully" });
  } catch (error) {
    context.log("❌ [API DEBUG] Error in deleteFile function:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      `Failed to delete file: ${errorMessage}`
    );
  }
}

// Helper function to convert stream to string
async function streamToString(
  readableStream: NodeJS.ReadableStream
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on("data", (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    readableStream.on("error", reject);
  });
}

// Helper function to parse multipart/form-data
async function parseMultipartData(
  request: HttpRequest,
  context: InvocationContext
): Promise<
  | { success: true; fileData: Buffer; fileName: string }
  | { success: false; error: string }
> {
  return new Promise((resolve) => {
    try {
      const contentType = request.headers.get("content-type") || "";
      const bb = busboy.default({ headers: { "content-type": contentType } });

      let fileData: Buffer | null = null;
      let fileName = "unknown_file";

      bb.on(
        "file",
        (fieldname: string, file: NodeJS.ReadableStream, info: any) => {
          context.log(
            `📁 [API DEBUG] Processing file field: ${fieldname}, filename: ${info.filename}`
          );
          fileName = info.filename || "unknown_file";

          const chunks: Buffer[] = [];
          file.on("data", (data: Buffer) => {
            chunks.push(data);
          });

          file.on("end", () => {
            fileData = Buffer.concat(chunks);
            context.log(
              `📁 [API DEBUG] File data collected, size: ${fileData.length} bytes`
            );
          });
        }
      );

      bb.on("field", (fieldname: string, val: string) => {
        context.log(`📁 [API DEBUG] Processing field: ${fieldname} = ${val}`);
        if (fieldname === "fileName" && val) {
          fileName = val;
        }
      });

      bb.on("close", () => {
        if (fileData) {
          context.log(
            `📁 [API DEBUG] Multipart parsing completed successfully`
          );
          resolve({ success: true, fileData, fileName });
        } else {
          context.log(`❌ [API DEBUG] No file data found in multipart`);
          resolve({ success: false, error: "No file data found" });
        }
      });

      bb.on("error", (err: Error) => {
        context.log(`❌ [API DEBUG] Multipart parsing error:`, err);
        resolve({
          success: false,
          error: `Multipart parsing failed: ${err.message}`,
        });
      });

      // Get request body as array buffer and convert to buffer
      request
        .arrayBuffer()
        .then((arrayBuffer) => {
          const buffer = Buffer.from(arrayBuffer);
          context.log(
            `📁 [API DEBUG] Writing ${buffer.length} bytes to busboy`
          );
          bb.write(buffer);
          bb.end();
        })
        .catch((err) => {
          context.log(`❌ [API DEBUG] Error reading request body:`, err);
          resolve({
            success: false,
            error: `Failed to read request body: ${err.message}`,
          });
        });
    } catch (error: any) {
      context.log(
        `❌ [API DEBUG] Unexpected error in parseMultipartData:`,
        error
      );
      resolve({ success: false, error: `Unexpected error: ${error.message}` });
    }
  });
}

// Helper function to parse multipart/form-data with buffer and corrected content type
async function parseMultipartDataWithBuffer(
  bodyBuffer: Buffer,
  contentType: string,
  context: InvocationContext
): Promise<
  | { success: true; fileData: Buffer; fileName: string }
  | { success: false; error: string }
> {
  return new Promise((resolve) => {
    try {
      context.log(
        `📁 [API DEBUG] Using content type for busboy: ${contentType}`
      );
      const bb = busboy.default({ headers: { "content-type": contentType } });

      let fileData: Buffer | null = null;
      let fileName = "unknown_file";

      bb.on(
        "file",
        (fieldname: string, file: NodeJS.ReadableStream, info: any) => {
          context.log(
            `📁 [API DEBUG] Processing file field: ${fieldname}, filename: ${info.filename}`
          );
          fileName = info.filename || "unknown_file";

          const chunks: Buffer[] = [];
          file.on("data", (data: Buffer) => {
            chunks.push(data);
          });

          file.on("end", () => {
            fileData = Buffer.concat(chunks);
            context.log(
              `📁 [API DEBUG] File data collected, size: ${fileData.length} bytes`
            );
          });
        }
      );

      bb.on("field", (fieldname: string, val: string) => {
        context.log(`📁 [API DEBUG] Processing field: ${fieldname} = ${val}`);
        if (fieldname === "fileName" && val) {
          fileName = val;
        }
      });

      bb.on("close", () => {
        if (fileData) {
          context.log(
            `📁 [API DEBUG] Multipart parsing completed successfully`
          );
          resolve({ success: true, fileData, fileName });
        } else {
          context.log(`❌ [API DEBUG] No file data found in multipart`);
          resolve({ success: false, error: "No file data found" });
        }
      });

      bb.on("error", (err: Error) => {
        context.log(`❌ [API DEBUG] Multipart parsing error:`, err);
        resolve({
          success: false,
          error: `Multipart parsing failed: ${err.message}`,
        });
      });

      // Write the pre-read buffer to busboy
      context.log(
        `📁 [API DEBUG] Writing ${bodyBuffer.length} bytes to busboy`
      );
      bb.write(bodyBuffer);
      bb.end();
    } catch (error: any) {
      context.log(
        `❌ [API DEBUG] Unexpected error in parseMultipartDataWithBuffer:`,
        error
      );
      resolve({ success: false, error: `Unexpected error: ${error.message}` });
    }
  });
}

// Helper function to get content type from file extension
function getContentTypeFromExtension(extension: string): string {
  const mimeTypes: { [key: string]: string } = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
  };

  return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}

app.http("files", {
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "projects/{projectId}/files",
  handler: filesHandler,
});
