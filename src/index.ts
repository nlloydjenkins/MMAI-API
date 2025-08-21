// Main entry point for Azure Functions
// This file imports all the function definitions

// Import all function modules to register them with the Azure functions runtime
import "./functions/health";
import "./functions/debug-env";
import "./functions/projects";
import "./functions/getProject";
import "./functions/projectSettings";
import "./functions/runPrompt";
import "./functions/runSearch";
import "./functions/reindexSearch";
import "./functions/exportProject";
import "./functions/files";
import "./functions/customers";
import "./functions/fetchUrlTitle";
// Additional functions to ensure all handlers are registered
import "./functions/debugSearch";
import "./functions/checkProjectIds";
import "./functions/get-roles";
import "./functions/testProjectSearch";
import "./functions/updateProjectIds";
// Document processing functions
import "./functions/document-upload";
import "./functions/document-processor";
import "./functions/document-chunker";
import "./functions/document-indexer";
import "./functions/job-management";
import "./functions/queue-management";
import "./functions/url-processor";
import "./functions/blob-storage";

// Export a dummy function to ensure this module is processed
export const initializeFunctions = () => {
  console.log("Azure Functions initialized");
};
