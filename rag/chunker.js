/**
 * Project ABYX — Phase 7: Document Chunker
 * Recursive semantic text chunker preserving section headers, page numbers, and context overlap.
 */

const crypto = require('node:crypto');
const { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } = require('./types');

class Chunker {
  /**
   * Chunk a parsed document into structured, overlapping chunks
   * @param {Object} parsedDoc - Output of DocumentParser.parseFile
   * @param {Object} options - { chunkSize, chunkOverlap }
   */
  static chunkDocument(parsedDoc, options = {}) {
    const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options.chunkOverlap !== undefined ? options.chunkOverlap : DEFAULT_CHUNK_OVERLAP;

    const chunks = [];
    let globalIndex = 0;
    let globalOffset = 0;

    const sections = parsedDoc.sections && parsedDoc.sections.length > 0
      ? parsedDoc.sections
      : [{ title: parsedDoc.fileName, pageNumber: null, text: parsedDoc.rawText || '' }];

    for (const section of sections) {
      const sectionText = section.text || '';
      if (!sectionText.trim()) continue;

      const sectionChunks = this.splitText(sectionText, chunkSize, chunkOverlap);

      for (const item of sectionChunks) {
        chunks.push({
          id: `chunk_${crypto.randomUUID()}`,
          chunkIndex: globalIndex++,
          sectionTitle: section.title || parsedDoc.fileName,
          pageNumber: section.pageNumber || null,
          content: item.text,
          charCount: item.text.length,
          metadata: {
            fileName: parsedDoc.fileName,
            fileType: parsedDoc.fileType,
            sectionTitle: section.title,
            pageNumber: section.pageNumber,
            approxTokens: Math.ceil(item.text.length / 4),
            startOffset: globalOffset + item.start,
            endOffset: globalOffset + item.end
          }
        });
      }

      globalOffset += sectionText.length;
    }

    // Edge case: if entire document was empty or whitespace
    if (chunks.length === 0 && parsedDoc.rawText && parsedDoc.rawText.trim()) {
      chunks.push({
        id: `chunk_${crypto.randomUUID()}`,
        chunkIndex: 0,
        sectionTitle: parsedDoc.fileName,
        pageNumber: null,
        content: parsedDoc.rawText.trim(),
        charCount: parsedDoc.rawText.trim().length,
        metadata: {
          fileName: parsedDoc.fileName,
          fileType: parsedDoc.fileType,
          sectionTitle: parsedDoc.fileName,
          pageNumber: null,
          approxTokens: Math.ceil(parsedDoc.rawText.length / 4)
        }
      });
    }

    return chunks;
  }

  /**
   * Split a text block into overlapping chunks respecting natural boundaries
   */
  static splitText(text, targetSize, overlap) {
    if (text.length <= targetSize) {
      return [{ text: text.trim(), start: 0, end: text.length }];
    }

    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + targetSize;

      if (end >= text.length) {
        const remaining = text.substring(start).trim();
        if (remaining.length > 0) {
          chunks.push({ text: remaining, start, end: text.length });
        }
        break;
      }

      // Find the best split point before `end`
      // Priority: Double newline > Single newline > Period + space > Comma/Semicolon > Space
      let splitPoint = -1;
      const window = text.substring(start, end);

      const doubleBreak = window.lastIndexOf('\n\n');
      if (doubleBreak > targetSize * 0.4) {
        splitPoint = start + doubleBreak + 2;
      } else {
        const singleBreak = window.lastIndexOf('\n');
        if (singleBreak > targetSize * 0.5) {
          splitPoint = start + singleBreak + 1;
        } else {
          const sentenceEnd = Math.max(
            window.lastIndexOf('. '),
            window.lastIndexOf('! '),
            window.lastIndexOf('? ')
          );
          if (sentenceEnd > targetSize * 0.5) {
            splitPoint = start + sentenceEnd + 2;
          } else {
            const space = window.lastIndexOf(' ');
            if (space > targetSize * 0.5) {
              splitPoint = start + space + 1;
            } else {
              splitPoint = end; // Hard cutoff
            }
          }
        }
      }

      const chunkContent = text.substring(start, splitPoint).trim();
      if (chunkContent.length > 0) {
        chunks.push({ text: chunkContent, start, end: splitPoint });
      }

      // Advance with overlap
      const nextStart = Math.max(start + 1, splitPoint - overlap);
      if (nextStart >= text.length || nextStart <= start) {
        start = splitPoint;
      } else {
        start = nextStart;
      }
    }

    return chunks;
  }
}

module.exports = Chunker;
