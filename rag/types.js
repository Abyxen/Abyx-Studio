/**
 * Project ABYX — Phase 7: Knowledge Bases & Local RAG Types and Contracts
 */

const SUPPORTED_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.pdf',
  '.docx',
  '.json',
  '.csv',
  '.html',
  '.htm'
];

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const DEFAULT_CHUNK_SIZE = 800; // Average chunk character target
const DEFAULT_CHUNK_OVERLAP = 150; // Overlap characters to preserve context
const DEFAULT_TOP_K = 5;

const SOURCE_STATUS = {
  PENDING: 'pending',
  INDEXING: 'indexing',
  INDEXED: 'indexed',
  FAILED: 'failed',
  DELETED: 'deleted'
};

class DocumentParsingError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'DocumentParsingError';
    this.originalError = originalError;
  }
}

class UnsupportedFormatError extends Error {
  constructor(ext) {
    super(`Unsupported document format: "${ext}". Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    this.name = 'UnsupportedFormatError';
    this.extension = ext;
  }
}

class FileSizeLimitError extends Error {
  constructor(sizeBytes, maxBytes = MAX_FILE_SIZE_BYTES) {
    super(`File size (${(sizeBytes / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed limit of ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
    this.name = 'FileSizeLimitError';
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_TOP_K,
  SOURCE_STATUS,
  DocumentParsingError,
  UnsupportedFormatError,
  FileSizeLimitError
};
