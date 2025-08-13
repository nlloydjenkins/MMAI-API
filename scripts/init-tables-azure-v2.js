const { TableServiceClient } = require("@azure/data-tables");

async function initAzureTables() {
  try {
    console.log("🔧 Initializing Azure tables...");
    
    // Use Azure Blob Storage connection string for tables as well
    const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
    
    if (!connectionString) {
      throw new Error("AZURE_BLOB_CONNECTION_STRING environment variable is required for Azure tables");
    }
    
    console.log("🔗 Using Azure connection string for tables...");
    const tableService = TableServiceClient.fromConnectionString(connectionString);
    
    const tables = ["projects", "files"];
    
    for (const tableName of tables) {
      try {
        await tableService.createTable(tableName);
        console.log(`✅ Table '${tableName}' created successfully`);
      } catch (error) {
        if (error.statusCode === 409) {
          console.log(`✅ Table '${tableName}' already exists`);
        } else {
          console.error(`❌ Error creating table '${tableName}':`, error.message);
        }
      }
    }
    
    console.log("🎉 Azure tables initialization completed!");
  } catch (error) {
    console.error("❌ Failed to initialize Azure tables:", error.message);
    process.exit(1);
  }
}

initAzureTables();
