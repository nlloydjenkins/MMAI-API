export interface ProcessingJob {
  partitionKey: string; // "job"
  rowKey: string; // jobId (UUID)
  userId: string; // User identifier
  projectId: string; // Project ID
  inputType: "file" | "url" | "folder";
  inputSource: string; // File name or URL
  fileName?: string; // Original file name
  fileSize?: number; // File size in bytes
  mimeType?: string; // MIME type
  status:
    | "queued"
    | "processing"
    | "chunking"
    | "indexing"
    | "completed"
    | "failed";
  progress: number; // 0-100
  createdAt: Date;
  updatedAt: Date;
  errorMessage?: string;
  results?: {
    markdownFiles: string[];
    chunkFiles: string[];
    indexedDocuments: number;
    processingTimeMs: number;
    pagesCrawled?: number;
  };
}

export interface ProcessingJobMessage {
  jobId: string;
  userId: string;
  projectId: string;
  inputType: "file" | "url" | "folder";
  inputSource: string; // Blob name or URL
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}

export interface ChunkingJobMessage {
  jobId: string;
  markdownFiles: string[]; // Blob names of markdown files
  projectId: string;
}

export interface IndexingJobMessage {
  jobId: string;
  chunkFiles: string[]; // Blob names of JSONL chunk files
  projectId: string;
}

export type DocumentStatus =
  | "queued"
  | "processing"
  | "chunking"
  | "indexing"
  | "completed"
  | "failed";

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source_file: string;
    document_type: string;
    chunk_index: number;
    word_count: number;
    project_id: string;
    crawl_time: string;
    title?: string;
    created?: string;
    modified?: string;
  };
}
