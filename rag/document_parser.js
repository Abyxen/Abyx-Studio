/**
 * Project ABYX — Phase 7: Document Parser
 * Safe, zero-cloud, multi-format document parser for local knowledge bases.
 * Supports: .txt, .md, .pdf, .docx, .json, .csv, .html
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  DocumentParsingError,
  UnsupportedFormatError,
  FileSizeLimitError
} = require('./types');

class DocumentParser {
  /**
   * Validate file format, existence, and size before ingestion
   */
  static validateFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new DocumentParsingError(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      throw new DocumentParsingError(`Path is a directory, not a file: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new UnsupportedFormatError(ext, SUPPORTED_EXTENSIONS);
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new FileSizeLimitError(stat.size, MAX_FILE_SIZE_BYTES);
    }

    return { ext, sizeBytes: stat.size };
  }

  /**
   * Parse a file into unified text, sections, and metadata
   */
  static async parseFile(filePath) {
    const { ext, sizeBytes } = this.validateFile(filePath);
    const fileName = path.basename(filePath);

    try {
      const buffer = fs.readFileSync(filePath);

      switch (ext) {
        case '.txt':
          return this.parsePlainText(buffer, fileName, sizeBytes);

        case '.md':
        case '.markdown':
          return this.parseMarkdown(buffer, fileName, sizeBytes);

        case '.pdf':
          return this.parsePdf(buffer, fileName, sizeBytes);

        case '.docx':
          return this.parseDocx(buffer, fileName, sizeBytes);

        case '.json':
          return this.parseJson(buffer, fileName, sizeBytes);

        case '.csv':
          return this.parseCsv(buffer, fileName, sizeBytes);

        case '.html':
        case '.htm':
          return this.parseHtml(buffer, fileName, sizeBytes);

        default:
          throw new UnsupportedFormatError(ext, SUPPORTED_EXTENSIONS);
      }
    } catch (err) {
      if (err instanceof DocumentParsingError || err instanceof UnsupportedFormatError || err instanceof FileSizeLimitError) {
        throw err;
      }
      throw new DocumentParsingError(`Failed to parse "${fileName}": ${err.message}`, err);
    }
  }

  /**
   * Parse an in-memory Buffer into unified text, sections, and metadata
   */
  static async parseBuffer(buffer, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const sizeBytes = buffer ? buffer.length : 0;
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new UnsupportedFormatError(ext, SUPPORTED_EXTENSIONS);
    }
    let res;
    switch (ext) {
      case '.txt':
        res = this.parsePlainText(buffer, fileName, sizeBytes);
        break;
      case '.md':
      case '.markdown':
        res = this.parseMarkdown(buffer, fileName, sizeBytes);
        break;
      case '.pdf':
        res = this.parsePdf(buffer, fileName, sizeBytes);
        break;
      case '.docx':
        res = this.parseDocx(buffer, fileName, sizeBytes);
        break;
      case '.json':
        res = this.parseJson(buffer, fileName, sizeBytes);
        break;
      case '.csv':
        res = this.parseCsv(buffer, fileName, sizeBytes);
        break;
      case '.html':
      case '.htm':
        res = this.parseHtml(buffer, fileName, sizeBytes);
        break;
      default:
        throw new UnsupportedFormatError(ext, SUPPORTED_EXTENSIONS);
        break;
    }
    const text = res.rawText || (res.sections ? res.sections.map(s => s.text).join('\n') : '');
    return {
      ...res,
      text
    };
  }

  async parseBuffer(buffer, fileName) {
    return DocumentParser.parseBuffer(buffer, fileName);
  }

  /**
   * Parse Plain Text
   */
  static parsePlainText(buffer, fileName, sizeBytes) {
    const text = buffer.toString('utf8');
    return {
      fileName,
      fileType: 'text/plain',
      sizeBytes,
      rawText: text,
      metadata: {
        title: fileName,
        charCount: text.length
      },
      sections: [
        { title: fileName, pageNumber: null, text }
      ]
    };
  }

  /**
   * Parse Markdown with section header detection
   */
  static parseMarkdown(buffer, fileName, sizeBytes) {
    const raw = buffer.toString('utf8');
    const lines = raw.split(/\r?\n/);
    const sections = [];
    let currentTitle = fileName;
    let currentLines = [];

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (currentLines.length > 0) {
          sections.push({
            title: currentTitle,
            pageNumber: null,
            text: currentLines.join('\n').trim()
          });
          currentLines = [];
        }
        currentTitle = headerMatch[2].trim();
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        title: currentTitle,
        pageNumber: null,
        text: currentLines.join('\n').trim()
      });
    }

    return {
      fileName,
      fileType: 'text/markdown',
      sizeBytes,
      rawText: raw,
      metadata: {
        title: fileName,
        charCount: raw.length,
        sectionCount: sections.length
      },
      sections: sections.filter(s => s.text.length > 0)
    };
  }

  /**
   * Parse PDF with Pure Node.js decompression
   */
  static parsePdf(buffer, fileName, sizeBytes) {
    const pdfStr = buffer.toString('binary');
    if (!pdfStr.startsWith('%PDF-')) {
      throw new DocumentParsingError(`Invalid or corrupt PDF header in "${fileName}"`);
    }

    const metadata = { title: fileName, pages: 0 };
    const titleMatch = pdfStr.match(/\/Title\s*\(([^)]+)\)/i);
    if (titleMatch) metadata.title = titleMatch[1];
    const authorMatch = pdfStr.match(/\/Author\s*\(([^)]+)\)/i);
    if (authorMatch) metadata.author = authorMatch[1];

    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    const pages = [];
    let pageNum = 1;

    while ((match = streamRegex.exec(pdfStr)) !== null) {
      const rawStream = Buffer.from(match[1], 'binary');
      let decodedText = '';

      try {
        decodedText = zlib.inflateSync(rawStream).toString('latin1');
      } catch (e1) {
        try {
          decodedText = zlib.inflateRawSync(rawStream).toString('latin1');
        } catch (e2) {
          decodedText = rawStream.toString('latin1');
        }
      }

      if (decodedText.includes('BT') && decodedText.includes('ET')) {
        const textChunks = [];
        const btRegex = /BT([\s\S]*?)ET/g;
        let btMatch;

        while ((btMatch = btRegex.exec(decodedText)) !== null) {
          const block = btMatch[1];

          // 1. Array text operator: [(Hello) 20 (World)] TJ
          const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
          let tjArrayMatch;
          while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
            const items = tjArrayMatch[1];
            const innerStrRegex = /\(([^)]*)\)/g;
            let sMatch;
            let combined = '';
            while ((sMatch = innerStrRegex.exec(items)) !== null) {
              combined += cleanPdfString(sMatch[1]);
            }
            if (combined.trim()) textChunks.push(combined.trim());
          }

          // 2. Single text operator: (Hello World) Tj or ' or "
          const tjSingleRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
          let tjMatch;
          while ((tjMatch = tjSingleRegex.exec(block)) !== null) {
            const str = cleanPdfString(tjMatch[1]);
            if (str.trim()) textChunks.push(str.trim());
          }

          // 3. Hex string operator: <48656C6C6F> Tj
          const hexRegex = /<([0-9A-Fa-f]+)>\s*Tj/g;
          let hexMatch;
          while ((hexMatch = hexRegex.exec(block)) !== null) {
            const hex = hexMatch[1];
            let str = '';
            for (let i = 0; i < hex.length; i += 2) {
              str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
            }
            if (str.trim()) textChunks.push(str.trim());
          }
        }

        if (textChunks.length > 0) {
          pages.push({
            pageNumber: pageNum++,
            text: textChunks.join(' ')
          });
        }
      }
    }

    metadata.pages = pages.length;
    let fullText = pages.map(p => `--- Page ${p.pageNumber} ---\n${p.text}`).join('\n\n');

    if (!fullText.trim()) {
      throw new DocumentParsingError(`No extractable text was found in PDF "${fileName}". Scanned PDFs require OCR, which is not available.`);
    }

    return {
      fileName,
      fileType: 'application/pdf',
      sizeBytes,
      rawText: fullText,
      metadata,
      sections: pages.map(p => ({
        title: `${fileName} (Page ${p.pageNumber})`,
        pageNumber: p.pageNumber,
        text: p.text
      }))
    };
  }

  /**
   * Parse DOCX with Native Zip extraction
   */
  static parseDocx(buffer, fileName, sizeBytes) {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new DocumentParsingError(`Invalid or corrupt DOCX archive header in "${fileName}"`);
    }

    let offset = 0;
    let docXml = null;

    while (offset < buffer.length - 30) {
      if (buffer[offset] === 0x50 && buffer[offset + 1] === 0x4b && buffer[offset + 2] === 0x03 && buffer[offset + 3] === 0x04) {
        const compMethod = buffer.readUInt16LE(offset + 8);
        const compSize = buffer.readUInt32LE(offset + 18);
        const fnLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);
        const fnStart = offset + 30;
        const entryName = buffer.toString('utf8', fnStart, fnStart + fnLen);
        const dataStart = fnStart + fnLen + extraLen;

        if (entryName === 'word/document.xml') {
          const compressedSlice = buffer.subarray(dataStart, dataStart + compSize);
          try {
            if (compMethod === 8) {
              docXml = zlib.inflateRawSync(compressedSlice).toString('utf8');
            } else if (compMethod === 0) {
              docXml = compressedSlice.toString('utf8');
            }
          } catch (e) {
            throw new DocumentParsingError(`Failed to decompress DOCX document.xml: ${e.message}`, e);
          }
          break;
        }
        offset = dataStart + compSize;
      } else {
        offset++;
      }
    }

    if (!docXml) {
      throw new DocumentParsingError(`word/document.xml not found in DOCX file: "${fileName}"`);
    }

    const paragraphs = [];
    const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pMatch;
    while ((pMatch = pRegex.exec(docXml)) !== null) {
      const pBlock = pMatch[1];
      const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      let tMatch;
      let pText = '';
      while ((tMatch = tRegex.exec(pBlock)) !== null) {
        pText += tMatch[1];
      }
      if (pText.trim()) paragraphs.push(pText.trim());
    }

    const fullText = paragraphs.join('\n\n');
    return {
      fileName,
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes,
      rawText: fullText,
      metadata: {
        title: fileName,
        paragraphCount: paragraphs.length,
        charCount: fullText.length
      },
      sections: [
        { title: fileName, pageNumber: null, text: fullText }
      ]
    };
  }

  /**
   * Parse JSON safely
   */
  static parseJson(buffer, fileName, sizeBytes) {
    const raw = buffer.toString('utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new DocumentParsingError(`Invalid JSON syntax in "${fileName}": ${e.message}`, e);
    }

    // Format text nicely for indexing
    let formattedText;
    if (Array.isArray(parsed)) {
      formattedText = parsed.map((item, idx) => `[Item ${idx + 1}]\n${JSON.stringify(item, null, 2)}`).join('\n\n');
    } else {
      formattedText = JSON.stringify(parsed, null, 2);
    }

    return {
      fileName,
      fileType: 'application/json',
      sizeBytes,
      rawText: formattedText,
      metadata: {
        title: fileName,
        isArray: Array.isArray(parsed),
        recordCount: Array.isArray(parsed) ? parsed.length : 1
      },
      sections: [
        { title: fileName, pageNumber: null, text: formattedText }
      ]
    };
  }

  /**
   * Parse CSV
   */
  static parseCsv(buffer, fileName, sizeBytes) {
    const raw = buffer.toString('utf8');
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return {
        fileName,
        fileType: 'text/csv',
        sizeBytes,
        rawText: '',
        metadata: { title: fileName, rowCount: 0 },
        sections: []
      };
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const rowsText = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
      const rowDesc = headers.map((h, idx) => `${h}: ${cols[idx] || ''}`).join(' | ');
      rowsText.push(`Row ${i}: ${rowDesc}`);
    }

    const fullText = `Columns: ${headers.join(', ')}\n\n` + rowsText.join('\n');

    return {
      fileName,
      fileType: 'text/csv',
      sizeBytes,
      rawText: fullText,
      metadata: {
        title: fileName,
        columns: headers,
        rowCount: lines.length - 1
      },
      sections: [
        { title: `${fileName} (Data Records)`, pageNumber: null, text: fullText }
      ]
    };
  }

  /**
   * Parse HTML safely without executing scripts
   */
  static parseHtml(buffer, fileName, sizeBytes) {
    let html = buffer.toString('utf8');

    // Remove script, style, head, nav, footer tags and their contents
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
    html = html.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, ' ');
    html = html.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');
    html = html.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');

    // Extract title
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : fileName;

    // Convert block elements to newlines
    html = html.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n');
    html = html.replace(/<br\s*\/?>/gi, '\n');

    // Strip remaining tags
    let text = html.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Collapse whitespace
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

    return {
      fileName,
      fileType: 'text/html',
      sizeBytes,
      rawText: text,
      metadata: {
        title,
        charCount: text.length
      },
      sections: [
        { title, pageNumber: null, text }
      ]
    };
  }
}

function cleanPdfString(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

module.exports = DocumentParser;
