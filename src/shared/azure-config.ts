import { TableClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";

export interface AzureConfig {
  storage: {
    connectionString: string;
    containerName: string;
    // Support for mixed environments
    blobConnectionString: string; // For Azure blob storage
    tableConnectionString: string; // For local tables or Azure tables
    useAzureBlob: boolean; // Use Azure blob instead of local
    useAzureTable: boolean; // Use Azure tables instead of local
    accountName?: string; // Storage account name for Azure Identity
  };
  search: {
    endpoint: string;
    apiKey: string;
    indexName: string;
  };
  openai: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
  projects: {
    tableName: string;
    partitionKey: string;
  };
  files: {
    tableName: string;
    partitionKey: string;
    containerName: string;
  };
}

export const getAzureConfig = (): AzureConfig => {
  console.log(
    "🔧 [CONFIG DEBUG] Creating Azure configuration for Azure Functions with AAD authentication"
  );

  // Use AAD authentication for Azure Functions - no connection strings needed!
  const storageAccountName =
    process.env.AZURE_STORAGE_ACCOUNT_NAME || "storagemmai";

  console.log("🔧 [CONFIG DEBUG] Environment check for AAD authentication:", {
    storageAccountName,
    hasAzureStorageAccountName: !!process.env.AZURE_STORAGE_ACCOUNT_NAME,
    usingManagedIdentity: true,
  });

  // Use managed identity authentication for Azure Functions deployment
  const config = {
    storage: {
      connectionString: "", // Not used with AAD authentication
      containerName: "blobmmai",
      blobConnectionString: "", // Not used with AAD authentication
      tableConnectionString: "", // Not used with AAD authentication
      useAzureBlob: true, // Always use Azure blob with managed identity
      useAzureTable: true, // Always use Azure table with managed identity
      accountName: storageAccountName,
    },
    search: {
      endpoint:
        process.env.AZURE_SEARCH_ENDPOINT ||
        "https://aisearchmmai.search.windows.net",
      apiKey: process.env.AZURE_SEARCH_API_KEY || "",
      indexName: process.env.AZURE_SEARCH_INDEX_NAME || "documents-index-v2",
    },
    openai: {
      endpoint:
        process.env.AZURE_OPENAI_ENDPOINT &&
        !process.env.AZURE_OPENAI_ENDPOINT.includes(
          "REPLACE_WITH_YOUR_ENDPOINT_HERE"
        )
          ? process.env.AZURE_OPENAI_ENDPOINT
          : "https://openai-meetingmate.openai.azure.com/",
      apiKey:
        process.env.AZURE_OPENAI_API_KEY &&
        !process.env.AZURE_OPENAI_API_KEY.includes(
          "REPLACE_WITH_YOUR_KEY_VALUE_HERE"
        )
          ? process.env.AZURE_OPENAI_API_KEY
          : "",
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4.1",
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
    },
    projects: {
      tableName: "projects",
      partitionKey: "project",
    },
    files: {
      tableName: "files",
      partitionKey: "file",
      containerName: "blobmmai",
    },
  };

  console.log(
    "🔧 [CONFIG DEBUG] Configuration created for Azure Functions with AAD:",
    {
      storage: {
        accountName: config.storage.accountName,
        useAzureBlob: config.storage.useAzureBlob,
        useAzureTable: config.storage.useAzureTable,
        authMethod: "DefaultAzureCredential (Managed Identity)",
      },
      search: {
        hasEndpoint: !!config.search.endpoint,
        hasApiKey: !!config.search.apiKey,
        indexName: config.search.indexName,
      },
      openai: {
        hasEndpoint: !!config.openai.endpoint,
        hasApiKey: !!config.openai.apiKey,
        deployment: config.openai.deployment,
        apiVersion: config.openai.apiVersion,
      },
    }
  );

  return config;
};

export class AzureClients {
  private static instance: AzureClients;
  private config: AzureConfig;
  private _projectsTableClient: TableClient | null = null;
  private _filesTableClient: TableClient | null = null;
  private _blobServiceClient: BlobServiceClient | null = null;
  private _searchClient: SearchClient<any> | null = null;

  private constructor() {
    console.log("🔧 [CLIENTS DEBUG] Initializing AzureClients");
    this.config = getAzureConfig();
    console.log("🔧 [CLIENTS DEBUG] AzureClients initialized with config");
  }

  public static getInstance(): AzureClients {
    console.log("🔧 [CLIENTS DEBUG] Getting AzureClients instance");
    if (!AzureClients.instance) {
      console.log("🔧 [CLIENTS DEBUG] Creating new AzureClients instance");
      AzureClients.instance = new AzureClients();
    }
    console.log("🔧 [CLIENTS DEBUG] Returning AzureClients instance");
    return AzureClients.instance;
  }

  public getTableClient(): TableClient {
    if (!this._projectsTableClient) {
      if (!this.config.storage.accountName) {
        throw new Error(
          "❌ Azure Storage Account Name not configured. Please set AZURE_STORAGE_ACCOUNT_NAME in Function App settings."
        );
      }

      console.log(
        "🔧 [CLIENTS DEBUG] Creating table client with managed identity for Azure Functions"
      );
      const credential = new DefaultAzureCredential();
      this._projectsTableClient = new TableClient(
        `https://${this.config.storage.accountName}.table.core.windows.net`,
        this.config.projects.tableName,
        credential
      );
    }
    return this._projectsTableClient;
  }

  public getFilesTableClient(): TableClient {
    if (!this._filesTableClient) {
      if (!this.config.storage.accountName) {
        throw new Error(
          "❌ Azure Storage Account Name not configured. Please set AZURE_STORAGE_ACCOUNT_NAME in Function App settings."
        );
      }

      console.log(
        "🔧 [CLIENTS DEBUG] Creating files table client with managed identity for Azure Functions"
      );
      const credential = new DefaultAzureCredential();
      this._filesTableClient = new TableClient(
        `https://${this.config.storage.accountName}.table.core.windows.net`,
        this.config.files.tableName,
        credential
      );
    }
    return this._filesTableClient;
  }

  public getBlobServiceClient(): BlobServiceClient {
    if (!this._blobServiceClient) {
      if (!this.config.storage.accountName) {
        throw new Error(
          "❌ Azure Storage Account Name not configured. Please set AZURE_STORAGE_ACCOUNT_NAME in Function App settings."
        );
      }

      console.log(
        "🔧 [CLIENTS DEBUG] Creating BlobServiceClient with managed identity for Azure Functions"
      );
      const credential = new DefaultAzureCredential();
      this._blobServiceClient = new BlobServiceClient(
        `https://${this.config.storage.accountName}.blob.core.windows.net`,
        credential
      );
    }
    return this._blobServiceClient;
  }

  public getBlobClient(): BlobServiceClient {
    return this.getBlobServiceClient();
  }

  public getSearchClient(): SearchClient<any> {
    if (!this._searchClient) {
      this._searchClient = new SearchClient(
        this.config.search.endpoint,
        this.config.search.indexName,
        new AzureKeyCredential(this.config.search.apiKey)
      );
    }
    return this._searchClient;
  }

  public getConfig(): AzureConfig {
    return this.config;
  }
}
