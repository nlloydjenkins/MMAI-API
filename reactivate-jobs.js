/**
 * Manual script to requeue stuck jobs
 * This script will find jobs stuck in "processing" status and requeue them
 */

const reactivateStuckJobs = async () => {
  try {
    console.log("Checking for stuck jobs...");

    // Get job stats
    const statsResponse = await fetch("http://localhost:7071/api/jobs/stats");
    const stats = await statsResponse.json();

    console.log("Job Stats:", stats);

    if (stats.processing > 0) {
      console.log(`Found ${stats.processing} stuck processing jobs`);

      // Trigger cleanup to requeue stuck jobs
      const cleanupResponse = await fetch(
        "http://localhost:7071/api/jobs/cleanup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (cleanupResponse.ok) {
        const result = await cleanupResponse.text();
        console.log("Cleanup response:", result);
      } else {
        console.error(
          "Cleanup failed:",
          cleanupResponse.status,
          cleanupResponse.statusText
        );
      }
    } else {
      console.log("No stuck jobs found");
    }
  } catch (error) {
    console.error("Error reactivating stuck jobs:", error);
  }
};

// Run the script
reactivateStuckJobs();
