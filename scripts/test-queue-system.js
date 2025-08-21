import { DocumentQueueClient } from '../src/shared/queue-client.js';
import { JobManager } from '../src/shared/job-manager.js';
import { v4 as uuidv4 } from 'uuid';

async function testQueueSystem() {
  console.log('🧪 Testing Document Processing Queue System');
  
  try {
    // Initialize clients
    const queueClient = new DocumentQueueClient();
    const jobManager = new JobManager();
    
    await queueClient.initializeQueues();
    console.log('✅ Queue client initialized');

    // Create a test job
    const jobId = uuidv4();
    const testJob = await jobManager.createJob({
      userId: 'test-user',
      projectId: 'test-project',
      inputType: 'file',
      inputSource: 'test-document.pdf',
      fileName: 'test-document.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf'
    });
    
    console.log('✅ Test job created:', testJob.id);

    // Test processing queue
    await queueClient.sendProcessingJob({
      jobId: testJob.id,
      blobName: 'test-document.pdf',
      containerName: 'blobmmai',
      inputType: 'file',
      fileName: 'test-document.pdf',
      mimeType: 'application/pdf'
    });
    
    console.log('✅ Message sent to processing queue');

    // Check queue lengths
    const processingLength = await queueClient.getQueueLength('processing');
    const chunkingLength = await queueClient.getQueueLength('chunking');
    const indexingLength = await queueClient.getQueueLength('indexing');
    
    console.log('📊 Queue Status:');
    console.log(`   Processing: ${processingLength} messages`);
    console.log(`   Chunking: ${chunkingLength} messages`);
    console.log(`   Indexing: ${indexingLength} messages`);

    // Get job stats
    const stats = await jobManager.getJobStats();
    console.log('📈 Job Statistics:');
    console.log(`   Total: ${stats.total}`);
    console.log(`   Queued: ${stats.queued}`);
    console.log(`   Processing: ${stats.processing}`);
    console.log(`   Completed: ${stats.completed}`);
    console.log(`   Failed: ${stats.failed}`);

    // Clean up test message
    await queueClient.clearQueue('processing');
    await jobManager.deleteJob(testJob.id);
    
    console.log('✅ Test cleanup completed');
    console.log('🎉 Queue system test passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  testQueueSystem();
}

export { testQueueSystem };
