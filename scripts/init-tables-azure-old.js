const { TableServiceClient } = require("@azure/data-tables");
const fs = require("fs");
const path = require("path");

async function initAzureTables() {
  try {
    console.log("🔧 Initializing Azure tables...");
    
    let connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
    
    // If not in environment, try to read from local.settings.json
    if (!connectionString) {
      try {
        const settingsPath = path.join(__dirname, "..", "local.settings.json");
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        connectionString = settings.Values.AZURE_BLOB_CONNECTION_STRING;
        console.log("📋 Reading Azure connection string from local.settings.json");
      } catch (error) {
        console.error("❌ Could not read local.settings.json:", error.message);
      }
    }
    
    if (!connectionString) {
      throw new Error("AZURE_BLOB_CONNECTION_STRING not found in environment or local.settings.json");
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
