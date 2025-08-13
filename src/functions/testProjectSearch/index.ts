import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import {
  createErrorResponse,
  createSuccessResponse,
  handleCors,
} from "../../shared/utils";
import { AzureClients } from "../../shared/azure-config";
import { SearchIndexClient, AzureKeyCredential } from "@azure/search-documents";

interface ProjectSearchTestResponse {
  projectId: string;
  totalDocuments: number;
  filteredDocuments: number;
  sampleFiltered: any[];
  sampleUnfiltered: any[];
  indexSchema: any;
  filterStrategies: any;
}

export async function testProjectSearch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Testing project-specific search functionality");

  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    const projectId = request.query.get("projectId");
    if (!projectId) {
      return createErrorResponse(
        400,
        "MISSING_PROJECT_ID",
        "projectId query parameter is required"
      );
    }

    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();
    const searchClient = azureClients.getSearchClient();

    // Get index schema
    const indexClient = new SearchIndexClient(
      config.search.endpoint,
      new AzureKeyCredential(config.search.apiKey)
    );

    let indexSchema = null;
    try {
      const index = await indexClient.getIndex(config.search.indexName);
      indexSchema = {
        fields: index.fields.map((f) => ({
          name: f.name,
          type: f.type,
          searchable: (f as any).searchable,
          filterable: (f as any).filterable,
          key: (f as any).key,
        })),
      };
    } catch (indexError) {
      context.log("Could not get index schema:", indexError);
    }

    // Test different filter strategies
    const filterStrategies = [
      { name: "project_id exact", filter: `project_id eq '${projectId}'` },
      { name: "projectId exact", filter: `projectId eq '${projectId}'` },
      {
        name: "metadata_storage_path contains",
        filter: `search.ismatch('${projectId}', 'metadata_storage_path')`,
      },
      {
        name: "metadata_storage_name contains",
        filter: `search.ismatch('${projectId}', 'metadata_storage_name')`,
      },
      { name: "any field contains", filter: `search.ismatch('${projectId}')` },
    ];

    const results: any = {
      projectId,
      indexSchema,
      filterStrategies: {},
    };

    // Get total documents without filter
    const unfiltered = await searchClient.search("*", {
      top: 5,
      includeTotalCount: true,
      select: ["*"],
    });

    results.totalDocuments = unfiltered.count || 0;
    results.sampleUnfiltered = [];
    for await (const result of unfiltered.results) {
      results.sampleUnfiltered.push(result.document);
    }

    // Test each filter strategy
    for (const strategy of filterStrategies) {
      try {
        context.log(
          `Testing filter strategy: ${strategy.name} - ${strategy.filter}`
        );

        const filtered = await searchClient.search("*", {
          top: 5,
          includeTotalCount: true,
          filter: strategy.filter,
          select: ["*"],
        });

        const documents = [];
        for await (const result of filtered.results) {
          documents.push(result.document);
        }

        results.filterStrategies[strategy.name] = {
          filter: strategy.filter,
          totalCount: filtered.count || 0,
          documents: documents,
        };

        context.log(
          `Strategy "${strategy.name}" found ${filtered.count || 0} documents`
        );
      } catch (strategyError) {
        context.log(`Strategy "${strategy.name}" failed:`, strategyError);
        results.filterStrategies[strategy.name] = {
          filter: strategy.filter,
          error:
            strategyError instanceof Error
              ? strategyError.message
              : String(strategyError),
        };
      }
    }

    // Find the best working strategy
    const workingStrategies = Object.entries(results.filterStrategies)
      .filter(
        ([_, result]: [string, any]) => !result.error && result.totalCount > 0
      )
      .sort(
        ([_, a]: [string, any], [__, b]: [string, any]) =>
          b.totalCount - a.totalCount
      );

    if (workingStrategies.length > 0) {
      const [bestStrategyName, bestResult] = workingStrategies[0];
      context.log(
        `Best working strategy: ${bestStrategyName} with ${
          (bestResult as any).totalCount
        } documents`
      );

      results.bestStrategy = {
        name: bestStrategyName,
        filter: (bestResult as any).filter,
        totalCount: (bestResult as any).totalCount,
      };
    }

    return createSuccessResponse(results);
  } catch (error) {
    context.log("Error testing project search:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      500,
      "TEST_ERROR",
      `Test failed: ${errorMessage}`
    );
  }
}

app.http("testProjectSearch", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "search/test-project",
  handler: testProjectSearch,
});
