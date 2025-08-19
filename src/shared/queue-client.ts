import { QueueServiceClient, QueueClient } from '@azure/storage-queue';
import { AzureClients } from './azure-config.js';
import { DefaultAzureCredential } from '@azure/identity';
import { ProcessingJobMessage, ChunkingJobMessage, IndexingJobMessage } from '../types/document-processing.js';

export class DocumentQueueClient {
  private queueServiceClient: QueueServiceClient;
  private processingQueue: QueueClient;
  private chunkingQueue: QueueClient;
  private indexingQueue: QueueClient;

  constructor() {
    const azureClients = AzureClients.getInstance();
    const config = azureClients.getConfig();
    
    if (!config.storage.accountName) {
      throw new Error('Azure Storage Account Name not configured');
    }
    
    const credential = new DefaultAzureCredential();
    this.queueServiceClient = new QueueServiceClient(
      `https://${config.storage.accountName}.queue.core.windows.net`,
      credential
    );

    this.processingQueue = this.queueServiceClient.getQueueClient('document-processing');
    this.chunkingQueue = this.queueServiceClient.getQueueClient('document-chunking');
    this.indexingQueue = this.queueServiceClient.getQueueClient('document-indexing');
  }

  async initializeQueues(): Promise<void> {
    try {
      await this.processingQueue.createIfNotExists();
      await this.chunkingQueue.createIfNotExists();
      await this.indexingQueue.createIfNotExists();
    } catch (error) {
      console.error('Failed to initialize queues:', error);
      throw error;
    }
  }

  async sendProcessingJob(jobMessage: ProcessingJobMessage): Promise<void> {
    const message = Buffer.from(JSON.stringify(jobMessage)).toString('base64');
    await this.processingQueue.sendMessage(message);
  }

  async sendChunkingJob(jobMessage: ChunkingJobMessage): Promise<void> {
    const message = Buffer.from(JSON.stringify(jobMessage)).toString('base64');
    await this.chunkingQueue.sendMessage(message);
  }

  async sendIndexingJob(jobMessage: IndexingJobMessage): Promise<void> {
    const message = Buffer.from(JSON.stringify(jobMessage)).toString('base64');
    await this.indexingQueue.sendMessage(message);
  }

  async getQueueLength(queueName: 'processing' | 'chunking' | 'indexing'): Promise<number> {
    try {
      let queue: QueueClient;
      switch (queueName) {
        case 'processing':
          queue = this.processingQueue;
          break;
        case 'chunking':
          queue = this.chunkingQueue;
          break;
        case 'indexing':
          queue = this.indexingQueue;
          break;
      }
      
      const properties = await queue.getProperties();
      return properties.approximateMessagesCount || 0;
    } catch (error) {
      console.error(`Failed to get queue length for ${queueName}:`, error);
      return 0;
    }
  }

  async clearQueue(queueName: 'processing' | 'chunking' | 'indexing'): Promise<void> {
    try {
      let queue: QueueClient;
      switch (queueName) {
        case 'processing':
          queue = this.processingQueue;
          break;
        case 'chunking':
          queue = this.chunkingQueue;
          break;
        case 'indexing':
          queue = this.indexingQueue;
          break;
      }
      
      await queue.clearMessages();
    } catch (error) {
      console.error(`Failed to clear queue ${queueName}:`, error);
      throw error;
    }
  }
}
