import { SearchClient } from "@azure/search-documents";
import { InvocationContext } from "@azure/functions";

interface ProjectFilterStrategy {
  name: string;
  filter: string;
  priority: number;
}

const PROJECT_FILTER_STRATEGIES: ProjectFilterStrategy[] = [
  { name: "project_id", filter: "project_id eq '{projectId}'", priority: 1 },
  { name: "projectId", filter: "projectId eq '{projectId}'", priority: 2 },
  { name: "project", filter: "project eq '{projectId}'", priority: 3 },
];

let _cachedWorkingStrategy: ProjectFilterStrategy | null = null;

export async function getProjectFilter(
  projectId: string,
  searchClient: SearchClient<any>,
  context?: InvocationContext
): Promise<string | null> {
  // Use cached strategy if available
  if (_cachedWorkingStrategy) {
    const filter = _cachedWorkingStrategy.filter.replace(
      "{projectId}",
      projectId
    );
    context?.log(
      `🔍 Using cached project filter strategy: ${_cachedWorkingStrategy.name}`
    );
    return filter;
  }

  context?.log(
    `🔍 Testing project filter strategies for projectId: ${projectId}`
  );

  // Test strategies in order of priority
  for (const strategy of PROJECT_FILTER_STRATEGIES) {
    try {
      const testFilter = strategy.filter.replace("{projectId}", projectId);
      context?.log(`🔍 Testing strategy: ${strategy.name} - ${testFilter}`);

      // Quick test search to see if the filter works
      const testResults = await searchClient.search("*", {
        top: 1,
        includeTotalCount: true,
        filter: testFilter,
        select: ["id"],
      });

      // If no error and we get a count, this strategy works
      const count = testResults.count || 0;
      context?.log(
        `🔍 Strategy "${strategy.name}" returned ${count} documents`
      );

      if (count >= 0) {
        // Even 0 results means the filter syntax is valid
        _cachedWorkingStrategy = strategy;
        context?.log(`✅ Using project filter strategy: ${strategy.name}`);
        return testFilter;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      context?.log(`❌ Strategy "${strategy.name}" failed: ${errorMessage}`);
    }
  }

  context?.log(
    `⚠️ No working project filter strategy found for projectId: ${projectId}`
  );
  return null;
}

export function clearProjectFilterCache(): void {
  _cachedWorkingStrategy = null;
}

export async function searchWithProjectFilter(
  searchClient: SearchClient<any>,
  query: string,
  projectId: string | null,
  searchOptions: any,
  context?: InvocationContext
): Promise<any> {
  if (!projectId) {
    context?.log(`🔍 No projectId provided, searching all documents`);
    return await searchClient.search(query, searchOptions);
  }

  const projectFilter = await getProjectFilter(
    projectId,
    searchClient,
    context
  );

  if (projectFilter) {
    searchOptions.filter = projectFilter;
    context?.log(`🔍 Searching with project filter: ${projectFilter}`);
  } else {
    context?.log(`⚠️ Could not create project filter, searching all documents`);
  }

  return await searchClient.search(query, searchOptions);
}
