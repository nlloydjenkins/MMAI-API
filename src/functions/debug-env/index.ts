import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

export async function debugEnv(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    try {
        // Get all environment variables that might be relevant
        const envVars = {
            // Azure Static Web Apps specific
            AZURE_STATIC_WEB_APPS_API_TOKEN: !!process.env.AZURE_STATIC_WEB_APPS_API_TOKEN,
            AZURE_CLIENT_ID: !!process.env.AZURE_CLIENT_ID,
            AZURE_CLIENT_SECRET: !!process.env.AZURE_CLIENT_SECRET,
            AZURE_TENANT_ID: !!process.env.AZURE_TENANT_ID,
            WEBSITE_SITE_NAME: process.env.WEBSITE_SITE_NAME,
            
            // Storage related
            //AzureWebJobsStorage: !!process.env.AzureWebJobsStorage,
            AZURE_STORAGE_CONNECTION_STRING: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
            AZURE_BLOB_CONNECTION_STRING: !!process.env.AZURE_BLOB_CONNECTION_STRING,
            AZURE_STORAGE_ACCOUNT_NAME: process.env.AZURE_STORAGE_ACCOUNT_NAME,
            
            // Search and OpenAI
            AZURE_SEARCH_ENDPOINT: process.env.AZURE_SEARCH_ENDPOINT,
            AZURE_SEARCH_API_KEY: !!process.env.AZURE_SEARCH_API_KEY,
            AZURE_SEARCH_INDEX_NAME: process.env.AZURE_SEARCH_INDEX_NAME,
            AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
            AZURE_OPENAI_API_KEY: !!process.env.AZURE_OPENAI_API_KEY,
            AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
            AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
            
            // Function runtime
            FUNCTIONS_WORKER_RUNTIME: process.env.FUNCTIONS_WORKER_RUNTIME,
            FUNCTIONS_EXTENSION_VERSION: process.env.FUNCTIONS_EXTENSION_VERSION,
        };

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                timestamp: new Date().toISOString(),
                environment: envVars,
                // Show first 20 chars of any connection strings for debugging
                connectionStringPreviews: {
                    //AzureWebJobsStorage: process.env.AzureWebJobsStorage ? process.env.AzureWebJobsStorage.substring(0, 20) + '...' : null,
                    AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING ? process.env.AZURE_STORAGE_CONNECTION_STRING.substring(0, 20) + '...' : null,
                }
            }, null, 2),
        };
    } catch (error) {
        context.error('Error in debug-env function:', error);
        return {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}

app.http('debug-env', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: debugEnv,
});
