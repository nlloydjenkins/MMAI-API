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
  pagesCrawled?: number;
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
      console.log(`[DocumentConverter] Starting URL conversion: ${url}`);
      console.log(
        `[DocumentConverter] Parameters - depth: ${depth}, maxPages: ${maxPages}, fileName: ${fileName}`
      );

      const startTime = Date.now();
      console.log(`[DocumentConverter] Beginning website crawl...`);
      const crawledPages = await this.crawlWebsite(url, depth, maxPages);
      const processingTime = Date.now() - startTime;
      console.log(
        `[DocumentConverter] Crawling completed in ${processingTime}ms, found ${crawledPages.length} pages`
      );

      if (crawledPages.length === 0) {
        console.error(`[DocumentConverter] No pages crawled from ${url}`);
        throw new Error("No pages could be crawled from the provided URL");
      }

      // Combine all pages into a single markdown document
      let markdown = "";
      const crawlSummary = [];

      for (const page of crawledPages) {
        // Add page header
        markdown += `\n\n---\n\n# ${page.title}\n\n`;
        markdown += `**URL:** ${page.url}\n\n`;
        if (page.depth > 0) {
          markdown += `**Depth:** ${page.depth}\n\n`;
        }

        // Add page content
        markdown += page.content + "\n\n";

        crawlSummary.push({
          url: page.url,
          title: page.title,
          depth: page.depth,
          contentLength: page.content.length,
        });
      }

      // Add comprehensive front matter
      const frontMatter = `---
source_url: ${url}
title: "${fileName}"
crawl_time: ${new Date().toISOString()}
depth: ${depth}
max_pages: ${maxPages}
pages_crawled: ${crawledPages.length}
processing_time_ms: ${processingTime}
pages_summary: ${JSON.stringify(crawlSummary, null, 2)}
---

`;

      markdown = frontMatter + markdown;

      const wordCount = markdown
        .split(/\s+/)
        .filter((word: string) => word.length > 0).length;

      const metadata: DocumentMetadata = {
        title: `${fileName} (${crawledPages.length} pages)`,
        wordCount,
        documentType: "url",
        sourceFile: url,
        created: new Date().toISOString(),
      };

      return {
        markdown,
        metadata,
        pagesCrawled: crawledPages.length,
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
   */
  private static async crawlWebsite(
    startUrl: string,
    maxDepth: number,
    maxPages: number
  ): Promise<
    Array<{ url: string; title: string; content: string; depth: number }>
  > {
    console.log(
      `[crawlWebsite] Starting crawl of ${startUrl} (maxDepth: ${maxDepth}, maxPages: ${maxPages})`
    );

    const visitedUrls = new Set<string>();
    const crawledPages: Array<{
      url: string;
      title: string;
      content: string;
      depth: number;
    }> = [];
    const urlQueue: Array<{ url: string; depth: number }> = [
      { url: startUrl, depth: 0 },
    ];

    // Get base domain to limit crawling to same domain
    const baseDomain = new URL(startUrl).hostname;
    console.log(`[crawlWebsite] Base domain: ${baseDomain}`);

    while (urlQueue.length > 0 && crawledPages.length < maxPages) {
      const { url, depth } = urlQueue.shift()!;
      console.log(`[crawlWebsite] Processing URL: ${url} (depth: ${depth})`);

      // Skip if already visited or depth exceeded
      if (visitedUrls.has(url) || depth > maxDepth) {
        console.log(
          `[crawlWebsite] Skipping ${url} - already visited: ${visitedUrls.has(
            url
          )}, depth exceeded: ${depth > maxDepth}`
        );
        continue;
      }

      try {
        visitedUrls.add(url);

        // Add delay to be respectful to servers
        if (crawledPages.length > 0) {
          console.log(`[crawlWebsite] Adding 500ms delay before fetch...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        console.log(`[crawlWebsite] Fetching page: ${url}`);
        const pageContent = await this.fetchAndProcessPage(url);
        if (pageContent) {
          console.log(
            `[crawlWebsite] Successfully processed page: ${url} (title: ${pageContent.title}, content length: ${pageContent.content.length})`
          );
          crawledPages.push({
            url,
            title: pageContent.title,
            content: pageContent.content,
            depth,
          });

          // If we haven't reached max depth, extract links for next level
          if (depth < maxDepth && crawledPages.length < maxPages) {
            const links = this.extractLinks(pageContent.html, url, baseDomain);
            for (const link of links) {
              if (
                !visitedUrls.has(link) &&
                urlQueue.length + crawledPages.length < maxPages
              ) {
                urlQueue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to crawl ${url}:`, error);
        // Continue with other URLs even if one fails
      }
    }

    return crawledPages;
  }

  /**
   * Fetch and process a single page
   */
  private static async fetchAndProcessPage(
    url: string
  ): Promise<{ title: string; content: string; html: string } | null> {
    try {
      console.log(`[fetchAndProcessPage] Starting fetch for: ${url}`);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MMAI-Crawler/1.0)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      console.log(
        `[fetchAndProcessPage] Response status: ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      console.log(`[fetchAndProcessPage] Content-Type: ${contentType}`);

      if (!contentType.includes("text/html")) {
        throw new Error(`Not an HTML page: ${contentType}`);
      }

      console.log(`[fetchAndProcessPage] Reading HTML content...`);
      const html = await response.text();
      console.log(`[fetchAndProcessPage] HTML content length: ${html.length}`);

      const title = this.extractTitle(html) || new URL(url).pathname;
      console.log(`[fetchAndProcessPage] Extracted title: ${title}`);

      console.log(`[fetchAndProcessPage] Converting HTML to markdown...`);
      const content = this.htmlToMarkdown(html);
      console.log(
        `[fetchAndProcessPage] Markdown content length: ${content.length}`
      );

      if (content.length < 50) {
        console.log(
          `[fetchAndProcessPage] Skipping page with minimal content: ${content.length} chars`
        );
        return null; // Skip pages with very little content
      }

      console.log(`[fetchAndProcessPage] Successfully processed page: ${url}`);
      return { title, content, html };
    } catch (error) {
      console.warn(`[fetchAndProcessPage] Failed to fetch ${url}:`, error);
      return null;
    }
  }

  /**
   * Extract title from HTML
   */
  private static extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      return titleMatch[1].trim().replace(/\s+/g, " ");
    }

    // Fallback to h1
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      return h1Match[1].trim().replace(/\s+/g, " ");
    }

    return "Untitled Page";
  }

  /**
   * Convert HTML to markdown
   */
  private static htmlToMarkdown(html: string): string {
    // Remove script and style tags completely
    let markdown = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    // Convert headers
    markdown = markdown.replace(
      /<h([1-6])[^>]*>([^<]*)<\/h[1-6]>/gi,
      (match, level, content) => {
        const cleanContent = content.replace(/<[^>]*>/g, "").trim();
        return "\n" + "#".repeat(parseInt(level)) + " " + cleanContent + "\n\n";
      }
    );

    // Convert paragraphs and basic formatting
    markdown = markdown
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<strong[^>]*>([^<]*)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>([^<]*)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>([^<]*)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>([^<]*)<\/i>/gi, "*$1*")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<hr[^>]*>/gi, "\n---\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<ul[^>]*>/gi, "\n")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<ol[^>]*>/gi, "\n")
      .replace(/<\/ol>/gi, "\n");

    // Convert links
    markdown = markdown.replace(
      /<a[^>]*href=['"]([^'"]*)['"][^>]*>([^<]*)<\/a>/gi,
      "[$2]($1)"
    );

    // Remove all remaining HTML tags
    markdown = markdown.replace(/<[^>]*>/g, "");

    // Clean up whitespace
    markdown = markdown
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n\s*\n\s*\n/g, "\n\n") // Multiple newlines to double
      .replace(/[ \t]+/g, " ") // Multiple spaces to single
      .trim();

    return markdown;
  }

  /**
   * Extract links from HTML page
   */
  private static extractLinks(
    html: string,
    baseUrl: string,
    baseDomain: string
  ): string[] {
    const links: string[] = [];
    const linkRegex = /<a[^>]*href=['"]([^'"]*)['"][^>]*>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const href = match[1];

        // Skip non-HTTP links
        if (
          href.startsWith("mailto:") ||
          href.startsWith("tel:") ||
          href.startsWith("javascript:")
        ) {
          continue;
        }

        // Resolve relative URLs
        const absoluteUrl = new URL(href, baseUrl).href;
        const linkDomain = new URL(absoluteUrl).hostname;

        // Only include links from the same domain
        if (linkDomain === baseDomain) {
          // Remove fragments and normalize
          const cleanUrl = absoluteUrl.split("#")[0];
          if (!links.includes(cleanUrl)) {
            links.push(cleanUrl);
          }
        }
      } catch (error) {
        // Skip invalid URLs
        continue;
      }
    }

    return links;
  }
}
