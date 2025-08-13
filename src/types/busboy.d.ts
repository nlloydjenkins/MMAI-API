declare module 'busboy' {
  import { Writable } from 'stream';

  interface BusboyConfig {
    headers: { [key: string]: string };
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
  }

  interface FileInfo {
    filename: string;
    encoding: string;
    mimeType: string;
  }

  class Busboy extends Writable {
    constructor(config: BusboyConfig);
    // Events
    on(event: 'file', listener: (fieldname: string, file: NodeJS.ReadableStream, info: FileInfo) => void): this;
    on(event: 'field', listener: (fieldname: string, value: string, info?: { nameTruncated?: boolean; valueTruncated?: boolean; encoding?: string; mimeType?: string }) => void): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'partsLimit' | 'filesLimit' | 'fieldsLimit', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;

    // Writable methods
    write(chunk: any, encoding?: BufferEncoding, cb?: (error?: Error | null) => void): boolean;
    end(chunk?: any, encoding?: BufferEncoding, cb?: () => void): void;
  }

  function busboy(config: BusboyConfig): Busboy;
  namespace busboy {
    export { busboy as default };
  }

  export = busboy;
}
