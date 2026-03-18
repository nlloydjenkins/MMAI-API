import { TableClient, TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import {
  DefaultAzureCredential,
  ClientSecretCredential,
} from "@azure/identity";

// Azurite well-known connection string for local development
const AZURITE_CONNECTION_STRING =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;" +
  "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

export const isLocalStorage = (): boolean =>
  process.env.USE_LOCAL_STORAGE === "true";

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
  const useLocal = isLocalStorage();
  console.log(
    `🔧 [CONFIG DEBUG] Creating Azure configuration (local=${useLocal})`,
  );

  const storageAccountName =
    process.env.AZURE_STORAGE_ACCOUNT_NAME || "storagemmai";

  console.log("🔧 [CONFIG DEBUG] Environment check:", {
    storageAccountName,
    useLocalStorage: useLocal,
    hasAzureStorageAccountName: !!process.env.AZURE_STORAGE_ACCOUNT_NAME,
  });

  const config = {
    storage: {
      connectionString: useLocal ? AZURITE_CONNECTION_STRING : "",
      containerName: "blobmmai",
      blobConnectionString: useLocal ? AZURITE_CONNECTION_STRING : "",
      tableConnectionString: useLocal ? AZURITE_CONNECTION_STRING : "",
      useAzureBlob: !useLocal,
      useAzureTable: !useLocal,
      accountName: useLocal ? "devstoreaccount1" : storageAccountName,
    },
    search: {
      endpoint:
        process.env.AZURE_SEARCH_ENDPOINT ||
        "https://aisearchmmai.search.windows.net",
      apiKey: process.env.AZURE_SEARCH_API_KEY || "",
      indexName: process.env.AZURE_SEARCH_INDEX_NAME || "documents-index",
    },
    openai: {
      endpoint:
        process.env.AZURE_OPENAI_ENDPOINT &&
        !process.env.AZURE_OPENAI_ENDPOINT.includes(
          "REPLACE_WITH_YOUR_ENDPOINT_HERE",
        )
          ? process.env.AZURE_OPENAI_ENDPOINT
          : "https://openai-meetingmate.openai.azure.com/",
      apiKey:
        process.env.AZURE_OPENAI_API_KEY &&
        !process.env.AZURE_OPENAI_API_KEY.includes(
          "REPLACE_WITH_YOUR_KEY_VALUE_HERE",
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

  console.log("🔧 [CONFIG DEBUG] Configuration created:", {
    storage: {
      accountName: config.storage.accountName,
      useAzureBlob: config.storage.useAzureBlob,
      useAzureTable: config.storage.useAzureTable,
      authMethod: useLocal ? "Azurite (local)" : "DefaultAzureCredential",
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
  });

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

  private getCredential() {
    // Check if we have service principal credentials explicitly set
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;

    if (clientId && clientSecret && tenantId) {
      console.log(
        "🔧 [CLIENTS DEBUG] Using ClientSecretCredential for service principal authentication",
      );
      console.log("🔧 [CLIENTS DEBUG] Client ID:", clientId);
      console.log("🔧 [CLIENTS DEBUG] Tenant ID:", tenantId);

      // For private endpoints, we may need to configure the credential with specific options
      const credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
        {
          // Disable instance metadata service for private endpoints
          disableInstanceDiscovery: false,
          // Use specific authority URL that works with private endpoints
          authorityHost: "https://login.microsoftonline.com",
        },
      );

      return credential;
    } else {
      console.log(
        "🔧 [CLIENTS DEBUG] Using DefaultAzureCredential for managed identity",
      );
      return new DefaultAzureCredential({
        // Configure for private endpoint access
        managedIdentityClientId: undefined,
      });
    }
  }

  public getTableClient(): TableClient {
    if (!this._projectsTableClient) {
      if (isLocalStorage()) {
        console.log(
          "🔧 [CLIENTS DEBUG] Creating table client for Azurite (local)",
        );
        this._projectsTableClient = TableClient.fromConnectionString(
          AZURITE_CONNECTION_STRING,
          this.config.projects.tableName,
          { allowInsecureConnection: true },
        );
      } else {
        if (!this.config.storage.accountName) {
          throw new Error(
            "❌ Azure Storage Account Name not configured. Please set AZURE_STORAGE_ACCOUNT_NAME in Function App settings.",
          );
        }
        console.log(
          "🔧 [CLIENTS DEBUG] Creating table client with AAD authentication",
        );
        const credential = this.getCredential();
        this._projectsTableClient = new TableClient(
          `https://${this.config.storage.accountName}.table.core.windows.net`,
          this.config.projects.tableName,
          credential,
        );
      }
    }
    return this._projectsTableClient;
  }

  public getFilesTableClient(): TableClient {
    if (!this._filesTableClient) {
      if (isLocalStorage()) {
        console.log(
          "🔧 [CLIENTS DEBUG] Creating files table client for Azurite (local)",
        );
        this._filesTableClient = TableClient.fromConnectionString(
          AZURITE_CONNECTION_STRING,
          this.config.files.tableName,
          { allowInsecureConnection: true },
        );
      } else {
        if (!this.config.storage.accountName) {
          throw new Error(
            "❌ Azure Storage Account Name not configured. Please set AZURE_STORAGE_ACCOUNT_NAME in Function App settings.",
          );
        }
        console.log(
          "🔧 [CLIENTS DEBUG] Creating files table client with AAD authentication",
        );
        const credential = this.getCredential();
        this._filesTableClient = new TableClient(
          `https://${this.config.storage.accountName}.table.core.windows.net`,
          this.config.files.tableName,
          credential,
        );
      }
    }
    return this._filesTableClient;
  }

  public getBlobServiceClient(): BlobServiceClient {
    if (!this._blobServiceClient) {
      if (isLocalStorage()) {
        console.log(
          "🔧 [CLIENTS DEBUG] Creating BlobServiceClient for Azurite (local)",
        );
        this._blobServiceClient = BlobServiceClient.fromConnectionString(
          AZURITE_CONNECTION_STRING,
        );
      } else {
        if (!this.config.storage.accountName) {
          throw new Error(
            "❌ Azure Storage Account Name not configured. Please set AZURE_STORAGE_ACCOUNT_NAME in Function App settings.",
          );
        }
        console.log(
          "🔧 [CLIENTS DEBUG] Creating BlobServiceClient with AAD authentication",
        );
        const credential = this.getCredential();
        this._blobServiceClient = new BlobServiceClient(
          `https://${this.config.storage.accountName}.blob.core.windows.net`,
          credential,
        );
      }
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
        new AzureKeyCredential(this.config.search.apiKey),
      );
    }
    return this._searchClient;
  }

  public getConfig(): AzureConfig {
    return this.config;
  }
}
