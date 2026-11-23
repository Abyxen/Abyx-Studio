/**
 * Project ABYX — Phase 7: Local & Deterministic Embeddings Engine
 * Zero-cloud, modular embedding generator supporting local Ollama models
 * with a deterministic subword Hashing Vectorizer fallback.
 */

const VECTOR_DIMENSION = 384;
const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
const OLLAMA_EMBED_MODEL = 'nomic-embed-text';

class EmbeddingsEngine {
  constructor(options = {}) {
    this.provider = options.provider || 'local'; // 'local' (deterministic) or 'ollama'
    this.ollamaUrl = options.ollamaUrl || OLLAMA_DEFAULT_URL;
    this.ollamaModel = options.ollamaModel || OLLAMA_EMBED_MODEL;
    this.dimension = options.dimension || VECTOR_DIMENSION;
  }

  /**
   * Generate an embedding vector for a piece of text
   * @param {string} text
   * @returns {Promise<number[]>} Normalized float array of length this.dimension
   */
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      return new Array(this.dimension).fill(0);
    }

    if (this.provider === 'ollama') {
      try {
        const ollamaVector = await this.fetchOllamaEmbedding(text);
        if (ollamaVector && ollamaVector.length > 0) {
          return this.normalizeVector(ollamaVector);
        }
      } catch (err) {
        // Fall back to deterministic local vectorizer silently
      }
    }

    // Default: Deterministic Subword Feature Hashing Vectorizer
    return this.deterministicLocalVector(text);
  }

  /**
   * Generate embeddings for a batch of text chunks
   */
  async embedChunks(chunks) {
    const results = [];
    for (const chunk of chunks) {
      const vec = await this.generateEmbedding(chunk.content);
      chunk.embedding = vec;
      results.push(chunk);
    }
    return results;
  }

  /**
   * Deterministic Subword & N-gram Hashing Vectorizer
   * Employs the signed feature hashing trick (Murmur-style) with sublinear term-frequency weighting
   * and L2 normalization to project arbitrary text into a dense 384-d semantic space.
   */
  deterministicLocalVector(text) {
    const vec = new Float64Array(this.dimension);
    const cleanText = text.toLowerCase().trim();

    // 1. Extract words
    const words = cleanText.split(/[\s,.;:!?()[\]{}"'/\\]+/).filter(w => w.length > 1);

    // 2. Generate n-grams (unigrams, bigrams, and character 3-grams for morphology)
    const terms = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      terms.push(`w:${w}`);

      if (i < words.length - 1) {
        terms.push(`bi:${w}_${words[i + 1]}`);
      }

      // Character trigrams for stem robustness
      if (w.length >= 3) {
        for (let j = 0; j <= w.length - 3; j++) {
          terms.push(`c3:${w.substring(j, j + 3)}`);
        }
      }
    }

    if (terms.length === 0) {
      return Array.from(vec);
    }

    // 3. Count frequencies
    const termFreq = {};
    for (const term of terms) {
      termFreq[term] = (termFreq[term] || 0) + 1;
    }

    // 4. Hash terms into vector dimensions with sign hashing
    for (const [term, freq] of Object.entries(termFreq)) {
      const hash = hashString(term);
      const bin = Math.abs(hash) % this.dimension;
      const sign = (hash & 1) === 0 ? 1.0 : -1.0;
      // Sublinear TF weighting: 1 + log(freq)
      const weight = (1 + Math.log(freq)) * sign;
      vec[bin] += weight;
    }

    // 5. L2 Normalization to unit hypersphere
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vec[i] * vec[i];
    }

    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vec[i] /= norm;
      }
    }

    return Array.from(vec);
  }

  /**
   * Fetch embedding from local Ollama runtime
   */
  async fetchOllamaEmbedding(text) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: text
        }),
        signal: controller.signal
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.embedding || null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * L2-normalize an arbitrary vector
   */
  normalizeVector(vec) {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return vec;
    return vec.map(v => v / norm);
  }

  /**
   * Compute cosine similarity between two unit-normalized vectors
   * (Dot product since ||v|| = 1.0)
   */
  static cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
    }
    return Math.max(-1, Math.min(1, dot));
  }
}

/**
 * 32-bit Murmur-style integer hash of a string
 */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

module.exports = {
  EmbeddingsEngine,
  VECTOR_DIMENSION
};
