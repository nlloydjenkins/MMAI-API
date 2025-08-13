import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { createSuccessResponse } from "../../shared/utils";
import versionInfo from "../../version.json";

export async function health(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Health check function triggered");
  return createSuccessResponse({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: versionInfo.version,
    buildDate: versionInfo.buildDate,
    buildNumber: versionInfo.buildNumber,
    env: {
      FUNCTIONS_WORKER_RUNTIME: process.env.FUNCTIONS_WORKER_RUNTIME || null,
      AZURE_STORAGE_ACCOUNT_NAME:
        process.env.AZURE_STORAGE_ACCOUNT_NAME || null,
    },
  });
}

app.http("health", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "health",
  handler: health,
});
