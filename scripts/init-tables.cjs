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
      },
    );

    const tables = ["projects", "files", "processingJobs"];
    for (const tableName of tables) {
      try {
        await tableService.createTable(tableName);
        console.log(`✅ Table '${tableName}' created`);
      } catch (err) {
        if (err.statusCode === 409) {
          console.log(`✅ Table '${tableName}' already exists`);
        } else {
          throw err;
        }
      }
    }
  } catch (error) {
    if (error.statusCode === 409) {
      // all tables already exist, that's fine
    } else {
      console.error("Error initializing tables:", error);
      process.exit(1);
    }
  }
}

initializeTables();
