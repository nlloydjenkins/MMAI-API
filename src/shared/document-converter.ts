import mammoth from "mammoth";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";
import { AdvancedCrawler } from "./advanced-crawler";

export interface DocumentMetadata {
  title?: string;
  author?: string;
  created?: string;
  modified?: string;
  wordCount: number;
  documentType: string;
  sourceFile: string;
  error?: string;
}

export interface ConversionResult {
  markdown: string;
  metadata: DocumentMetadata;
  processingTimeMs?: number;
  pagesCrawled?: number;
  crawlErrors?: Array<{
    url: string;
    error: string;
    timestamp: string;
  }>;
  httpAttempts?: number;
  browserFallbacks?: number;
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
    fileName: string = "url-content",
    progressCallback?: (
      currentUrl: string,
      pageCount: number,
      maxPages: number
    ) => Promise<void>
  ): Promise<ConversionResult> {
    try {
      console.log(`[DocumentConverter] Starting URL conversion: ${url}`);
      console.log(
        `[DocumentConverter] Parameters - depth: ${depth}, maxPages: ${maxPages}, fileName: ${fileName}`
      );

      const startTime = Date.now();
      console.log(`[DocumentConverter] Starting advanced website crawl...`);
      
      // Enhanced progress callback with method information
      const enhancedProgressCallback = async (currentUrl: string, pageCount: number, maxPages: number) => {
        if (progressCallback) {
          // Determine current method being used
          const method = currentUrl.includes('browser-fallback') ? 'browser automation' : 'enhanced HTTP';
          await progressCallback(currentUrl, pageCount, maxPages);
        }
      };
      
      const crawlResult = await AdvancedCrawler.crawlWebsite(url, {
        maxDepth: depth,
        maxPages,
        progressCallback: enhancedProgressCallback
      });
      
      const processingTime = Date.now() - startTime;
      console.log(
        `[DocumentConverter] Advanced crawling completed in ${processingTime}ms. Pages: ${crawlResult.pages.length}, Errors: ${crawlResult.errors.length}, HTTP attempts: ${crawlResult.httpAttempts}, Browser fallbacks: ${crawlResult.browserFallbacks}`
      );

      if (crawlResult.pages.length === 0) {
        console.error(`[DocumentConverter] No pages crawled from ${url}`);
        
        // Analyze the types of errors encountered
        const botDetectionErrors = crawlResult.errors.filter(error => 
          error.error.toLowerCase().includes('bot detection') || 
          error.error.toLowerCase().includes('cloudflare') ||
          error.error.toLowerCase().includes('captcha') ||
          error.error.toLowerCase().includes('anti-bot')
        );
        
        const accessErrors = crawlResult.errors.filter(error => 
          error.error.includes('403') || 
          error.error.includes('401') ||
          error.error.toLowerCase().includes('forbidden') ||
          error.error.toLowerCase().includes('unauthorized')
        );
        
        const rateLimitErrors = crawlResult.errors.filter(error => 
          error.error.includes('429') ||
          error.error.toLowerCase().includes('rate limit') ||
          error.error.toLowerCase().includes('too many requests')
        );
        
        // Create detailed error summary
        let errorSummary = "Failed to crawl any pages from the provided URL";
        let errorDetails = [];
        
        if (botDetectionErrors.length > 0) {
          errorSummary = "Website is using anti-bot protection that prevented crawling";
          errorDetails.push(`${botDetectionErrors.length} page(s) blocked by bot detection`);
          
          if (crawlResult.browserFallbacks > 0) {
            errorDetails.push(`Tried browser automation fallback but still blocked`);
          }
        }
        
        if (accessErrors.length > 0) {
          errorDetails.push(`${accessErrors.length} page(s) returned access denied errors`);
        }
        
        if (rateLimitErrors.length > 0) {
          errorDetails.push(`${rateLimitErrors.length} page(s) failed due to rate limiting`);
        }
        
        if (errorDetails.length === 0 && crawlResult.errors.length > 0) {
          const errorTypes = [...new Set(crawlResult.errors.map(e => {
            const match = e.error.match(/^[^:]+/);
            return match ? match[0] : 'Unknown error';
          }))];
          errorSummary = `All pages failed to crawl`;
          errorDetails.push(`Error types: ${errorTypes.join(', ')}`);
        }
        
        // Add crawling method statistics
        const methodStats = [];
        if (crawlResult.httpAttempts > 0) {
          methodStats.push(`${crawlResult.httpAttempts} HTTP attempt(s)`);
        }
        if (crawlResult.browserFallbacks > 0) {
          methodStats.push(`${crawlResult.browserFallbacks} browser fallback(s)`);
        }
        
        if (methodStats.length > 0) {
          errorDetails.push(`Methods tried: ${methodStats.join(', ')}`);
        }
        
        // Return a result with enhanced error information instead of throwing
        const frontMatter = `---
source_url: ${url}
title: "${fileName}"
crawl_time: ${new Date().toISOString()}
depth: ${depth}
max_pages: ${maxPages}
pages_crawled: 0
processing_time_ms: ${processingTime}
http_attempts: ${crawlResult.httpAttempts}
browser_fallbacks: ${crawlResult.browserFallbacks}
error_summary: "${errorSummary}"
error_details: ${JSON.stringify(errorDetails)}
crawl_errors: ${JSON.stringify(crawlResult.errors, null, 2)}
---

# Failed to Process Website

**URL:** ${url}
**Error:** ${errorSummary}

## Error Analysis

${errorDetails.map(detail => `- ${detail}`).join('\n')}

## Crawling Methods Attempted

- **Enhanced HTTP Client:** ${crawlResult.httpAttempts > 0 ? `${crawlResult.httpAttempts} attempt(s)` : 'Not attempted'}
- **Browser Automation Fallback:** ${crawlResult.browserFallbacks > 0 ? `${crawlResult.browserFallbacks} attempt(s)` : 'Not used'}

## Detailed Error Log

${crawlResult.errors.map(error => 
  `### ${error.url}
- **Method:** ${error.method}
- **Error:** ${error.error}
- **Time:** ${new Date(error.timestamp).toLocaleString()}

`
).join('')}

## Recommendations

${botDetectionErrors.length > 0 ? 
  '- This website uses advanced bot protection (Cloudflare, CAPTCHA, etc.)\n- Consider using the website\'s official API if available\n- Manual content extraction may be required' :
  accessErrors.length > 0 ?
    '- This website restricts automated access\n- Check if authentication or special permissions are required\n- Verify the URL is publicly accessible' :
    rateLimitErrors.length > 0 ?
      '- This website is rate limiting requests\n- Try again later when rate limits reset\n- Consider crawling fewer pages or with longer delays' :
      '- Check the URL is correct and the website is accessible\n- Verify your internet connection\n- The website may be temporarily unavailable'
}
`;

        const metadata: DocumentMetadata = {
          title: fileName,
          wordCount: 0,
          documentType: "url",
          sourceFile: fileName,
          error: errorSummary
        };

        return {
          markdown: frontMatter,
          metadata,
          processingTimeMs: processingTime,
          pagesCrawled: 0,
          crawlErrors: crawlResult.errors.map(e => ({
            url: e.url,
            error: `[${e.method.toUpperCase()}] ${e.error}`,
            timestamp: e.timestamp
          }))
        };
      }

      // Combine all pages into a single markdown document
      let markdown = "";
      const crawlSummary = [];
      
      // Count pages by method
      const httpPages = crawlResult.pages.filter(p => p.method === 'http').length;
      const browserPages = crawlResult.pages.filter(p => p.method === 'browser').length;

      for (const page of crawlResult.pages) {
        // Add page header with method indicator
        markdown += `\n\n---\n\n# ${page.title}\n\n`;
        markdown += `**URL:** ${page.url}\n\n`;
        markdown += `**Method:** ${page.method === 'http' ? '🌐 Enhanced HTTP' : '🤖 Browser Automation'}\n\n`;
        if (page.depth > 0) {
          markdown += `**Depth:** ${page.depth}\n\n`;
        }

        // Add page content
        markdown += page.content + "\n\n";

        crawlSummary.push({
          url: page.url,
          title: page.title,
          depth: page.depth,
          method: page.method,
          contentLength: page.content.length,
        });
      }

      // Add comprehensive front matter with method statistics
      const frontMatter = `---
source_url: ${url}
title: "${fileName}"
crawl_time: ${new Date().toISOString()}
depth: ${depth}
max_pages: ${maxPages}
pages_crawled: ${crawlResult.pages.length}
processing_time_ms: ${processingTime}
http_attempts: ${crawlResult.httpAttempts}
browser_fallbacks: ${crawlResult.browserFallbacks}
http_pages: ${httpPages}
browser_pages: ${browserPages}
pages_summary: ${JSON.stringify(crawlSummary, null, 2)}
crawl_errors: ${JSON.stringify(crawlResult.errors, null, 2)}
---

# Website Content: ${fileName}

## Crawling Summary

- **Total Pages:** ${crawlResult.pages.length}
- **Processing Time:** ${(processingTime / 1000).toFixed(2)} seconds
- **HTTP Success:** ${httpPages} page(s)
- **Browser Fallback:** ${browserPages} page(s)
- **Errors:** ${crawlResult.errors.length} page(s)

${crawlResult.browserFallbacks > 0 ? 
  '### Note: Some pages required browser automation due to anti-bot protection\n' : 
  '### Note: All pages were successfully crawled using enhanced HTTP client\n'
}

${crawlResult.errors.length > 0 ? 
  `### Crawling Issues
${crawlResult.errors.map(error => 
  `- **${error.url}**: ${error.error} (${error.method})`
).join('\n')}

` : ''
}

---
`;

      markdown = frontMatter + markdown;

      const wordCount = markdown
        .split(/\s+/)
        .filter((word: string) => word.length > 0).length;

      const metadata: DocumentMetadata = {
        title: `${fileName} (${crawlResult.pages.length} pages)`,
        wordCount,
        documentType: "url",
        sourceFile: url,
        created: new Date().toISOString(),
      };

      return {
        markdown,
        metadata,
        processingTimeMs: processingTime,
        pagesCrawled: crawlResult.pages.length,
        crawlErrors: crawlResult.errors.map(e => ({
          url: e.url,
          error: `[${e.method.toUpperCase()}] ${e.error}`,
          timestamp: e.timestamp
        })),
        httpAttempts: crawlResult.httpAttempts,
        browserFallbacks: crawlResult.browserFallbacks
      };
    } catch (error) {
      throw new Error(
        `Failed to convert URL: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Crawl a website to specified depth and extract content from pages
   * Note: This method has been deprecated in favor of AdvancedCrawler
   */
  private static async crawlWebsite(
    startUrl: string,
    maxDepth: number,
    maxPages: number,
    progressCallback?: (
      currentUrl: string,
      pageCount: number,
      maxPages: number
    ) => Promise<void>
  ): Promise<{
    pages: Array<{ url: string; title: string; content: string; depth: number }>;
    errors: Array<{ url: string; error: string; timestamp: string }>;
  }> {
    // Use AdvancedCrawler for improved anti-bot detection
    const result = await AdvancedCrawler.crawlWebsite(startUrl, {
      maxDepth,
      maxPages,
      progressCallback
    });
    
    // Convert the result format to match the expected interface
    return {
      pages: result.pages.map(page => ({
        url: page.url,
        title: page.title,
        content: page.content,
        depth: page.depth
      })),
      errors: result.errors.map(error => ({
        url: error.url,
        error: error.error,
        timestamp: error.timestamp
      }))
    };
  }
}
