import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

interface FetchUrlTitleRequest {
  url: string;
}

interface FetchUrlTitleResponse {
  success: boolean;
  title?: string;
  error?: string;
}

export async function fetchUrlTitle(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('🔗 [API DEBUG] Fetch URL title function triggered');

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  try {
    const body: FetchUrlTitleRequest = await request.json() as FetchUrlTitleRequest;
    const { url } = body;

    if (!url) {
      return {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: 'URL is required',
        } as FetchUrlTitleResponse),
      };
    }

    // Validate URL format
    let validUrl: URL;
    try {
      validUrl = new URL(url);
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (error) {
      return {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: 'Invalid URL format',
        } as FetchUrlTitleResponse),
      };
    }

    context.log(`🔗 [API DEBUG] Fetching title for URL: ${url}`);

    // Fetch the webpage
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      context.log(`🔗 [API DEBUG] HTTP error: ${response.status} ${response.statusText}`);
      return {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
        } as FetchUrlTitleResponse),
      };
    }

    const html = await response.text();
    
    // Extract title using regex (more reliable than DOM parsing in this context)
    let title = '';
    
    // Try to find <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
    }
    
    // If no title found, try og:title meta tag
    if (!title) {
      const ogTitleMatch = html.match(/<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']*)["\'][^>]*>/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        title = ogTitleMatch[1].trim();
      }
    }
    
    // If still no title, try twitter:title meta tag
    if (!title) {
      const twitterTitleMatch = html.match(/<meta[^>]*name=["\']twitter:title["\'][^>]*content=["\']([^"\']*)["\'][^>]*>/i);
      if (twitterTitleMatch && twitterTitleMatch[1]) {
        title = twitterTitleMatch[1].trim();
      }
    }
    
    // Clean up the title
    if (title) {
      // Decode HTML entities
      title = title
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
    }
    
    // If still no title, use the domain name
    if (!title) {
      title = validUrl.hostname;
    }

    context.log(`🔗 [API DEBUG] Extracted title: "${title}"`);

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        title,
      } as FetchUrlTitleResponse),
    };

  } catch (error: any) {
    context.log('❌ [API DEBUG] Error fetching URL title:', error);
    
    return {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to fetch URL title',
      } as FetchUrlTitleResponse),
    };
  }
}

app.http('fetchUrlTitle', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'fetchUrlTitle',
  handler: fetchUrlTitle,
});
