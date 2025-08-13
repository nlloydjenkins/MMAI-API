import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

const AUTHORIZED_USER_EMAIL = "admin@MngEnvMCAP9.onmicrosoft.com"; // Update this to your actual email

export async function getRoles(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("get-roles function triggered");

  try {
    // Get the client principal from the request headers
    const clientPrincipalHeader = request.headers.get("x-ms-client-principal");

    if (!clientPrincipalHeader) {
      context.log("No client principal found - user not authenticated");
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roles: [],
        }),
      };
    }

    // Decode the base64 encoded client principal
    const clientPrincipal: ClientPrincipal = JSON.parse(
      Buffer.from(clientPrincipalHeader, "base64").toString("utf-8")
    );

    context.log("Client principal:", JSON.stringify(clientPrincipal, null, 2));

    // Check if this is the authorized user (for Entra ID, check email or userDetails)
    const isAuthorizedUser =
      (clientPrincipal.identityProvider === "aad" ||
        clientPrincipal.identityProvider === "azureactivedirectory") &&
      clientPrincipal.userDetails.toLowerCase() ===
        AUTHORIZED_USER_EMAIL.toLowerCase();

    if (isAuthorizedUser) {
      context.log(
        `Authorized user ${clientPrincipal.userDetails} granted access`
      );
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roles: ["authorized_user"],
        }),
      };
    } else {
      context.log(
        `Unauthorized user ${clientPrincipal.userDetails} denied access`
      );
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roles: [],
        }),
      };
    }
  } catch (error) {
    context.log("Error in get-roles function:", error);
    return {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Internal server error",
        roles: [],
      }),
    };
  }
}

app.http("get-roles", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: getRoles,
});
