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
      console.log(
        "⚠️ Could not read local.settings.json, using default account name"
      );
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
        } else if (
          error.message &&
          error.message.includes("AuthorizationFailure")
        ) {
          console.log(
            `⚠️ Table '${tableName}' creation skipped (insufficient permissions, table may already exist)`
          );
        } else {
          console.log(
            `⚠️ Table '${tableName}' creation failed:`,
            error.message || error
          );
        }
      }
    }

    console.log("� Azure table initialization completed successfully!");
  } catch (error) {
    console.error(
      "❌ Azure table initialization failed:",
      error.message || error
    );
    // Don't exit with error - this is for development convenience
    console.log(
      "⚠️ Tables may already exist or permissions may be limited. Continuing..."
    );
  }
}

module.exports = initAzureTables;

// Run if called directly
if (require.main === module) {
  initAzureTables().catch(console.error);
}
