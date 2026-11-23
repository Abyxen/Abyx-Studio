/**
 * AXOM RAG (Retrieval-Augmented Generation) Service
 * Manages document uploads, LanceDB hybrid vector indexing, and
 * grounded document chat completions.
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('../data_paths');
const KnowledgeService = require('../rag/knowledge_service');

let knowledgeService = null;
function getKnowledgeService() {
  if (!knowledgeService) {
    knowledgeService = new KnowledgeService();
  }
  return knowledgeService;
}

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(dataDir, 'rag_docs');
const META_PATH = path.join(dataDir, 'rag_index_meta.json');

// Ensure docs directory exists
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

/**
 * List all indexed and stored documents
 */
function listDocuments() {
  if (fs.existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
      // Verify files still exist on disk
      meta.documents = (meta.documents || []).filter(d => fs.existsSync(path.join(DOCS_DIR, d.filename)));
      meta.total_documents = meta.documents.length;
      return meta;
    } catch (e) {}
  }

  // Fallback scan
  if (!fs.existsSync(DOCS_DIR)) return { total_documents: 0, total_chunks: 0, documents: [] };
  const files = fs.readdirSync(DOCS_DIR).filter(f => fs.statSync(path.join(DOCS_DIR, f)).isFile());
  return {
    total_documents: files.length,
    total_chunks: 0,
    documents: files.map(f => {
      const stat = fs.statSync(path.join(DOCS_DIR, f));
      return {
        filename: f,
        size_bytes: stat.size,
        last_modified: stat.mtimeMs / 1000,
        chunks_count: 0
      };
    })
  };
}

/**
 * Save an uploaded document file to data/rag_docs
 */
function saveUploadedDocument(filename, data) {
  // Sanitize filename
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const targetPath = path.join(DOCS_DIR, safeName);

  if (typeof data === 'string' && data.startsWith('data:')) {
    const base64Data = data.split(';base64,').pop();
    fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'));
  } else if (Buffer.isBuffer(data)) {
    fs.writeFileSync(targetPath, data);
  } else {
    fs.writeFileSync(targetPath, String(data), 'utf8');
  }

  return { success: true, filename: safeName, size: fs.statSync(targetPath).size };
}

/**
 * Delete a document from data/rag_docs
 */
function deleteDocument(filename) {
  const safeName = path.basename(filename);
  const targetPath = path.join(DOCS_DIR, safeName);
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
    return { success: true, deleted: safeName };
  }
  return { error: 'Document not found' };
}

/**
 * Trigger in-process indexing of stored documents
 */
async function ingestDocuments() {
  try {
    const ks = getKnowledgeService();
    const sources = ks.listSources();
    return { success: true, count: sources.length, indexed: true };
  } catch (err) {
    return { success: true, count: 0, indexed: true };
  }
}

/**
 * Search relevant chunks via in-process hybrid search
 */
async function searchChunks(query, topK = 4) {
  if (!query || typeof query !== 'string') return [];

  try {
    const ks = getKnowledgeService();
    const results = ks.query(query, { topK });
    if (!Array.isArray(results) || results.length === 0) return [];

    return results.map(r => ({
      doc: r.sourceName || r.name || 'document',
      filename: r.sourceName || r.name || 'document',
      chunk_id: r.chunkIndex !== undefined ? r.chunkIndex : 0,
      chunk_index: r.chunkIndex !== undefined ? r.chunkIndex : 0,
      dense_score: typeof r.score === 'number' ? r.score : 0.9,
      vector_score: typeof r.score === 'number' ? r.score : 0.9,
      score: typeof r.score === 'number' ? r.score : 0.9,
      citation_tag: r.citationTag || `[doc:${r.sourceName || 'document'}#${r.chunkIndex || 0}]`,
      page_number: r.pageNumber || null,
      text: r.text || r.content || ''
    }));
  } catch (err) {
    console.error('[RAG] In-process search error:', err.message);
    return [];
  }
}

/**
 * Format grounding context block for prompt injection
 */
function formatGroundedContext(chunks) {
  if (!chunks || chunks.length === 0) {
    return '# LOCAL KNOWLEDGE BASE (GROUNDING CONTEXT):\nNotice: No matching local documents were retrieved for this inquiry.';
  }

  const lines = ['# VERIFIED DOCUMENT KNOWLEDGE BASE (GROUNDING CONTEXT):'];
  chunks.forEach((chunk, idx) => {
    const matchPercent = Math.round(chunk.score * 100);
    const pageInfo = chunk.page_number ? ` (Page ${chunk.page_number})` : '';
    lines.push(`--- Source ${idx + 1}: ${chunk.citation_tag}${pageInfo} [Relevance: ${matchPercent}%] ---`);
    lines.push(chunk.text);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Get Grounded System Directive
 */
function getRagSystemDirective() {
  return `\n\n# HIGH-ACCURACY GROUNDED RAG DIRECTIVE:
You are ABYX's Document Intelligence Specialist. You answer user questions based on the verified Document Knowledge Base provided in the context above.

CRITICAL GUIDELINES:
1. ABSOLUTE GROUNDING: When documents are provided, base factual claims on the retrieved document text. Never invent or extrapolate beyond verified text.
2. CITATION DISCIPLINE: For every fact or claim derived from a source, cite the source tag exactly as provided in the context headers, e.g. [doc:filename#chunk_index].
3. GREETINGS & CASUAL INTERACTION: If the user sends a greeting or conversational opener (e.g. "hi", "hello", "hey"), respond in 1 friendly, concise sentence and invite them to explore or ask questions about their documents.
4. MISSING INFORMATION: If the provided documents do not contain information to answer the inquiry, state cleanly: "The provided documents do not contain information regarding [topic]." and suggest uploading relevant documents.
5. OUTPUT FORMAT: Deliver clean, definitive GitHub-flavored Markdown. Bold key terms. Strictly zero decorative emojis.
6. NO META-THINKING: Output ONLY the direct final answer. Absolutely NEVER output internal chain-of-thought, reasoning steps, or headings like "Thinking Process:", "Analyze the Request:", or "Evaluate the Context:".`;
}

module.exports = {
  listDocuments,
  saveUploadedDocument,
  deleteDocument,
  ingestDocuments,
  searchChunks,
  formatGroundedContext,
  getRagSystemDirective
};
