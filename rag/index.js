/**
 * Project ABYX — Phase 7: RAG & Knowledge Base Subsystem Facade
 */

const KnowledgeService = require('./knowledge_service');
const DocumentParser = require('./document_parser');
const Chunker = require('./chunker');
const { EmbeddingsEngine, VECTOR_DIMENSION } = require('./embeddings');
const types = require('./types');

module.exports = {
  KnowledgeService,
  DocumentParser,
  Chunker,
  EmbeddingsEngine,
  VECTOR_DIMENSION,
  ...types
};
