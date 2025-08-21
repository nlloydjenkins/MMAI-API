import mammoth from "mammoth";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";

export interface DocumentMetadata {
  title?: string;
  author?: string;
  created?: string;
  modified?: string;
  wordCount: number;
  documentType: string;
  sourceFile: string;
}

export interface ConversionResult {
  markdown: string;
  metadata: DocumentMetadata;
}

export class DocumentConverter {
  /**
   * Convert Word document (.docx) to markdown
   */
  static async convertWord(
    buffer: Buffer,
    fileName: string
  ): Promise<ConversionResult> {
    try {
      const result = await mammoth.convertToHtml({ buffer });

      // Convert HTML to markdown (basic conversion)
      let markdown = result.value
        .replace(
          /<h([1-6])>/g,
          (match, level) => "#".repeat(parseInt(level)) + " "
        )
        .replace(/<\/h[1-6]>/g, "\n\n")
        .replace(/<p>/g, "")
        .replace(/<\/p>/g, "\n\n")
        .replace(/<strong>/g, "**")
        .replace(/<\/strong>/g, "**")
        .replace(/<em>/g, "*")
        .replace(/<\/em>/g, "*")
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<[^>]*>/g, ""); // Remove remaining HTML tags

      // Extract basic metadata
      const wordCount = markdown
        .split(/\s+/)
        .filter((word: string) => word.length > 0).length;

      const metadata: DocumentMetadata = {
        title: fileName.replace(/\.(docx?)$/i, "").replace(/[_-]/g, " "),
        wordCount,
        documentType: "document",
        sourceFile: fileName,
      };

      // Create markdown with YAML front matter
      const yamlHeader = this.createYamlHeader(metadata);
      const finalMarkdown = yamlHeader + "\n" + markdown;

      return {
        markdown: finalMarkdown,
        metadata,
      };
    } catch (error) {
      throw new Error(`Failed to convert Word document: ${error}`);
    }
  }

  /**
   * Convert Excel spreadsheet (.xlsx) to markdown
   */
  static async convertExcel(
    buffer: Buffer,
    fileName: string
  ): Promise<ConversionResult> {
    try {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      let markdown = "";
      let totalCells = 0;

      // Process each worksheet
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];

        // Convert sheet to array of arrays
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonData.length > 0) {
          markdown += `## ${sheetName}\n\n`;

          // Create markdown table
          const rows = jsonData as any[][];
          if (rows.length > 0) {
            // Header row
            const headers = rows[0] || [];
            if (headers.length > 0) {
              markdown += "| " + headers.join(" | ") + " |\n";
              markdown += "| " + headers.map(() => "---").join(" | ") + " |\n";

              // Data rows
              for (let i = 1; i < rows.length; i++) {
                const row = rows[i] || [];
                const paddedRow = [...row];
                while (paddedRow.length < headers.length) {
                  paddedRow.push("");
                }
                markdown +=
                  "| " +
                  paddedRow.slice(0, headers.length).join(" | ") +
                  " |\n";
                totalCells += paddedRow.length;
              }
            }
          }
          markdown += "\n";
        }
      }

      const metadata: DocumentMetadata = {
        title: fileName.replace(/\.(xlsx?)$/i, "").replace(/[_-]/g, " "),
        wordCount: Math.floor(totalCells / 2), // Rough estimate
        documentType: "spreadsheet",
        sourceFile: fileName,
      };

      // Create markdown with YAML front matter
      const yamlHeader = this.createYamlHeader(metadata);
      const finalMarkdown = yamlHeader + "\n" + markdown;

      return {
        markdown: finalMarkdown,
        metadata,
      };
    } catch (error) {
      throw new Error(`Failed to convert Excel document: ${error}`);
    }
  }

  /**
   * Convert PowerPoint presentation (.pptx) to markdown
   * Note: This is a basic implementation. For full PowerPoint support,
   * you might want to use a more specialized library
   */
  static async convertPowerPoint(
    buffer: Buffer,
    fileName: string
  ): Promise<ConversionResult> {
    try {
      // For now, this is a placeholder implementation
      // In a production environment, you'd want to use a library like node-pptx
      // or implement PowerPoint XML parsing

      const content = `# ${fileName
        .replace(/\.(pptx?)$/i, "")
        .replace(/[_-]/g, " ")}\n\n`;
      let markdown =
        content +
        "*PowerPoint document processing requires additional implementation.*\n\n";
      markdown += "*This is a placeholder for PowerPoint content extraction.*";

      const metadata: DocumentMetadata = {
        title: fileName.replace(/\.(pptx?)$/i, "").replace(/[_-]/g, " "),
        wordCount: 10, // Placeholder
        documentType: "presentation",
        sourceFile: fileName,
      };

      // Create markdown with YAML front matter
      const yamlHeader = this.createYamlHeader(metadata);
      const finalMarkdown = yamlHeader + "\n" + markdown;

      return {
        markdown: finalMarkdown,
        metadata,
      };
    } catch (error) {
      throw new Error(`Failed to convert PowerPoint document: ${error}`);
    }
  }

  /**
   * Convert PDF document to markdown
   */
  static async convertPDF(
    buffer: Buffer,
    fileName: string
  ): Promise<ConversionResult> {
    try {
      const data = await pdfParse(buffer);

      const wordCount = data.text
        .split(/\s+/)
        .filter((word: string) => word.length > 0).length;

      const metadata: DocumentMetadata = {
        title: fileName.replace(/\.pdf$/i, "").replace(/[_-]/g, " "),
        wordCount,
        documentType: "pdf",
        sourceFile: fileName,
      };

      // Create markdown with YAML front matter
      const yamlHeader = this.createYamlHeader(metadata);
      const markdown =
        yamlHeader + "\n# " + metadata.title + "\n\n" + data.text;

      return {
        markdown,
        metadata,
      };
    } catch (error) {
      throw new Error(`Failed to convert PDF document: ${error}`);
    }
  }

  /**
   * Process plain text files
   */
  static async convertText(
    buffer: Buffer,
    fileName: string,
    fileType: "txt" | "md"
  ): Promise<ConversionResult> {
    try {
      const content = buffer.toString("utf-8");
      const wordCount = content
        .split(/\s+/)
        .filter((word: string) => word.length > 0).length;

      const metadata: DocumentMetadata = {
        title: fileName.replace(/\.(txt|md)$/i, "").replace(/[_-]/g, " "),
        wordCount,
        documentType: fileType === "txt" ? "text" : "markdown",
        sourceFile: fileName,
      };

      let markdown: string;
      if (fileType === "txt") {
        // For text files, add a title and preserve the content
        const yamlHeader = this.createYamlHeader(metadata);
        markdown = yamlHeader + "\n# " + metadata.title + "\n\n" + content;
      } else {
        // For markdown files, just add the YAML header
        const yamlHeader = this.createYamlHeader(metadata);
        markdown = yamlHeader + "\n" + content;
      }

      return {
        markdown,
        metadata,
      };
    } catch (error) {
      throw new Error(
        `Failed to convert ${fileType.toUpperCase()} document: ${error}`
      );
    }
  }

  /**
   * Create YAML front matter header
   */
  private static createYamlHeader(metadata: DocumentMetadata): string {
    const now = new Date().toISOString();

    return `---
crawl_time: '${now}'
document_type: ${metadata.documentType}
source_file: ${metadata.sourceFile}
source_type: document
title: ${metadata.title || "Untitled"}
word_count: ${metadata.wordCount}${
      metadata.author
        ? `
author: ${metadata.author}`
        : ""
    }${
      metadata.created
        ? `
created: '${metadata.created}'`
        : ""
    }${
      metadata.modified
        ? `
modified: '${metadata.modified}'`
        : ""
    }
---`;
  }

  /**
   * Detect document type from MIME type or file extension
   */
  static detectDocumentType(
    fileName: string,
    mimeType?: string
  ): string | null {
    if (mimeType) {
      switch (mimeType) {
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          return "docx";
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
          return "xlsx";
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
          return "pptx";
        case "application/pdf":
          return "pdf";
        case "text/plain":
          return "txt";
        case "text/markdown":
          return "md";
      }
    }

    // Fallback to file extension
    const extension = fileName.toLowerCase().split(".").pop();
    switch (extension) {
      case "docx":
      case "xlsx":
      case "pptx":
      case "pdf":
      case "txt":
      case "md":
        return extension;
      default:
        return null;
    }
  }

  /**
   * Convert URL to markdown by crawling and processing web content
   */
  static async convertUrl(
    url: string,
    depth: number = 2,
    maxPages: number = 10,
    fileName: string = "url-content"
  ): Promise<ConversionResult> {
    try {
      // For now, implement a basic URL content extraction
      // This would be replaced with the full crawling logic from URLtoPDF
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch URL: ${response.status} ${response.statusText}`
        );
      }

      const html = await response.text();

      // Basic HTML to markdown conversion (simplified)
      let markdown = html
        .replace(/<title[^>]*>([^<]*)<\/title>/i, "# $1\n\n")
        .replace(
          /<h([1-6])[^>]*>([^<]*)<\/h[1-6]>/gi,
          (match, level, content) =>
            "#".repeat(parseInt(level)) + " " + content.trim() + "\n\n"
        )
        .replace(/<p[^>]*>([^<]*)<\/p>/gi, "$1\n\n")
        .replace(/<strong[^>]*>([^<]*)<\/strong>/gi, "**$1**")
        .replace(/<em[^>]*>([^<]*)<\/em>/gi, "*$1*")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "") // Remove all HTML tags
        .replace(/\s+/g, " ") // Normalize whitespace
        .replace(/\n\s*\n/g, "\n\n") // Normalize line breaks
        .trim();

      if (!markdown || markdown.length < 100) {
        markdown = `# ${fileName}\n\nContent from: ${url}\n\n[Content could not be extracted or is too short]`;
      }

      // Add YAML front matter
      const frontMatter = `---
source_url: ${url}
title: "${fileName}"
crawl_time: ${new Date().toISOString()}
depth: ${depth}
max_pages: ${maxPages}
---

`;

      markdown = frontMatter + markdown;

      const wordCount = markdown
        .split(/\s+/)
        .filter((word: string) => word.length > 0).length;

      const metadata: DocumentMetadata = {
        title: fileName,
        wordCount,
        documentType: "url",
        sourceFile: url,
        created: new Date().toISOString(),
      };

      return {
        markdown,
        metadata,
      };
    } catch (error) {
      throw new Error(
        `Failed to convert URL: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
