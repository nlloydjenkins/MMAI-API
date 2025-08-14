import { HttpRequest, HttpResponseInit } from "@azure/functions";

export const createErrorResponse = (
  statusCode: number,
  error: string,
  message: string
): HttpResponseInit => {
  return {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Content-Disposition, x-ms-client-principal",
    },
    body: JSON.stringify({
      error,
      message,
    }),
  };
};

export const createSuccessResponse = (
  data: any,
  statusCode: number = 200
): HttpResponseInit => {
  return {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Content-Disposition, x-ms-client-principal",
    },
    body: JSON.stringify(data),
  };
};

export const handleCors = (request: HttpRequest): HttpResponseInit | null => {
  if (request.method === "OPTIONS") {
    return {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Content-Disposition, x-ms-client-principal",
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
