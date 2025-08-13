import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureClients } from "../../shared/azure-config";
import {
  createSuccessResponse,
  createErrorResponse,
  handleCors,
} from "../../shared/utils";
import { BlobSASPermissions } from "@azure/storage-blob";
import archiver from "archiver";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

interface ExportRequest {
  projectId: string;
  exportData: {
    project: {
      id: string;
      name: string;
      createdDate: Date;
    };
    goals: string;
    files: Array<{
      id: string;
      fileName: string;
      originalName: string;
      fileType: string;
      content?: string;
      url?: string;
    }>;
    settings: any;
    notepadContent?: string;
    advice?: Array<{
      title: string;
      content: string;
      createdAt: string;
    }>;
    adhocQueries?: Array<{
      title: string;
      content: string;
      createdAt: string;
    }>;
  };
}

export async function exportProject(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    context.log("🎯 Export project request received");

    // Handle CORS preflight
    const corsResponse = handleCors(request);
    if (corsResponse) {
      return corsResponse;
    }

    const requestBody = (await request.json()) as ExportRequest;
    const { projectId, exportData } = requestBody;

    if (!projectId || !exportData) {
      return createErrorResponse(
        400,
        "INVALID_REQUEST",
        "Project ID and export data are required"
      );
    }

    context.log(`📦 Starting export for project: ${exportData.project.name}`);

    const azureClients = AzureClients.getInstance();
    const blobClient = azureClients.getBlobServiceClient();
    const containerClient = blobClient.getContainerClient("exports");

    // Ensure exports container exists
    await containerClient.createIfNotExists({
      access: "blob",
    });

    // Create temporary directory for export files
    const tempDir = path.join(os.tmpdir(), `export-${projectId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Create structured export
      await createStructuredExport(tempDir, exportData, context, azureClients);

      // Create ZIP file
      const zipFileName = `${exportData.project.name.replace(
        /[^a-zA-Z0-9-_]/g,
        "_"
      )}_export_${new Date().toISOString().split("T")[0]}.zip`;
      const zipPath = path.join(os.tmpdir(), zipFileName);

      await createZipFile(tempDir, zipPath, context);

      // Upload ZIP to blob storage
      const blobName = `${projectId}/${zipFileName}`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      const uploadResult = await blockBlobClient.uploadFile(zipPath, {
        blobHTTPHeaders: {
          blobContentType: "application/zip",
          blobContentDisposition: `attachment; filename="${zipFileName}"`,
        },
      });

      context.log(`✅ ZIP uploaded to blob storage: ${blobName}`);

      // Generate download URL (valid for 24 hours)
      const downloadUrl = await blockBlobClient.generateSasUrl({
        permissions: BlobSASPermissions.parse("r"),
        expiresOn: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });

      // Cleanup temp files
      cleanupTempFiles(tempDir, zipPath, context);

      return createSuccessResponse({
        downloadUrl,
        fileName: zipFileName,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      // Cleanup on error
      cleanupTempFiles(tempDir, null, context);
      throw error;
    }
  } catch (error: any) {
    context.log("❌ Export error:", error);
    return createErrorResponse(
      500,
      "EXPORT_ERROR",
      error.message || "Failed to export project"
    );
  }
}

async function createStructuredExport(
  tempDir: string,
  exportData: any,
  context: InvocationContext,
  azureClients: AzureClients
) {
  context.log("📁 Creating structured export files...");

  // Create main project info
  const projectInfo = {
    name: exportData.project.name,
    id: exportData.project.id,
    createdDate: exportData.project.createdDate,
    exportedAt: new Date().toISOString(),
    exportVersion: "1.0",
  };

  fs.writeFileSync(
    path.join(tempDir, "project-info.json"),
    JSON.stringify(projectInfo, null, 2)
  );

  // Create goals file if exists
  if (exportData.goals) {
    fs.writeFileSync(path.join(tempDir, "goals.txt"), exportData.goals);
  }

  // Create notepad file if exists
  if (exportData.notepadContent) {
    fs.writeFileSync(
      path.join(tempDir, "notepad.md"),
      exportData.notepadContent
    );
  }

  // Create advice file if exists
  if (exportData.advice && exportData.advice.length > 0) {
    let adviceContent = "# Suggested Advice\n\n";
    for (const advice of exportData.advice) {
      adviceContent += `## ${advice.title}\n\n`;
      adviceContent += `**Created:** ${advice.createdAt}\n\n`;
      adviceContent += `${advice.content}\n\n---\n\n`;
    }
    fs.writeFileSync(path.join(tempDir, "suggested-advice.md"), adviceContent);
  }

  // Create AdHoc queries file if exists
  if (exportData.adhocQueries && exportData.adhocQueries.length > 0) {
    let queriesContent = "# Ad-Hoc Queries and Responses\n\n";
    for (const query of exportData.adhocQueries) {
      queriesContent += `## ${query.title}\n\n`;
      queriesContent += `**Created:** ${query.createdAt}\n\n`;
      queriesContent += `${query.content}\n\n---\n\n`;
    }
    fs.writeFileSync(path.join(tempDir, "adhoc-queries.md"), queriesContent);
  }

  // Create settings file
  fs.writeFileSync(
    path.join(tempDir, "project-settings.json"),
    JSON.stringify(exportData.settings, null, 2)
  );

  // Create directories for different file types
  const directories = {
    documents: path.join(tempDir, "documents"),
    transcripts: path.join(tempDir, "transcripts"),
    emails: path.join(tempDir, "emails"),
    links: path.join(tempDir, "links"),
    images: path.join(tempDir, "images"),
  };

  Object.values(directories).forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });

  // Process files by type
  const blobClient = azureClients.getBlobServiceClient();
  const containerClient = blobClient.getContainerClient("uploads");

  for (const file of exportData.files) {
    let targetDir = directories.documents; // default

    switch (file.fileType) {
      case "transcript":
        targetDir = directories.transcripts;
        break;
      case "email":
        targetDir = directories.emails;
        break;
      case "link":
        targetDir = directories.links;
        break;
      case "file":
        if (file.fileName.match(/\.(jpg|jpeg|png|gif|bmp|svg)$/i)) {
          targetDir = directories.images;
        } else {
          targetDir = directories.documents;
        }
        break;
    }

    try {
      if (file.fileType === "link" && file.content) {
        // For links, save as text file with content
        const linkFileName = `${file.originalName.replace(
          /[^a-zA-Z0-9-_\.]/g,
          "_"
        )}.txt`;
        fs.writeFileSync(path.join(targetDir, linkFileName), file.content);
      } else if (file.url) {
        // Download binary files from blob storage
        const blobName = file.url.split("/").pop()?.split("?")[0];
        if (blobName) {
          const blockBlobClient = containerClient.getBlockBlobClient(blobName);
          const downloadResponse = await blockBlobClient.download();

          if (downloadResponse.readableStreamBody) {
            const chunks: Buffer[] = [];
            for await (const chunk of downloadResponse.readableStreamBody) {
              chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
            }
            const fileBuffer = Buffer.concat(chunks);

            const safeFileName = file.originalName.replace(
              /[^a-zA-Z0-9-_\.]/g,
              "_"
            );
            fs.writeFileSync(path.join(targetDir, safeFileName), fileBuffer);
          }
        }
      }
    } catch (fileError) {
      context.log(
        `⚠️ Warning: Could not export file ${file.originalName}:`,
        fileError
      );
      // Create a note about the failed file
      const errorNote = `Failed to export: ${
        file.originalName
      }\nReason: ${fileError}\nOriginal URL: ${file.url || "N/A"}`;
      fs.writeFileSync(
        path.join(
          targetDir,
          `ERROR_${file.originalName.replace(/[^a-zA-Z0-9-_\.]/g, "_")}.txt`
        ),
        errorNote
      );
    }
  }

  // Create export manifest
  const manifest = {
    exportInfo: projectInfo,
    structure: {
      "project-info.json": "Basic project information",
      "goals.txt": "Project goals and objectives",
      "notepad.md": "Notepad content in Markdown format",
      "suggested-advice.md": "AI-generated advice and recommendations",
      "adhoc-queries.md": "Ad-hoc queries and their responses",
      "project-settings.json": "Project configuration and settings",
      "documents/": "General documents and files",
      "transcripts/": "Meeting transcripts and recordings",
      "emails/": "Email communications",
      "links/": "Reference links and URLs",
      "images/": "Images and visual content",
    },
    fileCount: exportData.files.length,
    exportedFileTypes: [
      ...new Set(exportData.files.map((f: any) => f.fileType)),
    ],
    hasAdvice: !!(exportData.advice && exportData.advice.length > 0),
    hasAdhocQueries: !!(
      exportData.adhocQueries && exportData.adhocQueries.length > 0
    ),
    hasNotepad: !!exportData.notepadContent,
  };

  fs.writeFileSync(
    path.join(tempDir, "EXPORT_MANIFEST.json"),
    JSON.stringify(manifest, null, 2)
  );

  context.log(
    `✅ Created structured export with ${exportData.files.length} files`
  );
}

async function createZipFile(
  sourceDir: string,
  zipPath: string,
  context: InvocationContext
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      context.log(`📦 ZIP file created: ${archive.pointer()} total bytes`);
      resolve();
    });

    archive.on("error", (err: Error) => {
      context.log("❌ ZIP creation error:", err);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function cleanupTempFiles(
  tempDir: string,
  zipPath: string | null,
  context: InvocationContext
) {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      context.log(`🧹 Cleaned up temp directory: ${tempDir}`);
    }
    if (zipPath && fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
      context.log(`🧹 Cleaned up temp ZIP: ${zipPath}`);
    }
  } catch (cleanupError) {
    context.log("⚠️ Cleanup warning:", cleanupError);
  }
}

app.http("exportProject", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: exportProject,
});
