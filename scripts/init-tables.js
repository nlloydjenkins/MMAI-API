const { TableServiceClient } = require("@azure/data-tables");

// Connection string for Azurite local development
const connectionString =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

async function initializeTables() {
  try {

    const tableService = TableServiceClient.fromConnectionString(
      connectionString,
      {
        allowInsecureConnection: true,
      }
    );

    // Create the projects table
    const projectsTableName = "projects";
    
    await tableService.createTable(projectsTableName);

    // Create the files table
    const filesTableName = "files";
    
    await tableService.createTable(filesTableName);

  } catch (error) {
    if (error.statusCode === 409) {
      
    } else {
      
      process.exit(1);
    }
  }
}

initializeTables();
