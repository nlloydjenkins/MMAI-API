# IdeaForge API

Azure Functions backend for the IdeaForge application.

## Overview

This API provides secure server-side access to Azure services including:

- Azure Table Storage (project metadata)
- Azure Blob Storage (file uploads)
- Azure AI Search (document search)
- Azure OpenAI (AI-powered responses)

## Architecture

The API is built using Azure Functions with TypeScript and follows these principles:

- Each function is modular and independently deployable
- Shared configuration and utilities are centralized
- All sensitive credentials are stored as environment variables
- CORS is properly configured for frontend access

## Project Structure

```
api/
├── src/
│   ├── shared/
│   │   ├── azure-config.ts     # Azure client configuration
│   │   ├── types.ts           # TypeScript interfaces
│   │   └── utils.ts           # Common utilities
│   └── functions/
│       ├── createProject/     # POST /api/projects
│       ├── listProjects/      # GET /api/projects
│       ├── getProject/        # GET /api/projects/{id}
│       ├── uploadFile/        # POST /api/projects/{id}/files
│       ├── listFiles/         # GET /api/projects/{id}/files
│       ├── runSearch/         # POST /api/search
│       └── runPrompt/         # POST /api/prompt
├── host.json
├── package.json
├── tsconfig.json
└── local.settings.json
```

## API Endpoints

### Project Management

#### POST /api/projects

Create a new project.

- **Body**: `{ "name": "Project Name" }`
- **Response**: `{ "id": "uuid", "name": "Project Name", "createdAt": "ISO date" }`

#### GET /api/projects

List all projects.

- **Response**: `{ "projects": [{ "id": "uuid", "name": "Project Name", "createdAt": "ISO date" }] }`

#### GET /api/projects/{id}

Get a specific project.

- **Response**: `{ "id": "uuid", "name": "Project Name", "createdAt": "ISO date" }`

### File Management (TODO)

#### POST /api/projects/{projectId}/files

Upload a file to the project.

- **Content-Type**: `multipart/form-data`
- **Response**: File metadata with blob URL

#### GET /api/projects/{projectId}/files

List files for a project.

- **Response**: Array of file metadata

### Search & AI (TODO)

#### POST /api/search

Search documents using Azure AI Search.

- **Body**: `{ "query": "search terms", "top": 10 }`
- **Response**: Search results with relevance scores

#### POST /api/prompt

Generate AI response using Azure OpenAI.

- **Body**: `{ "question": "user question", "searchResults": [...], "projectId": "uuid" }`
- **Response**: AI-generated response with token usage

## Environment Variables

Required environment variables for deployment:

```
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net
AZURE_SEARCH_API_KEY=your_search_api_key
AZURE_SEARCH_INDEX_NAME=ideaforge-index
AZURE_OPENAI_ENDPOINT=https://your-openai-service.openai.azure.com/
AZURE_OPENAI_API_KEY=your_openai_api_key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-11-20
```

## Local Development

1. Copy `local.settings.json.example` to `local.settings.json`
2. Fill in your Azure credentials
3. Install dependencies: `npm install`
4. Build the project: `npm run build`
5. Start the Functions runtime: `npm start`

## Deployment

This API is designed to be deployed as an Azure Functions app. Use the Azure Functions Core Tools or Azure DevOps for deployment.

## Security

- All functions use anonymous auth level for simplicity
- CORS is configured to allow frontend access
- Sensitive credentials are never exposed to the client
- Input validation is performed on all endpoints
- Error messages don't leak sensitive information

## Status

**Implemented:**

- ✅ Project creation (createProject)
- ✅ Project listing (listProjects)
- ✅ Project retrieval (getProject)

**TODO:**

- ⏳ File upload (uploadFile)
- ⏳ File listing (listFiles)
- ⏳ Document search (runSearch)
- ⏳ AI prompting (runPrompt)
# Trigger workflow
