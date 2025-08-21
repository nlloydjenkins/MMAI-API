# Document Processing Queue System

This system provides a scalable, queue-based document processing pipeline that converts various document formats into chunked, searchable content for AI indexing.

## Architecture Overview

The system follows a queue-based architecture with the following components:

```
📁 Upload → 📋 Queue → 🔄 Process → 📋 Queue → ✂️ Chunk → 📋 Queue → 🔍 Index
```

### Components

1. **Document Upload** - HTTP endpoint for file uploads
2. **Document Processor** - Converts documents to markdown
3. **Document Chunker** - Splits markdown into searchable chunks
4. **Document Indexer** - Prepares content for AI search
5. **Job Management** - Tracks processing status
6. **Queue Management** - Administrative controls

## Supported File Types

- **Word Documents** (.docx) - Uses `mammoth` for conversion
- **Excel Spreadsheets** (.xlsx, .xls) - Uses `xlsx` library
- **PDF Documents** (.pdf) - Uses `pdf-parse` library
- **Text Files** (.txt) - Direct processing
- **Markdown Files** (.md) - Direct processing
- **PowerPoint** (.pptx) - _Placeholder (to be implemented)_

## API Endpoints

### Document Upload

```http
POST /api/documents/upload
Content-Type: multipart/form-data

FormData:
- file: [document file]
- userId: string
- projectId: string (optional)
```

### Job Management

```http
GET /api/jobs/status/{jobId}          # Get job status
GET /api/jobs/list                    # List user jobs
DELETE /api/jobs/{jobId}              # Delete job
GET /api/jobs/stats                   # Get job statistics
```

### Admin/Queue Management

```http
GET /api/admin/queues/status          # Get queue lengths
POST /api/admin/queues/clear?queue=processing  # Clear specific queue
GET /api/admin/system/stats           # System statistics
POST /api/admin/jobs/cleanup?days=30  # Cleanup old jobs
```

## Queue Structure

### 1. Document Processing Queue

- **Name**: `document-processing`
- **Purpose**: Initial document conversion
- **Message**: `ProcessingJobMessage`
- **Trigger**: Queue trigger function

### 2. Document Chunking Queue

- **Name**: `document-chunking`
- **Purpose**: Split markdown into chunks
- **Message**: `ChunkingJobMessage`
- **Trigger**: Queue trigger function

### 3. Document Indexing Queue

- **Name**: `document-indexing`
- **Purpose**: Final indexing preparation
- **Message**: `IndexingJobMessage`
- **Trigger**: Queue trigger function

## Data Flow

### 1. Upload Phase

```typescript
POST /api/documents/upload
├── Parse multipart form data
├── Validate file type and size
├── Upload to blob storage (container: 'blobmmai')
├── Create job record in table storage
└── Send message to processing queue
```

### 2. Processing Phase

```typescript
ProcessingQueue Trigger
├── Download file from blob storage
├── Convert to markdown based on file type
├── Add YAML front matter with metadata
├── Upload markdown to blob storage
├── Update job status to 'chunking'
└── Send message to chunking queue
```

### 3. Chunking Phase

```typescript
ChunkingQueue Trigger
├── Download markdown from blob storage
├── Split into intelligent chunks (configurable size)
├── Convert chunks to JSONL format
├── Upload chunks to blob storage
├── Update job status to 'indexing'
└── Send message to indexing queue
```

### 4. Indexing Phase

```typescript
IndexingQueue Trigger
├── Download chunks from blob storage
├── Upload to indexing container for AI search
├── Update job status to 'completed'
└── Job processing complete
```

## Job States

- **`queued`** - Job created, waiting for processing
- **`processing`** - Document being converted to markdown
- **`chunking`** - Markdown being split into chunks
- **`indexing`** - Chunks being prepared for search
- **`completed`** - All processing finished successfully
- **`failed`** - Error occurred during processing

## Configuration

### Environment Variables

```bash
# Azure Storage
AzureWebJobsStorage=DefaultEndpointsProtocol=https;AccountName=...

# Queue Names (optional - defaults provided)
PROCESSING_QUEUE_NAME=document-processing
CHUNKING_QUEUE_NAME=document-chunking
INDEXING_QUEUE_NAME=document-indexing

# Chunking Settings
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
```

### Blob Storage Containers

- **`blobmmai`** - Main storage for documents and processed content
- **`indexing`** - Final chunks ready for AI search

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start Azure Functions locally
func start
```

### Testing

```bash
# Run queue system test
node scripts/test-queue-system.js
```

### Deployment

```bash
# Deploy to Azure
func azure functionapp publish <app-name>
```

## Monitoring

### Queue Monitoring

Check queue lengths and system health:

```http
GET /api/admin/system/stats
```

### Job Monitoring

Track individual job progress:

```http
GET /api/jobs/status/{jobId}
```

### Error Handling

- All functions include comprehensive error handling
- Failed jobs are marked with error details
- Queue messages are automatically retried
- Dead letter queues capture persistent failures

## File Processing Details

### Word Documents (.docx)

- Converts to clean markdown preserving structure
- Extracts text, headings, lists, and basic formatting
- Handles tables and embedded content
- Preserves document metadata

### Excel Spreadsheets (.xlsx, .xls)

- Processes all worksheets
- Converts each sheet to markdown tables
- Includes sheet names as headings
- Handles formulas and formatting

### PDF Documents (.pdf)

- Extracts text content using pdf-parse
- Maintains paragraph structure
- Includes page breaks and section divisions
- Handles multi-column layouts

### Text/Markdown Files

- Direct processing with metadata injection
- Preserves existing formatting
- Adds standardized front matter
- Validates markdown syntax

## Scaling Considerations

- **Horizontal Scaling**: Azure Functions auto-scale based on queue length
- **Batch Processing**: Functions can handle multiple messages
- **Resource Management**: Configurable memory and timeout settings
- **Cost Optimization**: Pay-per-execution model

## Security

- **Authentication**: Function-level auth keys
- **File Validation**: MIME type and size checks
- **Access Control**: User-based job isolation
- **Data Protection**: Encrypted blob storage

## Troubleshooting

### Common Issues

1. **Queue Messages Not Processing**

   - Check function app is running
   - Verify queue names match configuration
   - Check storage account connectivity

2. **File Upload Failures**

   - Verify blob storage permissions
   - Check file size limits
   - Validate MIME types

3. **Document Conversion Errors**
   - Check file format compatibility
   - Verify document is not corrupted
   - Review error logs in job status

### Logs and Diagnostics

- Function execution logs in Azure portal
- Job status tracking in table storage
- Queue message visibility timeout handling

## Version History

- **v0.4.0** - Initial queue-based processing system
- **v0.4.1** - Added comprehensive error handling and monitoring

## Future Enhancements

- [ ] PowerPoint (.pptx) support
- [ ] Image text extraction (OCR)
- [ ] Video/audio transcription
- [ ] Real-time progress updates via SignalR
- [ ] Batch upload processing
- [ ] Advanced chunk optimization
- [ ] Machine learning-based content categorization
