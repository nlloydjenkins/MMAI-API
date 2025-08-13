import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { v4 as uuidv4 } from "uuid";
import { AzureClients } from "../../shared/azure-config";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
  validateRequiredFields,
} from "../../shared/utils";
import {
  CreateCustomerRequest,
  CreateCustomerResponse,
  CustomerEntity,
  ListCustomersResponse,
  UpdateCustomerRequest,
} from "../../shared/types";

export async function customersHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log(
    `HTTP trigger function processed a ${request.method} request to customers endpoint.`
  );

  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    const customerId = request.params.id;

    if (request.method === "POST") {
      return await createCustomer(request, context);
    } else if (request.method === "GET") {
      if (!customerId) {
        return await listCustomers(request, context);
      } else {
        return createErrorResponse(
          404,
          "NOT_FOUND",
          "Single customer GET not implemented"
        );
      }
    } else if (request.method === "PUT") {
      if (!customerId) {
        return createErrorResponse(
          400,
          "BAD_REQUEST",
          "Customer ID is required for updates"
        );
      }
      return await updateCustomer(request, context, customerId);
    } else {
      return createErrorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed"
      );
    }
  } catch (error) {
    // Use context.log.error for errors (InvocationContext doesn't expose context.error)
    (context.log as any)?.error?.("Error in customers handler:", error) ||
      context.log("Error in customers handler:", error);
    return createErrorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "An internal server error occurred"
    );
  }
}

async function createCustomer(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body: CreateCustomerRequest =
      (await request.json()) as CreateCustomerRequest;

    // Validate required fields
    const missingFields = validateRequiredFields(body, ["name"]);
    if (missingFields.length > 0) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        `Missing required fields: ${missingFields.join(", ")}`
      );
    }

    // Validate customer name
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Customer name must be a non-empty string"
      );
    }

    if (body.name.trim().length > 100) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        "Customer name must be 100 characters or less"
      );
    }

    // Get Azure clients
    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();

    const customerId = uuidv4();
    const createdAt = new Date().toISOString();

    const customerEntity: CustomerEntity = {
      partitionKey: "customer",
      rowKey: customerId,
      name: body.name.trim(),
      contactName: body.contactName,
      email: body.email,
      link: body.link,
      createdAt,
    };

    await tableClient.createEntity(customerEntity);

    const response: CreateCustomerResponse = {
      id: customerId,
      name: body.name.trim(),
      contactName: body.contactName,
      email: body.email,
      link: body.link,
      createdAt,
    };

    context.log(`Customer created successfully: ${customerId}`);
    return createSuccessResponse(response, 201);
  } catch (error) {
    (context.log as any)?.error?.("Error creating customer:", error) ||
      context.log("Error creating customer:", error);
    return createErrorResponse(
      500,
      "CUSTOMER_CREATION_FAILED",
      "Failed to create customer"
    );
  }
}

async function listCustomers(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // Get Azure clients
    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();

    const entities = tableClient.listEntities<CustomerEntity>({
      queryOptions: { filter: "PartitionKey eq 'customer'" },
    });

    const customers: CreateCustomerResponse[] = [];
    for await (const entity of entities) {
      customers.push({
        id: entity.rowKey,
        name: entity.name,
        contactName: entity.contactName,
        email: entity.email,
        link: entity.link,
        createdAt: entity.createdAt,
      });
    }

    // Sort by creation date (newest first)
    customers.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const response: ListCustomersResponse = { customers };
    context.log(`Retrieved ${customers.length} customers`);
    return createSuccessResponse(response);
  } catch (error) {
    (context.log as any)?.error?.("Error listing customers:", error) ||
      context.log("Error listing customers:", error);
    return createErrorResponse(
      500,
      "CUSTOMER_RETRIEVAL_FAILED",
      "Failed to retrieve customers"
    );
  }
}

async function updateCustomer(
  request: HttpRequest,
  context: InvocationContext,
  customerId: string
): Promise<HttpResponseInit> {
  try {
    const body: UpdateCustomerRequest =
      (await request.json()) as UpdateCustomerRequest;

    // Get Azure clients
    const azureClients = AzureClients.getInstance();
    const tableClient = azureClients.getTableClient();

    // Get existing customer
    const existingEntity = await tableClient.getEntity<CustomerEntity>(
      "customer",
      customerId
    );

    // Update only provided fields
    const updatedEntity: CustomerEntity = {
      ...existingEntity,
      name: body.name !== undefined ? body.name.trim() : existingEntity.name,
      contactName:
        body.contactName !== undefined
          ? body.contactName
          : existingEntity.contactName,
      email: body.email !== undefined ? body.email : existingEntity.email,
      link: body.link !== undefined ? body.link : existingEntity.link,
    };

    await tableClient.updateEntity(updatedEntity, "Merge");

    const response: CreateCustomerResponse = {
      id: customerId,
      name: updatedEntity.name,
      contactName: updatedEntity.contactName,
      email: updatedEntity.email,
      link: updatedEntity.link,
      createdAt: updatedEntity.createdAt,
    };

    context.log(`Customer updated successfully: ${customerId}`);
    return createSuccessResponse(response);
  } catch (error) {
    (context.log as any)?.error?.("Error updating customer:", error) ||
      context.log("Error updating customer:", error);
    return createErrorResponse(
      500,
      "CUSTOMER_UPDATE_FAILED",
      "Failed to update customer"
    );
  }
}

app.http("customers", {
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  authLevel: "anonymous",
  route: "customers/{id?}",
  handler: customersHandler,
});
