/**
 * Advanced web crawler with enhanced HTTP client and browser automation fallback
 */

import { chromium } from 'playwright';

interface CrawlOptions {
  maxDepth: number;
  maxPages: number;
  progressCallback?: (url: string, pageCount: number, maxPages: number) => Promise<void>;
}

interface CrawlError {
  url: string;
  error: string;
  timestamp: string;
  method: 'http' | 'browser';
}

interface PageContent {
  url: string;
  title: string;
  content: string;
  depth: number;
  method: 'http' | 'browser';
}

interface CrawlResult {
  pages: PageContent[];
  errors: CrawlError[];
  httpAttempts: number;
  browserFallbacks: number;
}

export class AdvancedCrawler {
  private static userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
  ];

  /**
   * Enhanced HTTP client with better anti-detection measures
   */
  private static async fetchWithEnhancedHeaders(url: string, retries: number = 2): Promise<Response> {
    const randomUserAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    
    const headers = {
      'User-Agent': randomUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
      'Connection': 'keep-alive'
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Add random delay to avoid rate limiting
        if (attempt > 0) {
          const delayMs = Math.random() * 2000 + 1000; // 1-3 seconds
          console.log(`[AdvancedCrawler] Retry ${attempt} for ${url} - waiting ${delayMs.toFixed(0)}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        const response = await fetch(url, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(15000) // 15 second timeout
        });

        return response;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        console.log(`[AdvancedCrawler] HTTP attempt ${attempt + 1} failed for ${url}:`, error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error('All HTTP attempts failed');
  }

  /**
   * Process page content with enhanced error detection
   */
  private static async processHttpResponse(url: string, response: Response): Promise<PageContent | null> {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Not an HTML page: ${contentType}`);
    }

    const html = await response.text();
    
    // Enhanced bot detection
    const htmlLower = html.toLowerCase();
    const botDetectionIndicators = [
      'cloudflare',
      'checking your browser',
      'please enable javascript',
      'access denied',
      'blocked',
      'captcha',
      'security check',
      'ddos protection',
      'ray id',
      'cf-ray',
      'bot protection',
      'antibot',
      'human verification'
    ];

    for (const indicator of botDetectionIndicators) {
      if (htmlLower.includes(indicator)) {
        throw new Error(`Bot detection - Website is using anti-bot protection (detected: ${indicator})`);
      }
    }

    const title = this.extractTitle(html) || new URL(url).pathname;
    const content = this.htmlToMarkdown(html);

    if (content.length < 50) {
      return null; // Skip pages with minimal content
    }

    return {
      url,
      title,
      content,
      depth: 0, // Will be set by caller
      method: 'http'
    };
  }

  /**
   * Browser automation fallback using Playwright
   */
  private static async fetchWithBrowser(url: string): Promise<PageContent | null> {
    let browser = null;
    try {
      console.log(`[AdvancedCrawler] Starting browser fallback for: ${url}`);
      
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      const context = await browser.newContext({
        userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const page = await context.newPage();
      
      // Block images and other resources to speed up loading
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      console.log(`[AdvancedCrawler] Navigating to ${url} with browser...`);
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait a bit for dynamic content to load
      await page.waitForTimeout(2000);

      // Get page content
      const title = await page.title();
      const html = await page.content();
      const content = this.htmlToMarkdown(html);

      console.log(`[AdvancedCrawler] Browser successfully processed: ${url} (title: ${title}, content: ${content.length} chars)`);

      if (content.length < 50) {
        return null;
      }

      return {
        url,
        title,
        content,
        depth: 0, // Will be set by caller
        method: 'browser'
      };

    } catch (error) {
      console.error(`[AdvancedCrawler] Browser fallback failed for ${url}:`, error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Try HTTP first, fallback to browser if needed
   */
  private static async fetchPage(url: string): Promise<{ content: PageContent | null; method: 'http' | 'browser' }> {
    // Phase 1: Try enhanced HTTP client
    try {
      console.log(`[AdvancedCrawler] Attempting HTTP fetch for: ${url}`);
      const response = await this.fetchWithEnhancedHeaders(url);
      const content = await this.processHttpResponse(url, response);
      console.log(`[AdvancedCrawler] HTTP fetch successful for: ${url}`);
      return { content, method: 'http' };
    } catch (httpError) {
      const errorMessage = httpError instanceof Error ? httpError.message.toLowerCase() : String(httpError).toLowerCase();
      
      // Only use browser fallback for bot detection, blocking, or rate limiting
      const shouldUseBrowserFallback = 
        errorMessage.includes('bot detection') ||
        errorMessage.includes('cloudflare') ||
        errorMessage.includes('captcha') ||
        errorMessage.includes('403') ||
        errorMessage.includes('forbidden') ||
        errorMessage.includes('429') ||
        errorMessage.includes('rate limit');

      if (!shouldUseBrowserFallback) {
        // For other errors (404, network issues, etc.), don't waste time with browser
        throw httpError;
      }

      // Phase 2: Browser automation fallback
      console.log(`[AdvancedCrawler] HTTP failed (${httpError instanceof Error ? httpError.message : String(httpError)}), trying browser fallback...`);
      
      try {
        const content = await this.fetchWithBrowser(url);
        console.log(`[AdvancedCrawler] Browser fallback successful for: ${url}`);
        return { content, method: 'browser' };
      } catch (browserError) {
        console.error(`[AdvancedCrawler] Both HTTP and browser failed for ${url}`);
        throw new Error(`HTTP failed: ${httpError instanceof Error ? httpError.message : String(httpError)}. Browser fallback failed: ${browserError instanceof Error ? browserError.message : String(browserError)}`);
      }
    }
  }

  /**
   * Main crawling method with enhanced error handling and user feedback
   */
  public static async crawlWebsite(
    startUrl: string,
    options: CrawlOptions
  ): Promise<CrawlResult> {
    const { maxDepth, maxPages, progressCallback } = options;
    
    console.log(`[AdvancedCrawler] Starting enhanced crawl of ${startUrl} (maxDepth: ${maxDepth}, maxPages: ${maxPages})`);
    
    const visitedUrls = new Set<string>();
    const crawledPages: PageContent[] = [];
    const crawlErrors: CrawlError[] = [];
    const urlQueue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
    
    let httpAttempts = 0;
    let browserFallbacks = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    // Get base domain to limit crawling
    const baseDomain = new URL(startUrl).hostname;
    console.log(`[AdvancedCrawler] Base domain: ${baseDomain}`);

    while (urlQueue.length > 0 && crawledPages.length < maxPages && consecutiveErrors < maxConsecutiveErrors) {
      const { url, depth } = urlQueue.shift()!;
      
      if (visitedUrls.has(url) || depth > maxDepth) {
        continue;
      }

      try {
        visitedUrls.add(url);

        // Adaptive delay based on recent errors
        if (crawledPages.length > 0) {
          const baseDelay = 1000; // 1 second base delay
          const errorPenalty = Math.min(consecutiveErrors * 500, 3000); // Up to 3 seconds extra
          const totalDelay = baseDelay + errorPenalty + (Math.random() * 1000); // Add randomization
          
          console.log(`[AdvancedCrawler] Waiting ${totalDelay.toFixed(0)}ms before next request...`);
          await new Promise(resolve => setTimeout(resolve, totalDelay));
        }

        // Update progress
        if (progressCallback) {
          await progressCallback(url, crawledPages.length, maxPages);
        }

        // Try to fetch the page
        const { content, method } = await this.fetchPage(url);
        
        if (method === 'http') {
          httpAttempts++;
        } else {
          browserFallbacks++;
        }

        if (content) {
          content.depth = depth;
          crawledPages.push(content);
          consecutiveErrors = 0; // Reset error counter on success
          
          console.log(`[AdvancedCrawler] Successfully processed page ${crawledPages.length}/${maxPages}: ${url} (method: ${method})`);

          // Update progress after successful processing
          if (progressCallback) {
            await progressCallback(url, crawledPages.length, maxPages);
          }

          // Extract links for next level if not at max depth
          if (depth < maxDepth && crawledPages.length < maxPages) {
            // For now, skip link extraction to keep this implementation focused
            // We'll implement this in the next step if needed
          }
        }

      } catch (error) {
        consecutiveErrors++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Determine which method was attempted
        const attemptedMethod = errorMessage.includes('Browser fallback failed') ? 'browser' : 'http';
        
        console.warn(`[AdvancedCrawler] Failed to crawl ${url} (consecutive errors: ${consecutiveErrors}):`, error);
        
        crawlErrors.push({
          url,
          error: errorMessage,
          timestamp: new Date().toISOString(),
          method: attemptedMethod
        });

        // If we're getting too many consecutive errors, stop crawling
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`[AdvancedCrawler] Too many consecutive errors (${consecutiveErrors}), stopping crawl`);
          break;
        }
      }
    }

    const result = {
      pages: crawledPages,
      errors: crawlErrors,
      httpAttempts,
      browserFallbacks
    };

    console.log(`[AdvancedCrawler] Crawl completed. Pages: ${crawledPages.length}, Errors: ${crawlErrors.length}, HTTP attempts: ${httpAttempts}, Browser fallbacks: ${browserFallbacks}`);
    
    return result;
  }

  /**
   * Extract title from HTML
   */
  private static extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      return titleMatch[1].trim().replace(/\s+/g, ' ');
    }

    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      return h1Match[1].trim().replace(/\s+/g, ' ');
    }

    return '';
  }

  /**
   * Convert HTML to markdown (simplified version)
   */
  private static htmlToMarkdown(html: string): string {
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Convert common HTML tags to markdown
    text = text.replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, content) => {
      const hashes = '#'.repeat(parseInt(level));
      return `${hashes} ${content}\n\n`;
    });
    
    text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
    text = text.replace(/<br[^>]*>/gi, '\n');
    text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    
    // Remove all other HTML tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Clean up whitespace
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    
    // Normalize whitespace
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
    text = text.replace(/[ \t]+/g, ' ');
    
    return text.trim();
  }
}
