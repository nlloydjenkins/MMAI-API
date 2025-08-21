import { DocumentChunk } from '../types/document-processing.js';
import { v4 as uuidv4 } from 'uuid';

export interface ChunkingOptions {
  maxChunkSize: number;      // Maximum characters per chunk
  overlapSize: number;       // Characters to overlap between chunks
  respectParagraphs: boolean; // Try to break at paragraph boundaries
}

export class DocumentChunker {
  private static readonly DEFAULT_OPTIONS: ChunkingOptions = {
    maxChunkSize: 2000,
    overlapSize: 200,
    respectParagraphs: true
  };

  /**
   * Chunk markdown content into smaller pieces for indexing
   */
  static chunkMarkdown(
    markdown: string, 
    projectId: string,
    fileName: string,
    options: Partial<ChunkingOptions> = {}
  ): DocumentChunk[] {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Extract YAML front matter
    const { frontMatter, content } = this.extractFrontMatter(markdown);
    
    // Parse front matter for metadata
    const metadata = this.parseFrontMatter(frontMatter);
    
    // Split content into chunks
    const chunks = this.splitContent(content, opts);
    
    // Create document chunks with metadata
    return chunks.map((chunk, index) => ({
      id: uuidv4(),
      content: chunk.trim(),
      metadata: {
        source_file: fileName,
        document_type: metadata.document_type || 'unknown',
        chunk_index: index,
        word_count: chunk.split(/\s+/).filter((word: string) => word.length > 0).length,
        project_id: projectId,
        crawl_time: metadata.crawl_time || new Date().toISOString(),
        title: metadata.title,
        created: metadata.created,
        modified: metadata.modified
      }
    }));
  }

  /**
   * Extract YAML front matter from markdown
   */
  private static extractFrontMatter(markdown: string): { frontMatter: string; content: string } {
    const yamlRegex = /^---\s*\n(.*?)\n---\s*\n(.*)/s;
    const match = markdown.match(yamlRegex);
    
    if (match) {
      return {
        frontMatter: match[1],
        content: match[2]
      };
    }
    
    return {
      frontMatter: '',
      content: markdown
    };
  }

  /**
   * Parse YAML front matter into metadata object
   */
  private static parseFrontMatter(frontMatter: string): Record<string, any> {
    const metadata: Record<string, any> = {};
    
    if (!frontMatter) return metadata;
    
    const lines = frontMatter.split('\n');
    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remove quotes if present
        if ((value.startsWith("'") && value.endsWith("'")) || 
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        
        // Try to parse numbers
        if (/^\d+$/.test(value)) {
          metadata[key] = parseInt(value);
        } else {
          metadata[key] = value;
        }
      }
    }
    
    return metadata;
  }

  /**
   * Split content into chunks respecting options
   */
  private static splitContent(content: string, options: ChunkingOptions): string[] {
    if (content.length <= options.maxChunkSize) {
      return [content];
    }

    const chunks: string[] = [];
    let currentPosition = 0;

    while (currentPosition < content.length) {
      let chunkEnd = currentPosition + options.maxChunkSize;
      
      if (chunkEnd >= content.length) {
        // Last chunk
        chunks.push(content.slice(currentPosition));
        break;
      }

      if (options.respectParagraphs) {
        // Try to find a paragraph break near the chunk boundary
        const searchStart = Math.max(currentPosition + options.maxChunkSize - 200, currentPosition);
        const searchEnd = Math.min(chunkEnd + 200, content.length);
        const section = content.slice(searchStart, searchEnd);
        
        // Look for paragraph breaks (double newlines)
        const paragraphBreak = section.lastIndexOf('\n\n');
        if (paragraphBreak !== -1) {
          chunkEnd = searchStart + paragraphBreak + 2;
        } else {
          // Look for single newlines
          const lineBreak = section.lastIndexOf('\n');
          if (lineBreak !== -1) {
            chunkEnd = searchStart + lineBreak + 1;
          } else {
            // Look for sentence endings
            const sentenceEnd = section.lastIndexOf('. ');
            if (sentenceEnd !== -1) {
              chunkEnd = searchStart + sentenceEnd + 2;
            }
          }
        }
      }

      chunks.push(content.slice(currentPosition, chunkEnd));
      
      // Move to next chunk with overlap
      currentPosition = chunkEnd - options.overlapSize;
      if (currentPosition < 0) currentPosition = 0;
    }

    return chunks.filter(chunk => chunk.trim().length > 0);
  }

  /**
   * Convert chunks to JSONL format
   */
  static chunksToJsonl(chunks: DocumentChunk[]): string {
    return chunks.map(chunk => JSON.stringify(chunk)).join('\n');
  }

  /**
   * Parse JSONL back to chunks
   */
  static jsonlToChunks(jsonl: string): DocumentChunk[] {
    return jsonl
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as DocumentChunk);
  }

  /**
   * Combine multiple markdown files into chunks
   */
  static chunkMultipleMarkdownFiles(
    markdownFiles: Array<{ fileName: string; content: string }>,
    projectId: string,
    options: Partial<ChunkingOptions> = {}
  ): DocumentChunk[] {
    const allChunks: DocumentChunk[] = [];
    
    for (const file of markdownFiles) {
      const chunks = this.chunkMarkdown(file.content, projectId, file.fileName, options);
      allChunks.push(...chunks);
    }
    
    return allChunks;
  }

  /**
   * Get chunking statistics
   */
  static getChunkingStats(chunks: DocumentChunk[]): {
    totalChunks: number;
    averageChunkSize: number;
    totalWords: number;
    averageWordsPerChunk: number;
    documentTypes: Record<string, number>;
  } {
    const totalWords = chunks.reduce((sum, chunk) => sum + chunk.metadata.word_count, 0);
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    
    const documentTypes: Record<string, number> = {};
    chunks.forEach(chunk => {
      const type = chunk.metadata.document_type;
      documentTypes[type] = (documentTypes[type] || 0) + 1;
    });

    return {
      totalChunks: chunks.length,
      averageChunkSize: chunks.length > 0 ? Math.round(totalChars / chunks.length) : 0,
      totalWords,
      averageWordsPerChunk: chunks.length > 0 ? Math.round(totalWords / chunks.length) : 0,
      documentTypes
    };
  }
}
