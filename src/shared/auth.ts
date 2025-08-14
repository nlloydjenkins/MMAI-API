import { HttpRequest, InvocationContext, HttpResponseInit } from "@azure/functions";

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

/**
 * Extract client principal from Azure Static Web Apps authentication headers
 */
export function getClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const clientPrincipalHeader = request.headers.get("x-ms-client-principal");
  
  if (!clientPrincipalHeader) {
    return null;
  }

  try {
    const decoded = Buffer.from(clientPrincipalHeader, "base64").toString("utf-8");
    return JSON.parse(decoded) as ClientPrincipal;
  } catch (error) {
    console.error("Failed to parse client principal:", error);
    return null;
  }
}

/**
 * Check if the request is authenticated (only in production/Azure)
 */
export function requireAuthentication(
  request: HttpRequest,
  context: InvocationContext
): HttpResponseInit | null {
  // Skip authentication check in local development
  if (isLocalDevelopment()) {
    context.log("🔧 Local development - skipping authentication check");
    return null;
  }

  const clientPrincipal = getClientPrincipal(request);
  
  if (!clientPrincipal) {
    context.log("❌ Unauthorized access attempt - no client principal");
    return {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-ms-client-principal"
      },
      jsonBody: {
        error: "UNAUTHORIZED",
        message: "Authentication required"
      }
    };
  }
  
  context.log(`✅ Authenticated user: ${clientPrincipal.userDetails} (${clientPrincipal.userId})`);
  return null; // No error, user is authenticated
}

/**
 * Check if the user has a specific role
 */
export function requireRole(
  request: HttpRequest,
  context: InvocationContext,
  requiredRole: string
): HttpResponseInit | null {
  // Skip role check in local development
  if (isLocalDevelopment()) {
    context.log(`🔧 Local development - skipping role check for ${requiredRole}`);
    return null;
  }

  const clientPrincipal = getClientPrincipal(request);
  
  if (!clientPrincipal) {
    return {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      jsonBody: {
        error: "UNAUTHORIZED",
        message: "Authentication required"
      }
    };
  }
  
  if (!clientPrincipal.userRoles.includes(requiredRole)) {
    context.log(`❌ Access denied for user ${clientPrincipal.userDetails} - missing role ${requiredRole}`);
    return {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      jsonBody: {
        error: "FORBIDDEN",
        message: `Insufficient permissions. Required role: ${requiredRole}`
      }
    };
  }
  
  context.log(`✅ User ${clientPrincipal.userDetails} has required role: ${requiredRole}`);
  return null; // No error, user has required role
}

/**
 * Get the current authenticated user (if any)
 */
export function getCurrentUser(request: HttpRequest): ClientPrincipal | null {
  if (isLocalDevelopment()) {
    // Return a mock user for local development
    return {
      identityProvider: "aad",
      userId: "local-dev-user",
      userDetails: "Local Developer",
      userRoles: ["authenticated", "admin"]
    };
  }

  return getClientPrincipal(request);
}

/**
 * Check if we're running in local development
 */
function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || 
         process.env.FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT === '1' ||
         !process.env.WEBSITE_SITE_NAME; // WEBSITE_SITE_NAME is set in Azure
}

/**
 * Log authentication info for debugging
 */
export function logAuthInfo(request: HttpRequest, context: InvocationContext): void {
  const clientPrincipal = getCurrentUser(request);
  
  if (clientPrincipal) {
    context.log(`👤 User: ${clientPrincipal.userDetails}`);
    context.log(`🔑 Provider: ${clientPrincipal.identityProvider}`);
    context.log(`👥 Roles: ${clientPrincipal.userRoles.join(", ")}`);
  } else {
    context.log(`👤 Anonymous user`);
  }
}
