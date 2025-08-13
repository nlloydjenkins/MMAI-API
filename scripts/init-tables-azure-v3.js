const { TableServiceClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");
const fs = require("fs");
const path = require("path");

async function initAzureTables() {
  try {
    console.log("🔧 Initializing Azure tables with Azure Identity...");
    
    // Extract account name from Azure connection string
    let accountName = "storagemmai"; // Default account name
    
    // Try to read from local.settings.json to get connection string and extract account name
    try {
      const settingsPath = path.join(__dirname, "..", "local.settings.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const connectionString = settings.Values.AZURE_BLOB_CONNECTION_STRING;
      
      if (connectionString) {
        const accountMatch = connectionString.match(/AccountName=([^;]+)/);
        if (accountMatch) {
          accountName = accountMatch[1];
          console.log(`📋 Using account name: ${accountName}`);
        }
      }
    } catch (error) {
      console.log("⚠️ Could not read local.settings.json, using default account name");
    }
    
    console.log("🔗 Using Azure Identity for authentication...");
    const credential = new DefaultAzureCredential();
    const tableServiceUrl = `https://${accountName}.table.core.windows.net`;
    const tableService = new TableServiceClient(tableServiceUrl, credential);
    
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
