export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  partitionKey: string;
  rowKey: string;
  customerId?: string; // Add customer relationship
  deadline?: Date; // Add deadline field
}

export interface ProjectEntity {
  partitionKey: string;
  rowKey: string;
  name: string;
  createdAt: string;
  goals?: string; // Store goal content directly in project
  customerId?: string; // Add customer relationship
  deadline?: string; // Add deadline field as ISO string
  createdBy?: string; // User who created the project
  createdByUserId?: string; // User ID who created the project
  timestamp?: Date;
  etag?: string;
}

export interface Customer {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  link?: string;
  partitionKey: string;
  rowKey: string;
  createdAt: Date;
}

export interface CustomerEntity {
  partitionKey: string;
  rowKey: string;
  name: string;
  contactName?: string;
  email?: string;
  link?: string;
  createdAt: string;
  timestamp?: Date;
  etag?: string;
}

export interface CreateCustomerRequest {
  name: string;
  contactName?: string;
  email?: string;
  link?: string;
}

export interface UpdateCustomerRequest {
  name?: string;
  contactName?: string;
  email?: string;
  link?: string;
}

export interface CreateCustomerResponse {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  link?: string;
  createdAt: string;
}

export interface ListCustomersResponse {
  customers: CreateCustomerResponse[];
}

export interface CreateProjectRequest {
  name: string;
  customerId?: string;
  deadline?: string; // ISO date string
}

export interface UpdateProjectRequest {
  goals?: string;
  customerId?: string;
  deadline?: string; // ISO date string
}

export interface CreateProjectResponse {
  id: string;
  name: string;
  createdAt: string;
  goals?: string;
  customerId?: string;
  deadline?: string; // ISO date string
}

export interface ListProjectsResponse {
  projects: CreateProjectResponse[];
}

export interface GetProjectResponse {
  id: string;
  name: string;
  createdAt: string;
  goals?: string;
  customerId?: string;
  deadline?: string; // ISO date string
}

export interface ApiError {
  error: string;
  message: string;
}

export interface FileUploadRequest {
  projectId: string;
  file: Buffer;
  fileName: string;
  contentType: string;
}

export interface FileUploadResponse {
  id: string;
  url: string;
  fileName: string;
  originalName: string;
  projectId: string;
  fileType: "goal" | "transcript" | "email" | "file" | "link";
  uploadedAt: string;
  size: number;
  content?: string; // Optional content for goals and links
}

export interface FileMetadata {
  id: string;
  projectId: string;
  fileName: string;
  originalName: string;
  fileType: "goal" | "transcript" | "email" | "file" | "link";
  uploadedAt: string;
  size: number;
  url: string;
  content?: string; // Store content for text files
  partitionKey: string;
  rowKey: string;
}

export interface ListFilesResponse {
  files: FileUploadResponse[];
}

export interface UploadTextRequest {
  content: string;
  fileType: "goal" | "transcript" | "email" | "link";
  title?: string;
}

export interface SearchRequest {
  query: string;
  top?: number;
}

export interface SearchResponse {
  results: any[];
  count: number;
}

export interface PromptRequest {
  question: string;
  searchResults: any[];
  projectId?: string;
  systemPrompt?: string;
  // Generation controls from frontend global settings
  temperature?: number; // 0..1
  topP?: number; // 0..1 (aka top_p)
}

export interface PromptResponse {
  response: string;
  tokensUsed: number;
}
