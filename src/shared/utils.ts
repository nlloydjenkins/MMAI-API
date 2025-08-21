import { HttpRequest, HttpResponseInit } from "@azure/functions";

const getAllowedOrigins = (): string[] => {
  const envList = process.env.CORS_ALLOWED_ORIGINS;
  const defaults = [
    "http://localhost:5173",
    "https://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  if (!envList) return defaults;
  return envList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const resolveOrigin = (request?: HttpRequest): string => {
  const origins = getAllowedOrigins();
  const reqOrigin = request?.headers.get("origin") || "";
  if (reqOrigin && origins.includes(reqOrigin)) return reqOrigin;
  // Fallback to the first allowed origin to keep responses consistent
  return origins[0] || "http://localhost:5173";
};

export const createErrorResponse = (
  statusCode: number,
  error: string,
  message: string,
  request?: HttpRequest
): HttpResponseInit => {
  return {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": resolveOrigin(request),
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Content-Disposition, x-ms-client-principal",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify({
      error,
      message,
    }),
  };
};

export const createSuccessResponse = (
  data: any,
  statusCode: number = 200,
  request?: HttpRequest
): HttpResponseInit => {
  return {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": resolveOrigin(request),
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Content-Disposition, x-ms-client-principal",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(data),
  };
};

export const handleCors = (request: HttpRequest): HttpResponseInit | null => {
  if (request.method === "OPTIONS") {
    return {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": resolveOrigin(request),
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Content-Disposition, x-ms-client-principal",
        "Access-Control-Allow-Credentials": "true",
      },
    };
  }
  return null;
};

export const validateRequiredFields = (
  body: any,
  requiredFields: string[]
): string[] => {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (
      !body ||
      body[field] === undefined ||
      body[field] === null ||
      body[field] === ""
    ) {
      missingFields.push(field);
    }
  }

  return missingFields;
};

export const getDefaultAdviceSystemPrompt = (): string => {
  return (
    process.env.DEFAULT_ADVICE_SYSTEM_PROMPT ||
    "You are an expert business advisor providing guidance during live meetings. Your responses must be: CONCISE (maximum 3-4 bullet points per section), HIGH-LEVEL (strategic focus, not tactical details), SCANNABLE (use clear headers and bullet points), and ACTIONABLE (specific next steps with owners when possible). Avoid lengthy explanations or technical jargon. Format everything for quick reading during fast-paced meetings. Each recommendation should be 1-2 sentences maximum."
  );
};
